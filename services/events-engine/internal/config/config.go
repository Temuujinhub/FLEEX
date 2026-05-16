// Package config loads environment-driven runtime configuration. Mirrors the
// gps-ingestor's config package so the two services feel familiar.
package config

import (
	"errors"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HealthPort int

	DatabaseURL string
	RedisURL    string

	// Redis pub/sub channels.
	PositionsChannel string
	EventsChannel    string

	// How often we refresh the in-memory geofence / device cache from Postgres.
	// Changes made through the API show up within this window.
	CacheRefreshInterval time.Duration

	// OVERSPEED events are rate-limited per (device, scope) pair so a single
	// truck doing 80 km/h doesn't flood the table with thousands of rows. The
	// engine emits at most one event per scope per cooldown window.
	OverspeedCooldown time.Duration

	// How long the per-device "inside which geofences" set is kept in Redis.
	// On expiry, the engine treats the next position as a fresh start (no
	// false ENTER events), which is the correct behaviour after long offline
	// periods.
	InsideSetTTL time.Duration

	LogLevel string
}

func Load() (*Config, error) {
	c := &Config{
		HealthPort:           getEnvInt("ENGINE_HEALTH_PORT", 9091),
		DatabaseURL:          os.Getenv("DATABASE_URL"),
		RedisURL:             os.Getenv("REDIS_URL"),
		PositionsChannel:     getEnvString("ENGINE_POSITIONS_CHANNEL", "fleex.positions"),
		EventsChannel:        getEnvString("ENGINE_EVENTS_CHANNEL", "fleex.events"),
		CacheRefreshInterval: time.Duration(getEnvInt("ENGINE_CACHE_REFRESH_SEC", 30)) * time.Second,
		OverspeedCooldown:    time.Duration(getEnvInt("ENGINE_OVERSPEED_COOLDOWN_SEC", 60)) * time.Second,
		InsideSetTTL:         time.Duration(getEnvInt("ENGINE_INSIDE_SET_TTL_SEC", 86400)) * time.Second,
		LogLevel:             getEnvString("LOG_LEVEL", "info"),
	}
	if c.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	if c.RedisURL == "" {
		return nil, errors.New("REDIS_URL is required")
	}
	return c, nil
}

func getEnvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getEnvString(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
