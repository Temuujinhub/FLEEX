package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	TCPPort        int
	HealthPort     int
	MaxConnections int
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration

	// ProtocolPorts maps a protocol name to the TCP port it listens on
	// (INGESTOR_PROTOCOL_PORTS="teltonika:5027,queclink:5028"). When unset it
	// defaults to {teltonika: TCPPort} so existing single-protocol deployments
	// are unchanged. Each protocol must have a registered decoder.
	ProtocolPorts map[string]int

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

	// VerifyCRC, when true, drops AVL frames whose CRC-16/IBM does not match
	// (the device re-sends, so no data loss). Default false: the mismatch is
	// only counted (fleex_ingestor_crc_errors_total) so operators can confirm
	// a ~0 false-positive rate against real hardware before enforcing.
	VerifyCRC bool

	// RequireRegisteredDevice, when true (default), rejects the IMEI handshake
	// for devices not present in the database, so a spoofed/unknown IMEI can't
	// hold a connection or probe the fleet (audit R-4). A transient DB lookup
	// failure fails open (accept) so a blip can't lock out the whole fleet.
	// Set INGESTOR_REQUIRE_REGISTERED_DEVICE=false to revert to accept-all.
	RequireRegisteredDevice bool

	LogLevel string
}

func Load() (*Config, error) {
	c := &Config{
		TCPPort:                 getEnvInt("INGESTOR_TCP_PORT", 5027),
		HealthPort:              getEnvInt("INGESTOR_HEALTH_PORT", 9090),
		MaxConnections:          getEnvInt("INGESTOR_MAX_CONNECTIONS", 2000),
		ReadTimeout:             time.Duration(getEnvInt("INGESTOR_READ_TIMEOUT_SEC", 180)) * time.Second,
		WriteTimeout:            time.Duration(getEnvInt("INGESTOR_WRITE_TIMEOUT_SEC", 30)) * time.Second,
		DatabaseURL:             os.Getenv("DATABASE_URL"),
		RedisURL:                os.Getenv("REDIS_URL"),
		BatchSize:               getEnvInt("INGESTOR_BATCH_SIZE", 500),
		BatchFlushTimeout:       time.Duration(getEnvInt("INGESTOR_BATCH_FLUSH_MS", 1000)) * time.Millisecond,
		QueueSize:               getEnvInt("INGESTOR_QUEUE_SIZE", 16384),
		RawSampleN:              getEnvInt("INGESTOR_RAW_SAMPLE_N", 1),
		VerifyCRC:               getEnvBool("INGESTOR_VERIFY_CRC", false),
		RequireRegisteredDevice: getEnvBool("INGESTOR_REQUIRE_REGISTERED_DEVICE", true),
		LogLevel:                getEnvString("LOG_LEVEL", "info"),
	}
	if c.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	ports, err := parseProtocolPorts(os.Getenv("INGESTOR_PROTOCOL_PORTS"), c.TCPPort)
	if err != nil {
		return nil, err
	}
	c.ProtocolPorts = ports
	return c, nil
}

// parseProtocolPorts reads "name:port,name:port" into a map. An empty value
// falls back to the legacy single Teltonika listener on tcpPort so existing
// deployments keep working without the new env var.
func parseProtocolPorts(raw string, tcpPort int) (map[string]int, error) {
	out := map[string]int{}
	if strings.TrimSpace(raw) == "" {
		out["teltonika"] = tcpPort
		return out, nil
	}
	for _, pair := range strings.Split(raw, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		name, portStr, ok := strings.Cut(pair, ":")
		name = strings.TrimSpace(name)
		if !ok || name == "" {
			return nil, fmt.Errorf("bad INGESTOR_PROTOCOL_PORTS entry %q (want name:port)", pair)
		}
		port, err := strconv.Atoi(strings.TrimSpace(portStr))
		if err != nil || port < 1 || port > 65535 {
			return nil, fmt.Errorf("bad port in INGESTOR_PROTOCOL_PORTS entry %q", pair)
		}
		if _, dup := out[name]; dup {
			return nil, fmt.Errorf("duplicate protocol %q in INGESTOR_PROTOCOL_PORTS", name)
		}
		out[name] = port
	}
	if len(out) == 0 {
		return nil, errors.New("INGESTOR_PROTOCOL_PORTS has no valid entries")
	}
	return out, nil
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
