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

	LogLevel string
}

func Load() (*Config, error) {
	c := &Config{
		TCPPort:           getEnvInt("INGESTOR_TCP_PORT", 5027),
		HealthPort:        getEnvInt("INGESTOR_HEALTH_PORT", 9090),
		MaxConnections:    getEnvInt("INGESTOR_MAX_CONNECTIONS", 20000),
		ReadTimeout:       time.Duration(getEnvInt("INGESTOR_READ_TIMEOUT_SEC", 180)) * time.Second,
		WriteTimeout:      time.Duration(getEnvInt("INGESTOR_WRITE_TIMEOUT_SEC", 30)) * time.Second,
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		RedisURL:          os.Getenv("REDIS_URL"),
		BatchSize:         getEnvInt("INGESTOR_BATCH_SIZE", 500),
		BatchFlushTimeout: time.Duration(getEnvInt("INGESTOR_BATCH_FLUSH_MS", 1000)) * time.Millisecond,
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
