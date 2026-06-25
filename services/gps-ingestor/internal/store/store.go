// Package store batches incoming Teltonika records into TimescaleDB and
// fans out a compact "live position" envelope to Redis Pub/Sub for the API's
// WebSocket layer.
//
// Backpressure model
// ------------------
//   - Each connection calls Enqueue with the records it just parsed. Records
//     for unknown IMEIs are dropped (logged, counted) so a misconfigured
//     device cannot drive Postgres into FK errors forever.
//   - Records land in a bounded channel. When the channel is full, Enqueue
//     blocks the device goroutine briefly (up to writeTimeout); this is the
//     intended backpressure path — devices will retry with their own buffer.
//   - A single batcher goroutine drains the channel into pgx COPY FROM in
//     chunks (default 500 rows or 1s, whichever comes first). COPY is an
//     order of magnitude faster than parameterised INSERT at this rate.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/config"
	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/protocol"
)

const (
	livePubChannel = "fleex.positions"
	deviceCacheTTL = 5 * time.Minute
	onlineKeyTTL   = 90 * time.Second
)

// DeviceLookup is the small device descriptor we cache in Redis.
type DeviceLookup struct {
	ID        string `json:"id"`
	CompanyID string `json:"companyId"`
}

// Row is the staging structure used between the parser and the COPY writer.
type Row struct {
	Time        time.Time
	DeviceID    string
	CompanyID   string
	Latitude    float64
	Longitude   float64
	Speed       float32
	Course      float32
	Altitude    float32
	Satellites  int16
	Ignition    *bool
	OdometerKm  *float64
	EngineHrs   *float64
	BatteryVolt *float64
	RFID        string
	// VIN is harvested from Codec 8E variable IO 256 (VIN auto-detect
	// over OBD). Empty for devices without an OBD adapter.
	VIN        string
	Valid      bool
	Attributes []byte
}

type Store struct {
	cfg   *config.Config
	pg    *pgxpool.Pool
	rdb   *redis.Client
	queue chan deviceBatch
	// done is closed by Run when the batcher has drained and flushed on
	// shutdown, so main can wait for it before closing the pool.
	done chan struct{}

	healthy atomic.Bool

	rowsInserted atomic.Uint64
	rowsDropped  atomic.Uint64
	flushErrors  atomic.Uint64
	queueDepth   atomic.Int64
	rawCounter   atomic.Uint64 // drives 1-in-N raw_messages sampling
}

type deviceBatch struct {
	imei     string
	proto    string // protocol name (raw_messages.protocol)
	records  []protocol.Record
	frameLen int // bytes-on-wire of the AVL packet that carried these records
}

func New(ctx context.Context, cfg *config.Config) (*Store, error) {
	pgCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse db url: %w", err)
	}
	pgCfg.MaxConns = 16
	pgCfg.MinConns = 2
	pgCfg.MaxConnLifetime = 30 * time.Minute
	pgCfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, pgCfg)
	if err != nil {
		return nil, fmt.Errorf("pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("pg ping: %w", err)
	}

	var rdb *redis.Client
	if cfg.RedisURL != "" {
		opt, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			return nil, fmt.Errorf("redis url: %w", err)
		}
		rdb = redis.NewClient(opt)
		if err := rdb.Ping(ctx).Err(); err != nil {
			return nil, fmt.Errorf("redis ping: %w", err)
		}
	}

	queueSize := cfg.QueueSize
	if queueSize < 1 {
		queueSize = 4096
	}
	s := &Store{
		cfg:   cfg,
		pg:    pool,
		rdb:   rdb,
		queue: make(chan deviceBatch, queueSize),
		done:  make(chan struct{}),
	}
	s.healthy.Store(true)
	return s, nil
}

func (s *Store) Healthy() bool { return s.healthy.Load() }

// Wait blocks until the batcher goroutine (Run) has finished its shutdown
// drain + final flush. Call it after the TCP server stops and before Close().
func (s *Store) Wait() { <-s.done }
func (s *Store) Close() {
	if s.pg != nil {
		s.pg.Close()
	}
	if s.rdb != nil {
		_ = s.rdb.Close()
	}
}

// Enqueue pushes a batch onto the ingest queue. If the queue is full we
// block briefly; the device will then either back off (TCP backpressure)
// or be disconnected by the caller's write deadline. `frameLen` is the
// on-wire packet size, used to credit the GPRS counter. `proto` is the
// device protocol name, stamped onto raw_messages.
func (s *Store) Enqueue(ctx context.Context, imei, proto string, records []protocol.Record, frameLen int) error {
	if len(records) == 0 {
		return nil
	}
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	select {
	case s.queue <- deviceBatch{imei: imei, proto: proto, records: records, frameLen: frameLen}:
		s.queueDepth.Add(int64(len(records)))
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		s.rowsDropped.Add(uint64(len(records)))
		return errors.New("ingest queue full")
	}
}

// Run is the long-running batcher goroutine. On shutdown (ctx cancelled) it
// drains whatever is still queued and flushes a final batch — using a
// non-cancelled context — so a restart/deploy doesn't drop buffered
// positions. `done` is closed once that completes (see Wait).
func (s *Store) Run(ctx context.Context) {
	defer close(s.done)

	batchTimer := time.NewTicker(s.cfg.BatchFlushTimeout)
	defer batchTimer.Stop()

	rows := make([]Row, 0, s.cfg.BatchSize)
	live := make([]livePayload, 0, s.cfg.BatchSize)
	rawMsgs := make([]rawMessageRow, 0, s.cfg.BatchSize)
	// In-batch GPRS byte tally keyed by deviceId — flushed together with rows.
	gprsBytes := make(map[string]int64, 16)
	gprsPkts := make(map[string]int, 16)

	flush := func() {
		if len(rows) == 0 {
			return
		}
		// Derive the flush context from a non-cancelled base so an in-flight
		// COPY (plus snapshot/publish/raw/gprs writes) always completes even
		// when ctx is cancelled by SIGTERM. The 15s timeout still bounds it.
		fctx := context.WithoutCancel(ctx)
		copyRows := make([][]any, 0, len(rows))
		for _, r := range rows {
			copyRows = append(copyRows, []any{
				r.Time, r.DeviceID, r.CompanyID,
				r.Latitude, r.Longitude,
				r.Speed, r.Course, r.Altitude,
				r.Satellites, nil, r.Ignition, r.OdometerKm, r.EngineHrs,
				r.BatteryVolt, nil, nullableString(r.RFID), r.Valid, r.Attributes,
			})
		}
		ctxFlush, cancel := context.WithTimeout(fctx, 15*time.Second)
		copied, err := s.pg.CopyFrom(ctxFlush,
			pgx.Identifier{"positions"},
			[]string{
				"time", "device_id", "company_id",
				"latitude", "longitude",
				"speed", "course", "altitude",
				"satellites", "hdop", "ignition", "odometer_km", "engine_hours",
				"battery_volt", "fuel_pct", "rfid", "valid", "attributes",
			},
			pgx.CopyFromRows(copyRows),
		)
		cancel()
		if err != nil {
			s.flushErrors.Add(1)
			s.rowsDropped.Add(uint64(len(rows)))
			log.Error().Err(err).Int("rows", len(rows)).Msg("copy failed")
		} else {
			s.rowsInserted.Add(uint64(copied))
			s.queueDepth.Add(-int64(len(rows)))
			s.flushSnapshots(fctx, rows)
		}

		if s.rdb != nil {
			for _, p := range live {
				payload, _ := json.Marshal(p)
				_ = s.rdb.Publish(fctx, livePubChannel, payload).Err()
			}
		}

		// Best-effort write of raw_messages and gprs_counters. These are
		// debug / accounting tables so we tolerate failures silently to keep
		// the hot path moving when the secondary writes are slow.
		if len(rawMsgs) > 0 {
			s.flushRawMessages(fctx, rawMsgs)
		}
		if len(gprsBytes) > 0 {
			s.flushGprs(fctx, gprsBytes, gprsPkts)
		}

		rows = rows[:0]
		live = live[:0]
		rawMsgs = rawMsgs[:0]
		for k := range gprsBytes {
			delete(gprsBytes, k)
			delete(gprsPkts, k)
		}
	}

	// consume turns one queued batch into staged rows/live envelopes. The
	// context is passed explicitly so the shutdown drain can resolve devices
	// with a non-cancelled context (the live ctx is already cancelled by then).
	consume := func(cctx context.Context, batch deviceBatch) {
		dev, ok := s.resolveDevice(cctx, batch.imei)
		if !ok {
			s.rowsDropped.Add(uint64(len(batch.records)))
			return
		}
		// Credit the GPRS counter for this packet (one record-set = one
		// AVL frame). Split the byte cost evenly across records would be
		// noisier, so we charge the whole frame to this device once.
		if batch.frameLen > 0 {
			gprsBytes[dev.ID] += int64(batch.frameLen)
			gprsPkts[dev.ID]++
		}
		for _, rec := range batch.records {
			if !isPlausible(rec) {
				continue
			}
			// Telemetry is already normalised by the protocol decoder, so the
			// store stays vendor-neutral: it never calls teltonika.Pick*.
			attrs := buildAttributes(rec)

			// Raw debug capture — keeps the same JSON as `attributes`
			// plus the position essentials for cheap row-scanning. Sampled
			// 1-in-N via INGESTOR_RAW_SAMPLE_N (default 1 = every record)
			// so this debug table doesn't dominate write throughput at
			// scale. The counter is only touched when sampling is enabled.
			if n := s.cfg.RawSampleN; n <= 1 || s.rawCounter.Add(1)%uint64(n) == 0 {
				rawMsgs = append(rawMsgs, rawMessageRow{
					DeviceID:   dev.ID,
					ReceivedAt: rec.Timestamp,
					Protocol:   batch.proto,
					Lat:        rec.Lat,
					Lng:        rec.Lng,
					Speed:      rec.SpeedKmh,
					Ignition:   rec.Ignition,
					Payload:    attrs,
					ByteSize:   batch.frameLen / max(len(batch.records), 1),
				})
			}

			rows = append(rows, Row{
				Time: rec.Timestamp, DeviceID: dev.ID, CompanyID: dev.CompanyID,
				Latitude: rec.Lat, Longitude: rec.Lng,
				Speed:      float32(rec.SpeedKmh),
				Course:     float32(rec.Course),
				Altitude:   float32(rec.Altitude),
				Satellites: int16(rec.Satellites),
				Ignition:   rec.Ignition, OdometerKm: rec.OdometerKm,
				EngineHrs: rec.EngineHours, BatteryVolt: rec.BatteryVolt,
				RFID: rec.RFID,
				// VIN auto-detect (Teltonika OBD adapter); passed through so
				// flushSnapshots can populate devices.vin when it's null.
				VIN:        rec.VIN,
				Valid:      rec.Valid,
				Attributes: attrs,
			})
			ioMap := make(map[string]int64, len(rec.IO))
			for k, v := range rec.IO {
				ioMap[fmt.Sprintf("%d", k)] = v
			}
			live = append(live, livePayload{
				DeviceID: dev.ID, CompanyID: dev.CompanyID,
				Imei: batch.imei,
				Lat:  rec.Lat, Lng: rec.Lng,
				Speed:  rec.SpeedKmh,
				Course: rec.Course, Altitude: rec.Altitude,
				Time:     rec.Timestamp.UnixMilli(),
				Ignition: rec.Ignition,
				EventIO:  rec.EventIO,
				IO:       ioMap,
			})
			if len(rows) >= s.cfg.BatchSize {
				flush()
			}
		}
	}

	for {
		select {
		case <-ctx.Done():
			// Best-effort drain so a deploy/restart doesn't drop what's still
			// queued. Bounded by a deadline so a sustained flood can't hang
			// shutdown past the container's stop_grace_period.
			drainCtx := context.WithoutCancel(ctx)
			deadline := time.After(10 * time.Second)
			draining := true
			for draining {
				select {
				case batch := <-s.queue:
					consume(drainCtx, batch)
				case <-deadline:
					draining = false
				default:
					draining = false
				}
			}
			flush()
			return
		case <-batchTimer.C:
			flush()
		case batch := <-s.queue:
			consume(ctx, batch)
		}
	}
}

type livePayload struct {
	DeviceID  string  `json:"deviceId"`
	CompanyID string  `json:"companyId"`
	Imei      string  `json:"imei"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	Speed     float64 `json:"speed"`
	Course    float64 `json:"course"`
	Altitude  float64 `json:"altitude"`
	Time      int64   `json:"time"`
	Ignition  *bool   `json:"ignition,omitempty"`
	EventIO   uint16  `json:"eventIo,omitempty"`
	// IO is the raw protocol IO map (Teltonika AVL IDs → value). Events-engine
	// uses it to detect harsh driving, sensor calibration, etc. Kept compact
	// (int values fit native JSON numbers).
	IO map[string]int64 `json:"io,omitempty"`
}

// lookupDevice resolves a device by IMEI, caching the result for 5 minutes in
// Redis (and a brief negative cache for unknown IMEIs to spare Postgres from
// hot floods). The tri-state return distinguishes "definitively not
// registered" (found=false, err=nil) from "lookup failed" (err!=nil) so
// callers can choose fail-open vs fail-closed.
func (s *Store) lookupDevice(ctx context.Context, imei string) (DeviceLookup, bool, error) {
	cacheKey := "ingestor:dev:" + imei
	if s.rdb != nil {
		if v, err := s.rdb.Get(ctx, cacheKey).Result(); err == nil {
			if v == "" {
				return DeviceLookup{}, false, nil // negative cache → not registered
			}
			var d DeviceLookup
			if err := json.Unmarshal([]byte(v), &d); err == nil && d.ID != "" {
				return d, true, nil
			}
		}
	}

	var d DeviceLookup
	row := s.pg.QueryRow(ctx,
		`SELECT id::text, "companyId"::text FROM devices WHERE imei = $1 LIMIT 1`, imei)
	if err := row.Scan(&d.ID, &d.CompanyID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if s.rdb != nil {
				_ = s.rdb.Set(ctx, cacheKey, "", 30*time.Second).Err()
			}
			log.Debug().Str("imei", imei).Msg("unknown device")
			return d, false, nil
		}
		log.Warn().Err(err).Msg("device lookup")
		return d, false, err
	}
	if s.rdb != nil {
		blob, _ := json.Marshal(d)
		_ = s.rdb.Set(ctx, cacheKey, blob, deviceCacheTTL).Err()
	}
	return d, true, nil
}

// resolveDevice is the data-path lookup: unknown IMEI or lookup error both
// mean "drop" (conservative — never attribute telemetry to the wrong device).
func (s *Store) resolveDevice(ctx context.Context, imei string) (DeviceLookup, bool) {
	d, ok, _ := s.lookupDevice(ctx, imei)
	return d, ok
}

// AcceptHandshake reports whether the IMEI handshake should be accepted
// (audit R-4). Registered IMEIs are accepted; a definitively-unknown IMEI is
// rejected so an attacker can't hold a connection or probe the fleet with a
// spoofed identity. On a transient lookup failure we fail OPEN (accept) so a
// database blip can't lock the whole fleet out — telemetry for a truly unknown
// IMEI is still dropped downstream by resolveDevice.
func (s *Store) AcceptHandshake(ctx context.Context, imei string) bool {
	_, found, err := s.lookupDevice(ctx, imei)
	if err != nil {
		return true
	}
	return found
}

// MarkOnline keeps a short-lived presence key in Redis so the API can
// quickly distinguish "online but idle" from "offline".
func (s *Store) MarkOnline(ctx context.Context, imei string) error {
	if s.rdb == nil {
		return nil
	}
	return s.rdb.Set(ctx, "ingestor:online:"+imei, time.Now().Unix(), onlineKeyTTL).Err()
}

// flushSnapshots updates devices.last_* columns. Only the latest record per
// device in this batch is applied — no point UPDATE-ing the same row 500
// times in a row.
func (s *Store) flushSnapshots(ctx context.Context, rows []Row) {
	type snap struct {
		t                  time.Time
		lat, lng           float64
		speed, course, alt float32
		ig                 *bool
		odo, hrs, bat      *float64
		vin                string
	}
	latest := make(map[string]snap, len(rows))
	for _, r := range rows {
		s, ok := latest[r.DeviceID]
		if !ok || r.Time.After(s.t) {
			latest[r.DeviceID] = snap{
				t: r.Time, lat: r.Latitude, lng: r.Longitude,
				speed: r.Speed, course: r.Course, alt: r.Altitude,
				ig: r.Ignition, odo: r.OdometerKm, hrs: r.EngineHrs, bat: r.BatteryVolt,
				vin: r.VIN,
			}
		} else if s.vin == "" && r.VIN != "" {
			// VIN may arrive on a non-latest record in the batch — keep it
			// so we can populate devices.vin even if the latest position
			// itself didn't include it.
			s.vin = r.VIN
			latest[r.DeviceID] = s
		}
	}
	batch := &pgx.Batch{}
	for id, sn := range latest {
		batch.Queue(
			// Devices columns are camelCase via Prisma (quoted in DDL), so
			// the column names here must be double-quoted to match.
			// Unquoted snake_case identifiers fold to all-lowercase and
			// never resolve — that bug shipped to prod and stopped every
			// snapshot UPDATE from going through.
			//
			// `vin` only gets stamped when it's still null on the device
			// row, so a manually entered VIN is never overwritten by the
			// OBD auto-detect. NULLIF($12, '') keeps the UPDATE a no-op
			// for snapshots that didn't carry a VIN payload.
			`UPDATE devices SET
				"lastSeenAt"   = $2,
				"lastLat"      = $3, "lastLng" = $4,
				"lastSpeed"    = $5, "lastCourse" = $6, "lastAltitude" = $7,
				"ignitionOn"   = COALESCE($8, "ignitionOn"),
				"odometerKm"   = COALESCE($9, "odometerKm"),
				"engineHours"  = COALESCE($10, "engineHours"),
				"batteryVolt"  = COALESCE($11, "batteryVolt"),
				vin            = COALESCE(vin, NULLIF($12, '')),
				"updatedAt"    = NOW()
			WHERE id = $1::uuid`,
			id, sn.t, sn.lat, sn.lng, sn.speed, sn.course, sn.alt,
			sn.ig, sn.odo, sn.hrs, sn.bat, sn.vin,
		)
	}
	br := s.pg.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < batch.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			log.Debug().Err(err).Msg("snapshot update")
		}
	}
}

// rawMessageRow is the staging shape for a raw_messages INSERT. We do not
// COPY FROM here because the volume is small enough that a multi-row
// INSERT keeps the implementation simple.
type rawMessageRow struct {
	DeviceID   string
	ReceivedAt time.Time
	Protocol   string
	Lat        float64
	Lng        float64
	Speed      float64
	Ignition   *bool
	Payload    []byte
	ByteSize   int
}

// flushRawMessages persists the raw packet snapshots and trims older rows
// per device so the table stays bounded. The trim runs occasionally
// (once every ~50 inserts per device) — exact bound is not critical.
func (s *Store) flushRawMessages(ctx context.Context, msgs []rawMessageRow) {
	batch := &pgx.Batch{}
	for _, m := range msgs {
		batch.Queue(
			`INSERT INTO raw_messages
				("deviceId", "receivedAt", protocol, lat, lng, speed, ignition, payload, "byteSize")
			 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
			m.DeviceID, m.ReceivedAt, m.Protocol, m.Lat, m.Lng, m.Speed, m.Ignition,
			nullableJSON(m.Payload), m.ByteSize,
		)
	}
	br := s.pg.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < batch.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			log.Debug().Err(err).Msg("raw_message insert")
		}
	}
	// Occasional trim: keep ~500 most recent per device touched in this batch.
	if s.rdb != nil {
		seen := make(map[string]bool, len(msgs))
		for _, m := range msgs {
			seen[m.DeviceID] = true
		}
		for did := range seen {
			// Throttle via a Redis NX key (run trim at most once per minute per device).
			key := "ingestor:trimraw:" + did
			ok, _ := s.rdb.SetNX(ctx, key, "1", 60*time.Second).Result()
			if ok {
				ctxTrim, cancel := context.WithTimeout(ctx, 5*time.Second)
				_, err := s.pg.Exec(ctxTrim, `
					DELETE FROM raw_messages
					WHERE id IN (
						SELECT id FROM raw_messages
						WHERE "deviceId" = $1::uuid
						ORDER BY id DESC
						OFFSET 500
					)`, did)
				cancel()
				if err != nil {
					log.Debug().Err(err).Msg("raw_message trim")
				}
			}
		}
	}
}

// flushGprs increments the per-device monthly byte counter. The yearMonth
// key is computed in UTC, matching the schema's VARCHAR(7) format.
func (s *Store) flushGprs(ctx context.Context, bytes map[string]int64, pkts map[string]int) {
	ym := time.Now().UTC().Format("2006-01")
	batch := &pgx.Batch{}
	for did, b := range bytes {
		batch.Queue(`
			INSERT INTO gprs_counters ("deviceId", "yearMonth", "bytesRx", "bytesTx", "packetCount")
			VALUES ($1::uuid, $2, $3, 0, $4)
			ON CONFLICT ("deviceId", "yearMonth")
			DO UPDATE SET
				"bytesRx" = gprs_counters."bytesRx" + EXCLUDED."bytesRx",
				"packetCount" = gprs_counters."packetCount" + EXCLUDED."packetCount"
		`, did, ym, b, pkts[did])
	}
	br := s.pg.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < batch.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			log.Debug().Err(err).Msg("gprs upsert")
		}
	}
}

func (s *Store) WriteMetrics(w io.Writer) {
	fmt.Fprintf(w, "fleex_ingestor_rows_inserted_total %d\n", s.rowsInserted.Load())
	fmt.Fprintf(w, "fleex_ingestor_rows_dropped_total %d\n", s.rowsDropped.Load())
	fmt.Fprintf(w, "fleex_ingestor_flush_errors_total %d\n", s.flushErrors.Load())
	fmt.Fprintf(w, "fleex_ingestor_queue_depth %d\n", s.queueDepth.Load())
}

// --- helpers ----------------------------------------------------------------

func isPlausible(r protocol.Record) bool {
	if r.Lat < -90 || r.Lat > 90 {
		return false
	}
	if r.Lng < -180 || r.Lng > 180 {
		return false
	}
	if r.Lat == 0 && r.Lng == 0 && r.Satellites < 3 {
		return false
	}
	return true
}

func buildAttributes(r protocol.Record) []byte {
	if len(r.IO) == 0 && len(r.IOStrings) == 0 {
		return nil
	}
	// JSON-encode with a mixed map (numbers + strings). Using `any`
	// is the simplest way to keep both kinds of values in one object
	// without needing a tagged-union type.
	m := make(map[string]any, len(r.IO)+len(r.IOStrings)+2)
	for k, v := range r.IO {
		m[fmt.Sprintf("io_%d", k)] = v
	}
	for k, v := range r.IOStrings {
		// Variable IOs that are printable ASCII (VIN, firmware, ...)
		// are stored with a `_str` suffix so the UI can distinguish them
		// from the truncated int64 version under the same id.
		m[fmt.Sprintf("io_%d_str", k)] = v
	}
	m["priority"] = int64(r.Priority)
	m["eventIo"] = int64(r.EventIO)
	b, _ := json.Marshal(m)
	return b
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nullableJSON returns an empty JSON object when the slice is empty so the
// raw_messages.payload column always holds a valid JSON value.
func nullableJSON(b []byte) []byte {
	if len(b) == 0 {
		return []byte("{}")
	}
	return b
}
