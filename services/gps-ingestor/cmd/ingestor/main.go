// Command ingestor is the GPS device-facing TCP server. It speaks the
// Teltonika Codec 8 / Codec 8 Extended protocols, persists positions to
// TimescaleDB in batched copies, and fans them out to Redis Pub/Sub for the
// API's WebSocket layer to forward to dashboards.
package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/config"
	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/store"
	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/teltonika"
)

func main() {
	zerolog.TimeFieldFormat = time.RFC3339Nano
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("config")
	}
	if cfg.LogLevel != "" {
		if lvl, err := zerolog.ParseLevel(cfg.LogLevel); err == nil {
			zerolog.SetGlobalLevel(lvl)
		}
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	st, err := store.New(ctx, cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("store init")
	}
	defer st.Close()

	go st.Run(ctx)

	srv := &server{cfg: cfg, store: st}
	go srv.runHealth(ctx)

	if err := srv.runTCP(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Error().Err(err).Msg("tcp server exited")
	}
	log.Info().Msg("ingestor stopped")
}

type server struct {
	cfg         *config.Config
	store       *store.Store
	activeConns atomic.Int64
	totalConns  atomic.Uint64
	totalMsgs   atomic.Uint64
	parseErrors atomic.Uint64
}

func (s *server) runTCP(ctx context.Context) error {
	addr := fmt.Sprintf(":%d", s.cfg.TCPPort)
	lc := net.ListenConfig{KeepAlive: 30 * time.Second}
	l, err := lc.Listen(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}
	defer l.Close()
	log.Info().Str("addr", addr).Msg("teltonika tcp listening")

	go func() {
		<-ctx.Done()
		_ = l.Close()
	}()

	for {
		conn, err := l.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			log.Warn().Err(err).Msg("accept")
			time.Sleep(100 * time.Millisecond)
			continue
		}

		// Reject if we're already at the configured connection ceiling. This
		// prevents OOM under SIM-pool storms and gives the device a clean
		// reconnect signal rather than a half-open hang.
		if s.activeConns.Load() >= int64(s.cfg.MaxConnections) {
			log.Warn().Str("remote", conn.RemoteAddr().String()).Msg("max connections reached, refusing")
			_ = conn.Close()
			continue
		}

		s.totalConns.Add(1)
		s.activeConns.Add(1)
		go s.handle(ctx, conn)
	}
}

func (s *server) handle(parent context.Context, conn net.Conn) {
	defer s.activeConns.Add(-1)
	defer conn.Close()

	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	remote := conn.RemoteAddr().String()
	logger := log.With().Str("remote", remote).Logger()

	session := teltonika.NewSession(conn, s.cfg.ReadTimeout, s.cfg.WriteTimeout)
	imei, err := session.Handshake()
	if err != nil {
		logger.Warn().Err(err).Msg("handshake")
		return
	}
	logger = logger.With().Str("imei", imei).Logger()
	logger.Info().Msg("device connected")
	defer logger.Info().Msg("device disconnected")

	// Mark device online in Redis with a TTL so the API can show liveness
	// without needing a write to Postgres on every heartbeat.
	_ = s.store.MarkOnline(ctx, imei)

	for {
		if ctx.Err() != nil {
			return
		}
		records, err := session.ReadAVL()
		if err != nil {
			if !errors.Is(err, net.ErrClosed) {
				logger.Debug().Err(err).Msg("read avl")
				s.parseErrors.Add(1)
			}
			return
		}
		if len(records) == 0 {
			continue
		}
		s.totalMsgs.Add(uint64(len(records)))

		if err := s.store.Enqueue(ctx, imei, records); err != nil {
			logger.Error().Err(err).Msg("enqueue")
			return
		}

		if err := session.AckRecords(len(records)); err != nil {
			logger.Debug().Err(err).Msg("ack")
			return
		}

		_ = s.store.MarkOnline(ctx, imei)
	}
}

// runHealth exposes a tiny HTTP server with /healthz and /metrics for
// nginx/Prometheus. We deliberately don't pull in a full metrics lib here —
// the ingestor must stay small and fast.
func (s *server) runHealth(ctx context.Context) {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if !s.store.Healthy() {
			http.Error(w, "store unhealthy", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "fleex_ingestor_active_connections %d\n", s.activeConns.Load())
		fmt.Fprintf(w, "fleex_ingestor_total_connections %d\n", s.totalConns.Load())
		fmt.Fprintf(w, "fleex_ingestor_messages_total %d\n", s.totalMsgs.Load())
		fmt.Fprintf(w, "fleex_ingestor_parse_errors_total %d\n", s.parseErrors.Load())
		s.store.WriteMetrics(w)
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", s.cfg.HealthPort),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
	}()
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error().Err(err).Msg("health server")
	}
}
