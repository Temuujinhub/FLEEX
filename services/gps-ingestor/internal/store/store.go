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
	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/teltonika"
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
	Valid       bool
	Attributes  []byte
}

type Store struct {
	cfg   *config.Config
	pg    *pgxpool.Pool
	rdb   *redis.Client
	queue chan deviceBatch

	healthy atomic.Bool

	rowsInserted atomic.Uint64
	rowsDropped  atomic.Uint64
	flushErrors  atomic.Uint64
	queueDepth   atomic.Int64
}

type deviceBatch struct {
	imei     string
	records  []teltonika.Record
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

	s := &Store{
		cfg:   cfg,
		pg:    pool,
		rdb:   rdb,
		queue: make(chan deviceBatch, 4096),
	}
	s.healthy.Store(true)
	return s, nil
}

func (s *Store) Healthy() bool { return s.healthy.Load() }
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
// on-wire packet size, used to credit the GPRS counter.
func (s *Store) Enqueue(ctx context.Context, imei string, records []teltonika.Record, frameLen int) error {
	if len(records) == 0 {
		return nil
	}
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	select {
	case s.queue <- deviceBatch{imei: imei, records: records, frameLen: frameLen}:
		s.queueDepth.Add(int64(len(records)))
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		s.rowsDropped.Add(uint64(len(records)))
		return errors.New("ingest queue full")
	}
}

// Run is the long-running batcher goroutine.
func (s *Store) Run(ctx context.Context) {
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
		ctxFlush, cancel := context.WithTimeout(ctx, 15*time.Second)
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
			s.flushSnapshots(ctx, rows)
		}

		if s.rdb != nil {
			for _, p := range live {
				payload, _ := json.Marshal(p)
				_ = s.rdb.Publish(ctx, livePubChannel, payload).Err()
			}
		}

		// Best-effort write of raw_messages and gprs_counters. These are
		// debug / accounting tables so we tolerate failures silently to keep
		// the hot path moving when the secondary writes are slow.
		if len(rawMsgs) > 0 {
			s.flushRawMessages(ctx, rawMsgs)
		}
		if len(gprsBytes) > 0 {
			s.flushGprs(ctx, gprsBytes, gprsPkts)
		}

		rows = rows[:0]
		live = live[:0]
		rawMsgs = rawMsgs[:0]
		for k := range gprsBytes {
			delete(gprsBytes, k)
			delete(gprsPkts, k)
		}
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case <-batchTimer.C:
			flush()
		case batch := <-s.queue:
			dev, ok := s.resolveDevice(ctx, batch.imei)
			if !ok {
				s.rowsDropped.Add(uint64(len(batch.records)))
				continue
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
				ig := teltonika.PickIgnition(rec)
				odo := teltonika.PickOdometerKm(rec)
				hrs := teltonika.PickEngineHours(rec)
				bat := teltonika.PickBatteryVolt(rec)
				rfid := teltonika.PickRFID(rec)
				attrs := buildAttributes(rec)

				// Raw debug capture — keeps the same JSON as `attributes`
				// plus the position essentials for cheap row-scanning.
				rawMsgs = append(rawMsgs, rawMessageRow{
					DeviceID:   dev.ID,
					ReceivedAt: rec.Timestamp,
					Protocol:   "teltonika",
					Lat:        rec.Lat,
					Lng:        rec.Lng,
					Speed:      teltonika.PickSpeedKmh(rec),
					Ignition:   ig,
					Payload:    attrs,
					ByteSize:   batch.frameLen / max(len(batch.records), 1),
				})

				rows = append(rows, Row{
					Time: rec.Timestamp, DeviceID: dev.ID, CompanyID: dev.CompanyID,
					Latitude: rec.Lat, Longitude: rec.Lng,
					Speed:      float32(teltonika.PickSpeedKmh(rec)),
					Course:     float32(rec.Angle),
					Altitude:   float32(rec.Altitude),
					Satellites: int16(rec.Satellites),
					Ignition:   ig, OdometerKm: odo, EngineHrs: hrs, BatteryVolt: bat,
					RFID:       rfid,
					Valid:      rec.Satellites >= 3,
					Attributes: attrs,
				})
				ioMap := make(map[string]int64, len(rec.IO))
				for k, v := range rec.IO {
					ioMap[fmt.Sprintf("%d", k)] = v
				}
				live = append(live, livePayload{
					DeviceID: dev.ID, CompanyID: dev.CompanyID,
					Imei:     batch.imei,
					Lat:      rec.Lat, Lng: rec.Lng,
					Speed:    float64(teltonika.PickSpeedKmh(rec)),
					Course:   float64(rec.Angle), Altitude: float64(rec.Altitude),
					Time:     rec.Timestamp.UnixMilli(),
					Ignition: ig,
					EventIO:  rec.EventIO,
					IO:       ioMap,
				})
				if len(rows) >= s.cfg.BatchSize {
					flush()
				}
			}
		}
	}
}

type livePayload struct {
	DeviceID  string           `json:"deviceId"`
	CompanyID string           `json:"companyId"`
	Imei      string           `json:"imei"`
	Lat       float64          `json:"lat"`
	Lng       float64          `json:"lng"`
	Speed     float64          `json:"speed"`
	Course    float64          `json:"course"`
	Altitude  float64          `json:"altitude"`
	Time      int64            `json:"time"`
	Ignition  *bool            `json:"ignition,omitempty"`
	EventIO   uint16           `json:"eventIo,omitempty"`
	// IO is the raw protocol IO map (Teltonika AVL IDs → value). Events-engine
	// uses it to detect harsh driving, sensor calibration, etc. Kept compact
	// (int values fit native JSON numbers).
	IO        map[string]int64 `json:"io,omitempty"`
}

// resolveDevice looks up the device by IMEI, caching the result for 5
// minutes in Redis. On a cache miss we fall through to Postgres. Devices
// that don't exist are also cached briefly (empty value) to avoid hot
// IMEI floods hammering Postgres.
func (s *Store) resolveDevice(ctx context.Context, imei string) (DeviceLookup, bool) {
	cacheKey := "ingestor:dev:" + imei
	if s.rdb != nil {
		if v, err := s.rdb.Get(ctx, cacheKey).Result(); err == nil {
			if v == "" {
				return DeviceLookup{}, false
			}
			var d DeviceLookup
			if err := json.Unmarshal([]byte(v), &d); err == nil && d.ID != "" {
				return d, true
			}
		}
	}

	var d DeviceLookup
	row := s.pg.QueryRow(ctx,
		`SELECT id::text, company_id::text FROM devices WHERE imei = $1 LIMIT 1`, imei)
	if err := row.Scan(&d.ID, &d.CompanyID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if s.rdb != nil {
				_ = s.rdb.Set(ctx, cacheKey, "", 30*time.Second).Err()
			}
			log.Debug().Str("imei", imei).Msg("unknown device, dropping")
			return d, false
		}
		log.Warn().Err(err).Msg("device lookup")
		return d, false
	}
	if s.rdb != nil {
		blob, _ := json.Marshal(d)
		_ = s.rdb.Set(ctx, cacheKey, blob, deviceCacheTTL).Err()
	}
	return d, true
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
		t                                 time.Time
		lat, lng                          float64
		speed, course, alt                float32
		ig                                *bool
		odo, hrs, bat                     *float64
	}
	latest := make(map[string]snap, len(rows))
	for _, r := range rows {
		s, ok := latest[r.DeviceID]
		if !ok || r.Time.After(s.t) {
			latest[r.DeviceID] = snap{
				t: r.Time, lat: r.Latitude, lng: r.Longitude,
				speed: r.Speed, course: r.Course, alt: r.Altitude,
				ig: r.Ignition, odo: r.OdometerKm, hrs: r.EngineHrs, bat: r.BatteryVolt,
			}
		}
	}
	batch := &pgx.Batch{}
	for id, sn := range latest {
		batch.Queue(
			`UPDATE devices SET
				last_seen_at = $2,
				last_lat = $3, last_lng = $4,
				last_speed = $5, last_course = $6, last_altitude = $7,
				ignition_on = COALESCE($8, ignition_on),
				odometer_km = COALESCE($9, odometer_km),
				engine_hours = COALESCE($10, engine_hours),
				battery_volt = COALESCE($11, battery_volt),
				updated_at = NOW()
			WHERE id = $1::uuid`,
			id, sn.t, sn.lat, sn.lng, sn.speed, sn.course, sn.alt,
			sn.ig, sn.odo, sn.hrs, sn.bat,
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

func isPlausible(r teltonika.Record) bool {
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

func buildAttributes(r teltonika.Record) []byte {
	if len(r.IO) == 0 {
		return nil
	}
	m := make(map[string]int64, len(r.IO)+1)
	for k, v := range r.IO {
		m[fmt.Sprintf("io_%d", k)] = v
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
