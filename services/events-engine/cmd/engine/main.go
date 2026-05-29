// Command engine is the Fleex events engine: it subscribes to the live GPS
// positions stream published by the gps-ingestor on Redis Pub/Sub and emits
// Event rows when geofence transitions or overspeed conditions occur.
//
// Two long-lived goroutines:
//   - Engine.Run         — consumes positions, evaluates, persists, republishes.
//   - Store.RunRefreshLoop — periodically reloads geofence + device cache.
//
// Plus a tiny HTTP server on :9091 with /healthz and /metrics for the docker
// healthcheck and Prometheus.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	// Embed the IANA tz database so time.LoadLocation resolves company
	// timezones (e.g. Asia/Ulaanbaatar) regardless of whether the runtime
	// image ships tzdata — the day/night speed schedule depends on it.
	_ "time/tzdata"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/temuujinhub/fleex/services/events-engine/internal/config"
	"github.com/temuujinhub/fleex/services/events-engine/internal/engine"
	"github.com/temuujinhub/fleex/services/events-engine/internal/store"
)

func main() {
	zerolog.TimeFieldFormat = time.RFC3339Nano
	// JSON logs by default (aggregator-friendly: Loki/ELK). LOG_FORMAT=console
	// gives the human-readable output for local dev.
	if os.Getenv("LOG_FORMAT") == "console" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("config")
	}
	if cfg.LogLevel != "" {
		if lvl, perr := zerolog.ParseLevel(cfg.LogLevel); perr == nil {
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

	go st.RunRefreshLoop(ctx)
	go runHealth(ctx, cfg, st)

	eng := engine.New(cfg, st)
	go eng.RunHealthLoop(ctx)
	if err := eng.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Error().Err(err).Msg("engine exited")
	}
	log.Info().Msg("events-engine stopped")
}

func runHealth(ctx context.Context, cfg *config.Config, st *store.Store) {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if !st.Healthy() {
			http.Error(w, "store unhealthy", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		emitted, refreshes := st.Stats()
		fmt.Fprintf(w, "fleex_engine_events_emitted_total %d\n", emitted)
		fmt.Fprintf(w, "fleex_engine_cache_refreshes_total %d\n", refreshes)
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.HealthPort),
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
