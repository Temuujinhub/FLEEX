// Command media is the Fleex DualCam media service. It speaks the Teltonika
// DualCam file-transfer protocol on its own TCP port, persists captured
// photos/videos to a shared volume + metadata to Postgres, and consumes
// on-demand capture requests from Redis (set by the API). Telemetry is
// untouched — that still flows to the gps-ingestor on :5027.
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

	"github.com/temuujinhub/fleex/services/media-service/internal/camera"
	"github.com/temuujinhub/fleex/services/media-service/internal/config"
	"github.com/temuujinhub/fleex/services/media-service/internal/store"
)

type server struct {
	cfg         *config.Config
	store       *store.Store
	activeConns atomic.Int64
	totalConns  atomic.Uint64
}

func main() {
	zerolog.TimeFieldFormat = time.RFC3339Nano
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("config")
	}
	if cfg.LogLevel != "" {
		if lvl, e := zerolog.ParseLevel(cfg.LogLevel); e == nil {
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

	srv := &server{cfg: cfg, store: st}
	go srv.runHealth(ctx)

	if err := srv.runTCP(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Error().Err(err).Msg("camera server exited")
	}
	log.Info().Msg("media-service stopped")
}

func (s *server) runTCP(ctx context.Context) error {
	addr := fmt.Sprintf(":%d", s.cfg.CamPort)
	lc := net.ListenConfig{KeepAlive: 30 * time.Second}
	l, err := lc.Listen(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}
	defer l.Close()
	log.Info().Str("addr", addr).Msg("dualcam tcp listening")

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
		s.totalConns.Add(1)
		s.activeConns.Add(1)
		go s.handle(ctx, conn)
	}
}

func (s *server) handle(parent context.Context, conn net.Conn) {
	defer s.activeConns.Add(-1)
	defer conn.Close()
	// A malformed camera frame must never take down the process.
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Str("remote", conn.RemoteAddr().String()).
				Msg("recovered panic in camera handler")
		}
	}()

	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	camera.Handle(ctx, conn, s.store, s.cfg)
}

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
		fmt.Fprintf(w, "fleex_media_active_connections %d\n", s.activeConns.Load())
		fmt.Fprintf(w, "fleex_media_total_connections %d\n", s.totalConns.Load())
		s.store.WriteMetrics(w)
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", s.cfg.HealthPort),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(shutCtx)
	}()
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error().Err(err).Msg("health server")
	}
}
