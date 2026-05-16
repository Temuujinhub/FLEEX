// Package engine wires the events engine together: subscribe to the live
// positions Redis channel, evaluate each position against the active
// geofences for its company, and emit Event rows when a transition or
// overspeed condition is detected.
//
// State model
// -----------
// For each device, we keep:
//
//   - A "previously inside" set of geofence IDs in Redis. Diffing this against
//     the current evaluation gives us ENTER / EXIT transitions.
//   - An "initialized" flag in Redis. The very first position we see for a
//     device just seeds the inside-set without emitting events — otherwise
//     turning the engine on for the first time would flood the dashboard
//     with phantom ENTER events for every truck already inside a yard.
//   - Per-overspeed-scope cooldown keys (set NX with TTL) so a truck stuck
//     above the limit emits at most one event per minute per scope, not one
//     per GPS sample.
//
// The engine is stateless beyond Redis, so it can be killed and restarted
// without losing more than a single sample of accuracy.
package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/temuujinhub/fleex/services/events-engine/internal/config"
	"github.com/temuujinhub/fleex/services/events-engine/internal/store"
)

// LivePayload mirrors the JSON shape the gps-ingestor publishes on
// `fleex.positions`. We deliberately copy the struct rather than importing
// it from the ingestor so the two services can evolve independently.
type LivePayload struct {
	DeviceID  string  `json:"deviceId"`
	CompanyID string  `json:"companyId"`
	Imei      string  `json:"imei"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	Speed     float64 `json:"speed"`
	Course    float64 `json:"course"`
	Altitude  float64 `json:"altitude"`
	Time      int64   `json:"time"` // unix millis
	Ignition  *bool   `json:"ignition,omitempty"`
}

type Engine struct {
	cfg   *config.Config
	store *store.Store
}

func New(cfg *config.Config, st *store.Store) *Engine {
	return &Engine{cfg: cfg, store: st}
}

// Run subscribes to positions and processes them until ctx is canceled.
// One goroutine per engine — Redis Pub/Sub is single-threaded on the consumer
// side and that's fine for our throughput (a few thousand msg/s peak).
func (e *Engine) Run(ctx context.Context) error {
	pubsub := e.store.Redis().Subscribe(ctx, e.cfg.PositionsChannel)
	defer pubsub.Close()

	// Wait for the subscription handshake. Without this we can miss the first
	// few messages while the connection is still negotiating.
	if _, err := pubsub.Receive(ctx); err != nil {
		return fmt.Errorf("subscribe %s: %w", e.cfg.PositionsChannel, err)
	}
	log.Info().Str("channel", e.cfg.PositionsChannel).Msg("subscribed to positions")

	ch := pubsub.Channel(redis.WithChannelSize(1024))
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return fmt.Errorf("pubsub channel closed")
			}
			var p LivePayload
			if err := json.Unmarshal([]byte(msg.Payload), &p); err != nil {
				log.Debug().Err(err).Msg("decode position")
				continue
			}
			if err := e.process(ctx, &p); err != nil {
				log.Warn().Err(err).Str("device", p.DeviceID).Msg("process position")
			}
		}
	}
}

func (e *Engine) process(ctx context.Context, p *LivePayload) error {
	if p.DeviceID == "" || p.CompanyID == "" {
		return nil
	}

	fences := e.store.GeofencesFor(p.CompanyID)
	device := e.store.Device(p.DeviceID)

	// Compute current "inside" set + overspeed candidates in one pass.
	insideNow := make(map[string]bool, len(fences))
	overspeedFences := make([]*store.Geofence, 0)
	for _, g := range fences {
		if !g.Inside(p.Lat, p.Lng) {
			continue
		}
		insideNow[g.ID] = true
		if g.SpeedLimit != nil && *g.SpeedLimit > 0 && p.Speed > *g.SpeedLimit {
			overspeedFences = append(overspeedFences, g)
		}
	}

	prev, isFirst, err := e.store.LoadInsideSet(ctx, p.DeviceID)
	if err != nil {
		return fmt.Errorf("load inside set: %w", err)
	}
	if err := e.store.SaveInsideSet(ctx, p.DeviceID, insideNow); err != nil {
		log.Warn().Err(err).Msg("save inside set")
	}

	// Position-event timestamps come from the device clock. Falling back to
	// "now" on bogus zero-timestamps keeps the row valid.
	occurred := time.UnixMilli(p.Time)
	if occurred.IsZero() || occurred.Year() < 2000 {
		occurred = time.Now().UTC()
	}

	// First sighting: we seeded the state above, but we deliberately don't
	// emit transitions — see package doc.
	if isFirst {
		return nil
	}

	fenceByID := make(map[string]*store.Geofence, len(fences))
	for _, g := range fences {
		fenceByID[g.ID] = g
	}

	// ── ENTER events ─────────────────────────────────────────
	for id := range insideNow {
		if prev[id] {
			continue
		}
		g := fenceByID[id]
		if g == nil || !g.AlertOnEnter {
			continue
		}
		gid := g.ID
		if err := e.store.PersistAndPublish(ctx, store.EventInsert{
			CompanyID:  p.CompanyID,
			DeviceID:   p.DeviceID,
			GeofenceID: &gid,
			Type:       "GEOFENCE_ENTER",
			Severity:   "INFO",
			Lat:        p.Lat, Lng: p.Lng, Speed: p.Speed,
			Message:    fmt.Sprintf("%s бүсэд оров", g.Name),
			OccurredAt: occurred,
		}); err != nil {
			log.Warn().Err(err).Str("geofence", g.Name).Msg("persist ENTER")
		}
	}

	// ── EXIT events ──────────────────────────────────────────
	for id := range prev {
		if insideNow[id] {
			continue
		}
		g := fenceByID[id]
		// Fence was deleted or deactivated between samples — silently drop;
		// no transition can be meaningful without the fence definition.
		if g == nil || !g.AlertOnExit {
			continue
		}
		gid := g.ID
		if err := e.store.PersistAndPublish(ctx, store.EventInsert{
			CompanyID:  p.CompanyID,
			DeviceID:   p.DeviceID,
			GeofenceID: &gid,
			Type:       "GEOFENCE_EXIT",
			Severity:   "WARNING",
			Lat:        p.Lat, Lng: p.Lng, Speed: p.Speed,
			Message:    fmt.Sprintf("%s бүснээс гарав", g.Name),
			OccurredAt: occurred,
		}); err != nil {
			log.Warn().Err(err).Str("geofence", g.Name).Msg("persist EXIT")
		}
	}

	// ── OVERSPEED inside a fence ─────────────────────────────
	for _, g := range overspeedFences {
		allow, err := e.store.AllowOverspeed(ctx, p.DeviceID, g.ID)
		if err != nil {
			log.Warn().Err(err).Msg("overspeed cooldown")
			continue
		}
		if !allow {
			continue
		}
		gid := g.ID
		if err := e.store.PersistAndPublish(ctx, store.EventInsert{
			CompanyID:  p.CompanyID,
			DeviceID:   p.DeviceID,
			GeofenceID: &gid,
			Type:       "OVERSPEED",
			Severity:   "WARNING",
			Lat:        p.Lat, Lng: p.Lng, Speed: p.Speed,
			Message: fmt.Sprintf("%s бүсэд хурд хэтэрсэн: %.0f км/ц (хязгаар %.0f)",
				g.Name, p.Speed, *g.SpeedLimit),
			OccurredAt: occurred,
		}); err != nil {
			log.Warn().Err(err).Msg("persist OVERSPEED (fence)")
		}
	}

	// ── OVERSPEED against device-level limit ────────────────
	if device != nil && device.SpeedLimit != nil && *device.SpeedLimit > 0 && p.Speed > *device.SpeedLimit {
		allow, err := e.store.AllowOverspeed(ctx, p.DeviceID, "self")
		if err == nil && allow {
			if err := e.store.PersistAndPublish(ctx, store.EventInsert{
				CompanyID: p.CompanyID,
				DeviceID:  p.DeviceID,
				Type:      "OVERSPEED",
				Severity:  "WARNING",
				Lat:       p.Lat, Lng: p.Lng, Speed: p.Speed,
				Message: fmt.Sprintf("Хурд хэтэрсэн: %.0f км/ц (хязгаар %.0f)",
					p.Speed, *device.SpeedLimit),
				OccurredAt: occurred,
			}); err != nil {
				log.Warn().Err(err).Msg("persist OVERSPEED (device)")
			}
		}
	}

	return nil
}
