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
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/config"
	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/protocol"
	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/store"

	// Decoders self-register their protocol.Factory in init(); blank-import
	// them so per-port routing can resolve "teltonika"/"queclink" by name.
	_ "github.com/temuujinhub/fleex/services/gps-ingestor/internal/queclink"
	_ "github.com/temuujinhub/fleex/services/gps-ingestor/internal/teltonika"
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
	// Block until the batcher has drained the queue and flushed its final
	// batch before main returns and the deferred st.Close() tears down the
	// connection pool. Without this every restart/deploy dropped the
	// in-flight batch (and whatever was still queued).
	st.Wait()
	log.Info().Msg("ingestor stopped")
}

type server struct {
	cfg           *config.Config
	store         *store.Store
	activeConns   atomic.Int64
	totalConns    atomic.Uint64
	totalMsgs     atomic.Uint64
	parseErrors   atomic.Uint64
	crcErrors     atomic.Uint64
	rejectedConns atomic.Uint64
}

// runTCP opens one listener per configured protocol (per-port routing) and
// serves them concurrently. All listeners are bound up front so a port clash
// fails startup immediately rather than after some are already serving.
func (s *server) runTCP(ctx context.Context) error {
	type listener struct {
		name    string
		l       net.Listener
		factory protocol.Factory
	}
	lc := net.ListenConfig{KeepAlive: 30 * time.Second}
	var listeners []listener
	closeAll := func() {
		for _, x := range listeners {
			_ = x.l.Close()
		}
	}

	for name, port := range s.cfg.ProtocolPorts {
		factory, ok := protocol.ByName(name)
		if !ok {
			closeAll()
			return fmt.Errorf("no decoder registered for protocol %q", name)
		}
		addr := fmt.Sprintf(":%d", port)
		l, err := lc.Listen(ctx, "tcp", addr)
		if err != nil {
			closeAll()
			return fmt.Errorf("listen %s (%s): %w", addr, name, err)
		}
		listeners = append(listeners, listener{name: name, l: l, factory: factory})
		log.Info().Str("addr", addr).Str("protocol", name).Msg("tcp listening")
	}

	go func() {
		<-ctx.Done()
		closeAll()
	}()

	var wg sync.WaitGroup
	for _, x := range listeners {
		wg.Add(1)
		go func(x listener) {
			defer wg.Done()
			s.acceptLoop(ctx, x.name, x.l, x.factory)
		}(x)
	}
	wg.Wait()
	return ctx.Err()
}

// acceptLoop accepts connections on one protocol's listener and hands each to
// handle() with that protocol's decoder factory.
func (s *server) acceptLoop(ctx context.Context, name string, l net.Listener, factory protocol.Factory) {
	for {
		conn, err := l.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Warn().Err(err).Str("protocol", name).Msg("accept")
			time.Sleep(100 * time.Millisecond)
			continue
		}

		// Reject if we're already at the configured connection ceiling (shared
		// across all protocols). This prevents OOM under SIM-pool storms and
		// gives the device a clean reconnect signal rather than a half-open hang.
		if s.activeConns.Load() >= int64(s.cfg.MaxConnections) {
			log.Warn().Str("remote", conn.RemoteAddr().String()).Msg("max connections reached, refusing")
			_ = conn.Close()
			continue
		}

		s.totalConns.Add(1)
		s.activeConns.Add(1)
		go s.handle(ctx, conn, factory)
	}
}

func (s *server) handle(parent context.Context, conn net.Conn, factory protocol.Factory) {
	defer s.activeConns.Add(-1)
	defer conn.Close()
	// A single malformed frame must never take down the whole process (and
	// with it every other connected device). Recover any panic from the
	// parser, count it, and let just this connection drop.
	defer func() {
		if r := recover(); r != nil {
			s.parseErrors.Add(1)
			log.Error().Interface("panic", r).Str("remote", conn.RemoteAddr().String()).
				Msg("recovered panic in connection handler")
		}
	}()

	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	remote := conn.RemoteAddr().String()
	dec := factory(conn, protocol.Opts{
		ReadTimeout:  s.cfg.ReadTimeout,
		WriteTimeout: s.cfg.WriteTimeout,
		VerifyCRC:    s.cfg.VerifyCRC,
		CRCErrors:    &s.crcErrors,
	})
	logger := log.With().Str("remote", remote).Str("protocol", dec.Name()).Logger()

	// Handshake reads the device identity and gates it on the registration
	// allowlist (audit P4) via this callback: an unknown IMEI is rejected so a
	// spoofed identity can't hold a connection or probe the fleet.
	// AcceptHandshake fails open on a DB lookup error so a database blip can't
	// lock out the whole fleet; telemetry for a truly unknown IMEI is still
	// dropped downstream by the store.
	accept := func(imei string) bool {
		return !s.cfg.RequireRegisteredDevice || s.store.AcceptHandshake(ctx, imei)
	}
	imei, err := dec.Handshake(ctx, accept)
	if err != nil {
		if errors.Is(err, protocol.ErrRejected) {
			s.rejectedConns.Add(1)
			logger.Warn().Msg("rejected unregistered device")
		} else {
			logger.Warn().Err(err).Msg("handshake")
		}
		return
	}
	logger = logger.With().Str("imei", imei).Logger()
	logger.Info().Msg("device connected")
	defer logger.Info().Msg("device disconnected")

	// Mark device online in Redis with a TTL so the API can show liveness
	// without needing a write to Postgres on every heartbeat.
	_ = s.store.MarkOnline(ctx, imei)

	// Sibling goroutine that delivers operator-issued commands onto this
	// session's TCP socket. Lifetime is bounded by `ctx` — when the device
	// disconnects we cancel and the command pop returns.
	go s.runCommandLoop(ctx, imei, dec)

	for {
		if ctx.Err() != nil {
			return
		}
		records, frameLen, ackable, err := dec.ReadBatch(ctx)
		if err != nil {
			if !errors.Is(err, net.ErrClosed) {
				logger.Debug().Err(err).Msg("read batch")
				s.parseErrors.Add(1)
			}
			return
		}
		if len(records) == 0 {
			// Empty but no error: a heartbeat the decoder already answered, or a
			// frame dropped on CRC. Nothing to persist or ack.
			continue
		}
		s.totalMsgs.Add(uint64(len(records)))

		if err := s.store.Enqueue(ctx, imei, dec.Name(), records, frameLen); err != nil {
			logger.Error().Err(err).Msg("enqueue")
			return
		}

		if ackable {
			if err := dec.Ack(len(records)); err != nil {
				logger.Debug().Err(err).Msg("ack")
				return
			}
		}

		_ = s.store.MarkOnline(ctx, imei)
	}
}

// runCommandLoop drains the device's Redis command queue and writes each
// command onto the open TCP socket via the protocol's encoder. We block up to
// 5 s per iteration so a graceful disconnect (ctx cancel) returns promptly.
// The goroutine is tied to a single connection — when the device reconnects, a
// fresh loop is spawned and picks up any commands that landed meanwhile.
func (s *server) runCommandLoop(ctx context.Context, imei string, dec protocol.Decoder) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Str("imei", imei).
				Msg("recovered panic in command loop")
		}
	}()
	for {
		if ctx.Err() != nil {
			return
		}
		cmd, err := s.store.PopCommand(ctx, imei, 5*time.Second)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				log.Debug().Err(err).Str("imei", imei).Msg("pop command")
			}
			return
		}
		if cmd == nil {
			continue
		}
		if err := dec.EncodeAndSend(cmd.ToProtocol()); err != nil {
			// An unsupported/empty command is a bad envelope, not a transport
			// failure: mark it failed and keep the connection (and its other
			// queued commands) alive. Only a real write error drops the loop.
			if errors.Is(err, protocol.ErrUnsupported) {
				log.Warn().Str("imei", imei).Str("type", cmd.Type).Msg("command unsupported by protocol")
				s.store.MarkCommandFailed(ctx, cmd.ID, "unsupported by device protocol")
				continue
			}
			log.Warn().Err(err).Str("imei", imei).Str("type", cmd.Type).Msg("send command")
			s.store.MarkCommandFailed(ctx, cmd.ID, err.Error())
			return
		}
		s.store.MarkCommandSent(ctx, cmd.ID)
		log.Info().Str("imei", imei).Str("type", cmd.Type).Msg("command delivered")
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
		fmt.Fprintf(w, "fleex_ingestor_crc_errors_total %d\n", s.crcErrors.Load())
		fmt.Fprintf(w, "fleex_ingestor_rejected_connections_total %d\n", s.rejectedConns.Load())
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
