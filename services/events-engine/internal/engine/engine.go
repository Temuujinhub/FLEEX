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
// it from the ingestor so the two services can evolve independently. The
// `EventIO` + `IO` map carry the raw protocol-level signals so the
// engine can detect harsh driving, sensor states etc. without another DB
// hop.
type LivePayload struct {
	DeviceID  string           `json:"deviceId"`
	CompanyID string           `json:"companyId"`
	Imei      string           `json:"imei"`
	Lat       float64          `json:"lat"`
	Lng       float64          `json:"lng"`
	Speed     float64          `json:"speed"`
	Course    float64          `json:"course"`
	Altitude  float64          `json:"altitude"`
	Time      int64            `json:"time"` // unix millis
	Ignition  *bool            `json:"ignition,omitempty"`
	EventIO   uint16           `json:"eventIo,omitempty"`
	IO        map[string]int64 `json:"io,omitempty"`
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

	// ── Harsh driving / power / tamper events from EventIO + IO map ──
	e.emitIoEvents(ctx, p, occurred)

	// ── Ignition transition → trip start / end ───────────────
	e.handleIgnition(ctx, p, occurred)

	// Fallback trip detection — when the device doesn't report ignition
	// at all (the operator hasn't enabled io_239 in the Teltonika
	// permanent IO list, or the hardware doesn't expose it), keep trip
	// records alive from movement alone.
	if p.Ignition == nil {
		e.handleMovementTrip(ctx, p, occurred)
	}

	return nil
}

// Teltonika AVL IDs that flag specific events. We translate them to our
// own EventType enum and emit one row per occurrence. The cooldown key
// per (device, ioId) ensures that a stuck-true flag doesn't produce
// one event per packet.
const (
	ioGreenDriving = "253"
	ioOverspeeding = "255"
	ioCrashDetect  = "257"
	ioTowing       = "246"
	ioJamming      = "247"
	ioPowerCut     = "252"
	ioIgnition     = "239"
	ioExternalVolt = "66"
)

func (e *Engine) emitIoEvents(ctx context.Context, p *LivePayload, occurred time.Time) {
	if len(p.IO) == 0 && p.EventIO == 0 {
		return
	}
	// Green driving: 1=harsh accel, 2=harsh brake, 3=harsh corner. We
	// reuse the cooldown machinery to dampen sticky values.
	if v, ok := p.IO[ioGreenDriving]; ok && v > 0 {
		var typ, msg, sev string
		switch v {
		case 1:
			typ, sev, msg = "HARSH_ACCEL", "WARNING", "Гэнэт хурдалсан"
		case 2:
			typ, sev, msg = "HARSH_BRAKE", "WARNING", "Гэнэт тоормосолсон"
		case 3:
			typ, sev, msg = "HARSH_CORNER", "WARNING", "Гэнэт эргэсэн"
		}
		if typ != "" {
			e.emitOnce(ctx, p, occurred, typ, sev, msg, "harsh"+typ)
		}
	}
	if v, ok := p.IO[ioCrashDetect]; ok && v != 0 {
		e.emitOnce(ctx, p, occurred, "CUSTOM", "CRITICAL", "Хүчтэй цохилт илрэв", "crash")
	}
	if v, ok := p.IO[ioJamming]; ok && v != 0 {
		e.emitOnce(ctx, p, occurred, "TAMPER", "CRITICAL", "GSM jamming илрэв", "jamming")
	}
	if v, ok := p.IO[ioTowing]; ok && v != 0 {
		e.emitOnce(ctx, p, occurred, "TAMPER", "WARNING", "Чирүүлэлт илрэв", "towing")
	}
	if v, ok := p.IO[ioPowerCut]; ok && v != 0 {
		e.emitOnce(ctx, p, occurred, "POWER_CUT", "CRITICAL", "Гадаад тэжээл салсан", "powercut")
	}
	// Low battery: external voltage < 11.5V (in millivolts in the AVL field).
	if v, ok := p.IO[ioExternalVolt]; ok && v > 0 && v < 11500 {
		e.emitOnce(ctx, p, occurred, "LOW_BATTERY", "WARNING",
			fmt.Sprintf("Хүчдэл бага: %.1fV", float64(v)/1000.0), "lowbat")
	}
}

// emitOnce wraps PersistAndPublish with a per-device, per-scope cooldown so
// the same condition doesn't flood the events table.
func (e *Engine) emitOnce(ctx context.Context, p *LivePayload, occurred time.Time, typ, sev, msg, scope string) {
	allow, err := e.store.AllowEvent(ctx, p.DeviceID, scope)
	if err != nil || !allow {
		return
	}
	if err := e.store.PersistAndPublish(ctx, store.EventInsert{
		CompanyID: p.CompanyID,
		DeviceID:  p.DeviceID,
		Type:      typ,
		Severity:  sev,
		Lat:       p.Lat, Lng: p.Lng, Speed: p.Speed,
		Message:    msg,
		OccurredAt: occurred,
	}); err != nil {
		log.Warn().Err(err).Str("type", typ).Msg("persist io event")
	}
}

// handleMovementTrip is the fallback path when ignition isn't reported.
// It opens a trip when the vehicle moves above 5 km/h and closes it
// after ~6 minutes of idleness (speed < 2 km/h). State is in Redis with
// a self-expiring "moving" key; a position with speed > 5 refreshes the
// TTL, and the absence of the key after a slow position is the signal
// to end the trip.
const movementSpeedKmh = 5.0
const idleSpeedKmh = 2.0
const movingKeyTTL = 6 * time.Minute

func (e *Engine) handleMovementTrip(ctx context.Context, p *LivePayload, occurred time.Time) {
	if p.Speed >= movementSpeedKmh {
		// Vehicle is moving — refresh the TTL and make sure a trip is open.
		if err := e.store.MarkMoving(ctx, p.DeviceID, movingKeyTTL); err != nil {
			log.Debug().Err(err).Msg("mark moving")
		}
		if err := e.store.StartTrip(ctx, p.CompanyID, p.DeviceID, occurred, p.Lat, p.Lng); err != nil {
			log.Debug().Err(err).Msg("movement-based start trip")
		}
		return
	}
	if p.Speed <= idleSpeedKmh {
		// Idle. The TTL on the moving key (6 min) lapsing is our signal
		// that this idleness is long enough to count as trip end.
		moving, err := e.store.IsMoving(ctx, p.DeviceID)
		if err != nil {
			log.Debug().Err(err).Msg("is moving")
			return
		}
		if !moving {
			if err := e.store.EndTrip(ctx, p.DeviceID, occurred, p.Lat, p.Lng); err != nil {
				log.Debug().Err(err).Msg("movement-based end trip")
			}
		}
	}
}

// handleIgnition watches ignition transitions to drive trip-start /
// trip-end. State is persisted to Redis so a restart doesn't replay the
// transitions.
func (e *Engine) handleIgnition(ctx context.Context, p *LivePayload, occurred time.Time) {
	if p.Ignition == nil {
		return
	}
	prev, known, err := e.store.LoadIgnition(ctx, p.DeviceID)
	if err != nil {
		log.Debug().Err(err).Msg("load ignition")
		return
	}
	if err := e.store.SaveIgnition(ctx, p.DeviceID, *p.Ignition); err != nil {
		log.Debug().Err(err).Msg("save ignition")
	}
	if !known {
		return
	}
	if prev == *p.Ignition {
		return
	}
	if *p.Ignition {
		// Off → On: trip start.
		if err := e.store.StartTrip(ctx, p.CompanyID, p.DeviceID, occurred, p.Lat, p.Lng); err != nil {
			log.Warn().Err(err).Msg("start trip")
		}
		_ = e.store.PersistAndPublish(ctx, store.EventInsert{
			CompanyID: p.CompanyID, DeviceID: p.DeviceID,
			Type: "IGNITION_ON", Severity: "INFO",
			Lat: p.Lat, Lng: p.Lng, Speed: p.Speed,
			Message: "Хөдөлгүүр асав", OccurredAt: occurred,
		})
	} else {
		// On → Off: trip end.
		if err := e.store.EndTrip(ctx, p.DeviceID, occurred, p.Lat, p.Lng); err != nil {
			log.Warn().Err(err).Msg("end trip")
		}
		_ = e.store.PersistAndPublish(ctx, store.EventInsert{
			CompanyID: p.CompanyID, DeviceID: p.DeviceID,
			Type: "IGNITION_OFF", Severity: "INFO",
			Lat: p.Lat, Lng: p.Lng, Speed: p.Speed,
			Message: "Хөдөлгүүр унтрав", OccurredAt: occurred,
		})
	}
}
