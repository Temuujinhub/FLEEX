// Periodic health-check evaluator. Runs every cfg.HealthEvalInterval (1
// minute by default) — reads the active DeviceHealthRule rows and folds
// them against the latest device telemetry snapshot to produce a single
// DeviceHealthStatus row per device. The dashboard donut reads from
// that table directly.

package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// RunHealthLoop loops until ctx is canceled, re-evaluating every minute.
// Kept simple and stateless — each tick is independent.
func (e *Engine) RunHealthLoop(ctx context.Context) {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	// First evaluation eagerly so a freshly booted engine isn't blind for
	// the first minute.
	_ = e.evaluateHealth(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := e.evaluateHealth(ctx); err != nil {
				log.Warn().Err(err).Msg("health eval")
			}
		}
	}
}

type rule struct {
	id        string
	companyID string
	name      string
	check     string
	threshold float64
	severity  string
}

type devSnap struct {
	id          string
	lastSeenAt  *time.Time
	batteryVolt *float64
	satellites  *int
	ignitionAt  *time.Time
	ignitionOn  *bool
}

func (e *Engine) evaluateHealth(ctx context.Context) error {
	pg := e.store.PG()
	// Pull all active rules grouped by company.
	rows, err := pg.Query(ctx, `
		SELECT id::text, "companyId"::text, name, "check", threshold, severity
		FROM device_health_rules
		WHERE active = true
	`)
	if err != nil {
		return fmt.Errorf("query rules: %w", err)
	}
	rulesByCo := map[string][]rule{}
	for rows.Next() {
		var r rule
		if err := rows.Scan(&r.id, &r.companyID, &r.name, &r.check, &r.threshold, &r.severity); err != nil {
			rows.Close()
			return err
		}
		rulesByCo[r.companyID] = append(rulesByCo[r.companyID], r)
	}
	rows.Close()
	if len(rulesByCo) == 0 {
		return nil
	}

	// Pull every device snapshot we might need. The set is small (one row
	// per device) so a single query is fine.
	dRows, err := pg.Query(ctx, `
		SELECT id::text, "companyId"::text, "lastSeenAt", "batteryVolt", "ignitionOn"
		FROM devices
	`)
	if err != nil {
		return fmt.Errorf("query devices: %w", err)
	}
	now := time.Now().UTC()
	type devLite struct {
		coId        string
		lastSeenAt  *time.Time
		batteryVolt *float64
		ignitionOn  *bool
	}
	all := map[string]devLite{}
	for dRows.Next() {
		var id, coId string
		var lsa *time.Time
		var bv *float64
		var ign *bool
		if err := dRows.Scan(&id, &coId, &lsa, &bv, &ign); err != nil {
			dRows.Close()
			return err
		}
		all[id] = devLite{coId: coId, lastSeenAt: lsa, batteryVolt: bv, ignitionOn: ign}
	}
	dRows.Close()

	// Evaluate every device, even those without an explicit snapshot —
	// they get state UNKNOWN.
	batch := &pgx.Batch{}
	for devID, d := range all {
		rs := rulesByCo[d.coId]
		state := "HEALTHY"
		diagnoses := make([]map[string]any, 0)
		if len(rs) == 0 {
			state = "UNKNOWN"
		}
		for _, r := range rs {
			if hit, msg := evaluateRule(r, d.lastSeenAt, d.batteryVolt, now); hit {
				diagnoses = append(diagnoses, map[string]any{
					"rule":     r.name,
					"check":    r.check,
					"severity": r.severity,
					"message":  msg,
					"since":    now.Format(time.RFC3339),
				})
				if r.severity == "CRITICAL" {
					state = "UNHEALTHY"
				} else if state != "UNHEALTHY" {
					state = "WARNING"
				}
			}
		}
		diagJSON, _ := json.Marshal(diagnoses)
		batch.Queue(`
			INSERT INTO device_health_status ("deviceId", state, diagnoses, "evaluatedAt")
			VALUES ($1::uuid, $2::"DeviceHealthState", $3::jsonb, $4)
			ON CONFLICT ("deviceId")
			DO UPDATE SET state = EXCLUDED.state, diagnoses = EXCLUDED.diagnoses, "evaluatedAt" = EXCLUDED."evaluatedAt"
		`, devID, state, diagJSON, now)
	}
	br := pg.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < batch.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			log.Debug().Err(err).Msg("health upsert")
		}
	}
	return nil
}

func evaluateRule(r rule, lastSeenAt *time.Time, batteryVolt *float64, now time.Time) (bool, string) {
	switch r.check {
	case "OFFLINE_GT":
		if lastSeenAt == nil {
			return true, "Сүүлд харагдсан мэдээлэл байхгүй"
		}
		mins := now.Sub(*lastSeenAt).Minutes()
		if mins > r.threshold {
			return true, fmt.Sprintf("%.0f минут офлайн (хязгаар: %.0f)", mins, r.threshold)
		}
	case "VOLTAGE_LT":
		if batteryVolt != nil && *batteryVolt < r.threshold {
			return true, fmt.Sprintf("Хүчдэл %.1fV (хязгаар: %.1fV)", *batteryVolt, r.threshold)
		}
	case "GPS_FIX_LT":
		// We don't store satellites on the device snapshot today — leaving
		// this branch as a no-op until the schema captures it.
		return false, ""
	case "IGNITION_STALE":
		// Same — needs an ignition_changed_at column; deferred.
		return false, ""
	}
	return false, ""
}
