package config

import (
	"errors"
	"os"
	"strconv"
	"time"
)

type Config struct {
	TCPPort        int
	HealthPort     int
	MaxConnections int
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration

	DatabaseURL string
	RedisURL    string

	BatchSize         int
	BatchFlushTimeout time.Duration
	// QueueSize bounds the in-memory ingest channel between device goroutines
	// and the batcher. Bigger absorbs reconnect bursts; each slot is one
	// device's parsed record-set.
	QueueSize int
	// RawSampleN keeps 1-in-N raw_messages debug rows (1 = keep every record,
	// the historical behaviour). Raise it (e.g. 50) to cut raw_messages write
	// amplification on the hot path as device count grows.
	RawSampleN int

	LogLevel string
}

func Load() (*Config, error) {
	c := &Config{
		TCPPort:           getEnvInt("INGESTOR_TCP_PORT", 5027),
		HealthPort:        getEnvInt("INGESTOR_HEALTH_PORT", 9090),
		MaxConnections:    getEnvInt("INGESTOR_MAX_CONNECTIONS", 2000),
		ReadTimeout:       time.Duration(getEnvInt("INGESTOR_READ_TIMEOUT_SEC", 180)) * time.Second,
		WriteTimeout:      time.Duration(getEnvInt("INGESTOR_WRITE_TIMEOUT_SEC", 30)) * time.Second,
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		RedisURL:          os.Getenv("REDIS_URL"),
		BatchSize:         getEnvInt("INGESTOR_BATCH_SIZE", 500),
		BatchFlushTimeout: time.Duration(getEnvInt("INGESTOR_BATCH_FLUSH_MS", 1000)) * time.Millisecond,
		QueueSize:         getEnvInt("INGESTOR_QUEUE_SIZE", 16384),
		RawSampleN:        getEnvInt("INGESTOR_RAW_SAMPLE_N", 1),
		LogLevel:          getEnvString("LOG_LEVEL", "info"),
	}
	if c.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is required")
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
