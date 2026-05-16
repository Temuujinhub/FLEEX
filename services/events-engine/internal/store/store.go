// Package store is the engine's data access layer.
//
//   - Reads geofences + devices from Postgres into an in-memory cache that
//     refreshes on a timer. Per-position lookups don't touch the DB.
//   - Writes Event rows to Postgres on geofence transitions / overspeed.
//   - Tracks per-device "inside which geofences" sets and overspeed cooldowns
//     in Redis — survives restarts and keeps multiple engine replicas roughly
//     consistent (each replica reads the same Redis state).
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/temuujinhub/fleex/services/events-engine/internal/config"
	"github.com/temuujinhub/fleex/services/events-engine/internal/geo"
)

// Geofence is the cached form of a geofence row. `Polygon` is populated only
// for POLYGON shape; CenterLat/CenterLng/RadiusM only for CIRCLE.
type Geofence struct {
	ID           string
	CompanyID    string
	Name         string
	Shape        string
	CenterLat    float64
	CenterLng    float64
	RadiusM      float64
	Polygon      [][2]float64
	SpeedLimit   *float64
	AlertOnEnter bool
	AlertOnExit  bool
}

// Inside checks whether the given (lat,lng) is inside this geofence.
func (g *Geofence) Inside(lat, lng float64) bool {
	switch g.Shape {
	case "CIRCLE":
		return geo.HaversineM(lat, lng, g.CenterLat, g.CenterLng) <= g.RadiusM
	case "POLYGON":
		return geo.PointInPolygon(lng, lat, g.Polygon)
	default:
		return false
	}
}

// Device is the cached form of a device row — only what the engine needs.
type Device struct {
	ID         string
	CompanyID  string
	Name       string
	SpeedLimit *float64
}

type Store struct {
	cfg *config.Config
	pg  *pgxpool.Pool
	rdb *redis.Client

	mu              sync.RWMutex
	geofencesByCo   map[string][]*Geofence
	devicesByID     map[string]*Device
	lastCacheReload time.Time

	healthy        atomic.Bool
	eventsEmitted  atomic.Uint64
	cacheRefreshes atomic.Uint64
}

// New connects to Postgres + Redis and does one synchronous cache load before
// returning. If the initial load fails the engine refuses to start — better
// to die loudly than run blind.
func New(ctx context.Context, cfg *config.Config) (*Store, error) {
	pgCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse db url: %w", err)
	}
	pgCfg.MaxConns = 8
	pgCfg.MinConns = 1
	pgCfg.MaxConnLifetime = 30 * time.Minute
	pgCfg.HealthCheckPeriod = 30 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, pgCfg)
	if err != nil {
		return nil, fmt.Errorf("pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pg ping: %w", err)
	}

	rdbOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	rdb := redis.NewClient(rdbOpts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		pool.Close()
		_ = rdb.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}

	s := &Store{
		cfg:           cfg,
		pg:            pool,
		rdb:           rdb,
		geofencesByCo: map[string][]*Geofence{},
		devicesByID:   map[string]*Device{},
	}
	if err := s.Refresh(ctx); err != nil {
		s.Close()
		return nil, fmt.Errorf("initial cache load: %w", err)
	}
	s.healthy.Store(true)
	return s, nil
}

func (s *Store) Close() {
	if s.pg != nil {
		s.pg.Close()
	}
	if s.rdb != nil {
		_ = s.rdb.Close()
	}
}

// Healthy returns true once the engine has a usable cache and live DB/Redis
// connections. Health endpoint reports on this.
func (s *Store) Healthy() bool { return s.healthy.Load() }

// Redis exposes the underlying Redis client so the engine can subscribe to
// the positions channel and publish to the events channel.
func (s *Store) Redis() *redis.Client { return s.rdb }

// Stats counters for /metrics.
func (s *Store) Stats() (eventsEmitted, cacheRefreshes uint64) {
	return s.eventsEmitted.Load(), s.cacheRefreshes.Load()
}

// RunRefreshLoop periodically reloads the geofence + device cache. Stops when
// the context is canceled.
func (s *Store) RunRefreshLoop(ctx context.Context) {
	t := time.NewTicker(s.cfg.CacheRefreshInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := s.Refresh(ctx); err != nil {
				log.Warn().Err(err).Msg("cache refresh failed")
			}
		}
	}
}

// Refresh reloads geofences + devices from Postgres in one transaction so we
// see a consistent snapshot.
func (s *Store) Refresh(ctx context.Context) error {
	tx, err := s.pg.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// ── Geofences ────────────────────────────────────────────
	gRows, err := tx.Query(ctx, `
		SELECT id::text, "companyId"::text, name, shape::text,
		       geometry, "speedLimit", "alertOnEnter", "alertOnExit"
		FROM geofences
		WHERE active = true
	`)
	if err != nil {
		return fmt.Errorf("query geofences: %w", err)
	}
	byCo := map[string][]*Geofence{}
	for gRows.Next() {
		var (
			id, companyID, name, shape string
			geom                       []byte
			speedLimit                 *float64
			alertOnEnter, alertOnExit  bool
		)
		if err := gRows.Scan(&id, &companyID, &name, &shape, &geom, &speedLimit, &alertOnEnter, &alertOnExit); err != nil {
			gRows.Close()
			return fmt.Errorf("scan geofence: %w", err)
		}
		gf := &Geofence{
			ID: id, CompanyID: companyID, Name: name, Shape: shape,
			SpeedLimit: speedLimit, AlertOnEnter: alertOnEnter, AlertOnExit: alertOnExit,
		}
		if err := parseGeometry(geom, gf); err != nil {
			log.Warn().Err(err).Str("geofence", id).Msg("invalid geometry, skipping")
			continue
		}
		byCo[companyID] = append(byCo[companyID], gf)
	}
	gRows.Close()

	// ── Devices ──────────────────────────────────────────────
	dRows, err := tx.Query(ctx, `
		SELECT id::text, "companyId"::text, name, "speedLimit"
		FROM devices
	`)
	if err != nil {
		return fmt.Errorf("query devices: %w", err)
	}
	devs := map[string]*Device{}
	for dRows.Next() {
		var d Device
		if err := dRows.Scan(&d.ID, &d.CompanyID, &d.Name, &d.SpeedLimit); err != nil {
			dRows.Close()
			return fmt.Errorf("scan device: %w", err)
		}
		devs[d.ID] = &d
	}
	dRows.Close()

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	s.mu.Lock()
	s.geofencesByCo = byCo
	s.devicesByID = devs
	s.lastCacheReload = time.Now()
	s.mu.Unlock()
	s.cacheRefreshes.Add(1)
	log.Debug().Int("geofences", countAll(byCo)).Int("devices", len(devs)).Msg("cache refreshed")
	return nil
}

// GeofencesFor returns the cached active geofences for a company. Caller
// receives a snapshot — safe to iterate without holding the lock.
func (s *Store) GeofencesFor(companyID string) []*Geofence {
	s.mu.RLock()
	defer s.mu.RUnlock()
	src := s.geofencesByCo[companyID]
	if len(src) == 0 {
		return nil
	}
	out := make([]*Geofence, len(src))
	copy(out, src)
	return out
}

// Device returns the cached device. Returns nil when the device was created
// after the last cache refresh — the engine treats that as "unknown" and
// skips evaluation until the next refresh picks it up.
func (s *Store) Device(deviceID string) *Device {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.devicesByID[deviceID]
}

// EventInsert is the row we INSERT for each emitted event. Lat/Lng/Speed are
// from the triggering position; GeofenceID is non-nil for fence transitions
// and for overspeed-inside-fence events.
type EventInsert struct {
	CompanyID  string
	DeviceID   string
	GeofenceID *string
	Type       string
	Severity   string
	Lat        float64
	Lng        float64
	Speed      float64
	Message    string
	OccurredAt time.Time
}

// PersistAndPublish inserts the event and republishes it on the events channel
// so the API's WebSocket gateway can fan it out to dashboards in real time.
func (s *Store) PersistAndPublish(ctx context.Context, e EventInsert) error {
	var id int64
	err := s.pg.QueryRow(ctx, `
		INSERT INTO events
		  ("companyId", "deviceId", "geofenceId", type, severity, lat, lng, speed, message, "occurredAt")
		VALUES
		  ($1::uuid, $2::uuid, $3::uuid, $4::"EventType", $5::"EventSeverity", $6, $7, $8, $9, $10)
		RETURNING id
	`, e.CompanyID, e.DeviceID, nullableUUID(e.GeofenceID), e.Type, e.Severity,
		e.Lat, e.Lng, e.Speed, e.Message, e.OccurredAt).Scan(&id)
	if err != nil {
		return fmt.Errorf("insert event: %w", err)
	}

	// Publish a small JSON envelope. We deliberately stringify the bigint id
	// because the API's WS clients are JS and JSON has no 64-bit ints.
	payload, _ := json.Marshal(map[string]any{
		"id":         fmt.Sprintf("%d", id),
		"companyId":  e.CompanyID,
		"deviceId":   e.DeviceID,
		"geofenceId": e.GeofenceID,
		"type":       e.Type,
		"severity":   e.Severity,
		"lat":        e.Lat,
		"lng":        e.Lng,
		"speed":      e.Speed,
		"message":    e.Message,
		"occurredAt": e.OccurredAt.UTC().Format(time.RFC3339Nano),
	})
	if err := s.rdb.Publish(ctx, s.cfg.EventsChannel, payload).Err(); err != nil {
		log.Warn().Err(err).Msg("publish event")
	}
	s.eventsEmitted.Add(1)
	return nil
}

// LoadInsideSet returns the set of geofence IDs the device was previously
// inside, along with a flag indicating whether this is the device's first
// evaluation (so the caller can skip emitting spurious ENTER events).
func (s *Store) LoadInsideSet(ctx context.Context, deviceID string) (map[string]bool, bool, error) {
	key := insideKey(deviceID)
	initKey := initKey(deviceID)
	initialized, err := s.rdb.Exists(ctx, initKey).Result()
	if err != nil {
		return nil, false, err
	}
	members, err := s.rdb.SMembers(ctx, key).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, false, err
	}
	prev := make(map[string]bool, len(members))
	for _, m := range members {
		prev[m] = true
	}
	return prev, initialized == 0, nil
}

// SaveInsideSet replaces the device's inside-set with `now`, and marks the
// device as initialized so subsequent evaluations emit transitions.
func (s *Store) SaveInsideSet(ctx context.Context, deviceID string, now map[string]bool) error {
	key := insideKey(deviceID)
	initK := initKey(deviceID)
	pipe := s.rdb.Pipeline()
	pipe.Del(ctx, key)
	if len(now) > 0 {
		members := make([]interface{}, 0, len(now))
		for id := range now {
			members = append(members, id)
		}
		pipe.SAdd(ctx, key, members...)
	}
	pipe.Expire(ctx, key, s.cfg.InsideSetTTL)
	// init flag lives 7× as long as the inside-set so a stale device that
	// reconnects after a weekend doesn't replay enter events.
	pipe.Set(ctx, initK, "1", 7*s.cfg.InsideSetTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// AllowOverspeed returns true on the first call within the cooldown window
// for a given (deviceID, scope) pair, false otherwise. `scope` is the
// geofence ID for fence-relative limits, or "self" for the device's own
// speedLimit override.
func (s *Store) AllowOverspeed(ctx context.Context, deviceID, scope string) (bool, error) {
	key := fmt.Sprintf("fleex.overspeed.last:%s:%s", deviceID, scope)
	ok, err := s.rdb.SetNX(ctx, key, "1", s.cfg.OverspeedCooldown).Result()
	if err != nil {
		return false, err
	}
	return ok, nil
}

// ── helpers ─────────────────────────────────────────────────

func insideKey(deviceID string) string { return "fleex.geo.inside:" + deviceID }
func initKey(deviceID string) string   { return "fleex.geo.init:" + deviceID }

func nullableUUID(s *string) interface{} {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

func countAll(m map[string][]*Geofence) int {
	n := 0
	for _, v := range m {
		n += len(v)
	}
	return n
}

// parseGeometry turns the JSONB geometry blob into the right struct fields.
// CIRCLE: { lat, lng, radiusM }. POLYGON: { points: [[lng,lat], ...] }.
func parseGeometry(raw []byte, g *Geofence) error {
	switch g.Shape {
	case "CIRCLE":
		var v struct {
			Lat     float64 `json:"lat"`
			Lng     float64 `json:"lng"`
			RadiusM float64 `json:"radiusM"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			return err
		}
		if v.RadiusM <= 0 {
			return errors.New("circle radius must be > 0")
		}
		g.CenterLat, g.CenterLng, g.RadiusM = v.Lat, v.Lng, v.RadiusM
		return nil
	case "POLYGON":
		var v struct {
			Points [][]float64 `json:"points"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			return err
		}
		if len(v.Points) < 3 {
			return errors.New("polygon needs >= 3 points")
		}
		pts := make([][2]float64, 0, len(v.Points))
		for _, p := range v.Points {
			if len(p) != 2 {
				return errors.New("each point must be [lng,lat]")
			}
			pts = append(pts, [2]float64{p[0], p[1]})
		}
		g.Polygon = pts
		return nil
	default:
		return fmt.Errorf("unknown shape %q", g.Shape)
	}
}
