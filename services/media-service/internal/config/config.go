package config

import (
	"errors"
	"os"
	"strconv"
	"time"
)

type Config struct {
	// CamPort is the Teltonika DualCam file-transfer TCP port. Devices'
	// "Camera server" setting points here.
	CamPort      int
	HealthPort   int
	ReadTimeout  time.Duration
	WriteTimeout time.Duration

	// DataDir is the media volume. media-service writes blobs here; the API
	// mounts the same volume read-only and streams them after auth + tenant
	// checks. Move to object storage (S3/Spaces) at fleet scale.
	DataDir  string
	MaxFiles int // per-company retention cap; oldest rows + files pruned beyond this

	// MaxConnections caps concurrent DualCam connections so an attacker can't
	// exhaust FDs/goroutines/memory by opening unlimited sockets (audit H1).
	MaxConnections int
	// MaxFileBytes is a hard ceiling on a single reassembled file. DATA frames
	// carry a uint16 length, so packet-count alone doesn't bound size — this
	// does (audit H2).
	MaxFileBytes int
	// MaxFilesPerSession bounds how many files one connection can push, so a
	// malicious device can't loop forever thrashing disk (audit M1).
	MaxFilesPerSession int

	// AutoPull, when true, pulls a photo on every camera connection. Default
	// false = on-demand only (operator requests via the API), matching the
	// proven rig behaviour and saving bandwidth/storage.
	AutoPull bool

	DatabaseURL string
	RedisURL    string
	LogLevel    string
}

func Load() (*Config, error) {
	c := &Config{
		CamPort:            getEnvInt("MEDIA_CAM_PORT", 5029),
		HealthPort:         getEnvInt("MEDIA_HEALTH_PORT", 9092),
		ReadTimeout:        time.Duration(getEnvInt("MEDIA_READ_TIMEOUT_SEC", 120)) * time.Second,
		WriteTimeout:       time.Duration(getEnvInt("MEDIA_WRITE_TIMEOUT_SEC", 30)) * time.Second,
		DataDir:            getEnvString("MEDIA_DATA_DIR", "/data/media"),
		MaxFiles:           getEnvInt("MEDIA_MAX_FILES", 5000),
		MaxConnections:     getEnvInt("MEDIA_MAX_CONNECTIONS", 256),
		MaxFileBytes:       getEnvInt("MEDIA_MAX_FILE_BYTES", 64*1024*1024),
		MaxFilesPerSession: getEnvInt("MEDIA_MAX_FILES_PER_SESSION", 20),
		AutoPull:           getEnvBool("MEDIA_AUTO_PULL", false),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		RedisURL:           os.Getenv("REDIS_URL"),
		LogLevel:           getEnvString("LOG_LEVEL", "info"),
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

func getEnvBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
