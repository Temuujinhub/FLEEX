// Package store resolves devices, persists DualCam media blobs to the shared
// volume + their metadata to Postgres, and reads on-demand capture requests
// from Redis. Blobs live on disk (the API streams them after auth); only the
// row lives in Postgres.
package store

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/temuujinhub/fleex/services/media-service/internal/config"
)

// DeviceLookup is the device identity resolved from an IMEI.
type DeviceLookup struct {
	ID        string
	CompanyID string
}

type Store struct {
	cfg *config.Config
	pg  *pgxpool.Pool
	rdb *redis.Client

	healthy     atomic.Bool
	imagesSaved atomic.Uint64
	bytesSaved  atomic.Uint64
}

func New(ctx context.Context, cfg *config.Config) (*Store, error) {
	pgCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse db url: %w", err)
	}
	pgCfg.MaxConns = 4
	pgCfg.MinConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, pgCfg)
	if err != nil {
		return nil, fmt.Errorf("pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("pg ping: %w", err)
	}

	var rdb *redis.Client
	if cfg.RedisURL != "" {
		opt, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			return nil, fmt.Errorf("redis url: %w", err)
		}
		rdb = redis.NewClient(opt)
		if err := rdb.Ping(ctx).Err(); err != nil {
			return nil, fmt.Errorf("redis ping: %w", err)
		}
	}

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir data dir: %w", err)
	}

	s := &Store{cfg: cfg, pg: pool, rdb: rdb}
	s.healthy.Store(true)
	return s, nil
}

func (s *Store) Healthy() bool { return s.healthy.Load() }

func (s *Store) Close() {
	if s.pg != nil {
		s.pg.Close()
	}
	if s.rdb != nil {
		_ = s.rdb.Close()
	}
}

// ResolveDevice maps an IMEI to its device + company. Unknown IMEIs return
// ok=false so the camera handler can refuse the transfer (don't store media
// for devices we don't own / can't tenant-scope).
func (s *Store) ResolveDevice(ctx context.Context, imei string) (DeviceLookup, bool) {
	var d DeviceLookup
	row := s.pg.QueryRow(ctx,
		`SELECT id::text, "companyId"::text FROM devices WHERE imei = $1 LIMIT 1`, imei)
	if err := row.Scan(&d.ID, &d.CompanyID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return d, false
		}
		log.Warn().Err(err).Str("imei", imei).Msg("device lookup")
		return d, false
	}
	return d, true
}

// TakePhotoRequest / TakeVideoRequest atomically consume a one-shot capture
// request that the API set (GETDEL). The API sets media:photoreq:<imei> /
// media:videoreq:<imei> with a TTL when an operator clicks request.
func (s *Store) TakePhotoRequest(ctx context.Context, imei string) bool {
	return s.takeReq(ctx, "media:photoreq:"+imei)
}

func (s *Store) TakeVideoRequest(ctx context.Context, imei string) bool {
	return s.takeReq(ctx, "media:videoreq:"+imei)
}

func (s *Store) takeReq(ctx context.Context, key string) bool {
	if s.rdb == nil {
		return false
	}
	v, err := s.rdb.GetDel(ctx, key).Result()
	return err == nil && v != ""
}

// SaveMedia writes the reassembled blob to the media volume and records its
// metadata. The id is generated DB-side (gen_random_uuid, PG15 core) since
// media-service writes via raw SQL, not the Prisma client.
func (s *Store) SaveMedia(ctx context.Context, dev DeviceLookup, imei, kind, trigger string, data []byte) (string, error) {
	ext := "jpg"
	if kind == "video" {
		ext = "h264" // raw stream; in-browser playback (mp4 via ffmpeg) is a follow-up
	}
	id := sanitize(imei)
	ms := time.Now().UnixMilli()
	var name string
	for { // unique filename even for same-millisecond bursts
		name = fmt.Sprintf("%s_%d.%s", id, ms, ext)
		if _, err := os.Stat(filepath.Join(s.cfg.DataDir, name)); os.IsNotExist(err) {
			break
		}
		ms++
	}
	if err := os.WriteFile(filepath.Join(s.cfg.DataDir, name), data, 0o644); err != nil {
		return "", err
	}

	var trig any
	if trigger != "" {
		trig = trigger
	}
	_, err := s.pg.Exec(ctx,
		`INSERT INTO device_images (id, "deviceId", "companyId", imei, kind, "fileName", size, trigger, "capturedAt")
		 VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6, $7, NOW())`,
		dev.ID, dev.CompanyID, imei, kind, name, len(data), trig,
	)
	if err != nil {
		_ = os.Remove(filepath.Join(s.cfg.DataDir, name)) // don't orphan a blob with no row
		return "", err
	}

	s.imagesSaved.Add(1)
	s.bytesSaved.Add(uint64(len(data)))
	s.pruneRetention(ctx)
	return name, nil
}

// pruneRetention keeps the newest MaxFiles rows (and their blobs) so the
// volume stays bounded. Cheap: the DELETE matches nothing until the cap is
// exceeded. Object storage at fleet scale replaces this.
func (s *Store) pruneRetention(ctx context.Context) {
	if s.cfg.MaxFiles <= 0 {
		return
	}
	rows, err := s.pg.Query(ctx,
		`DELETE FROM device_images
		 WHERE id IN (SELECT id FROM device_images ORDER BY "capturedAt" DESC OFFSET $1)
		 RETURNING "fileName"`, s.cfg.MaxFiles)
	if err != nil {
		log.Debug().Err(err).Msg("retention prune")
		return
	}
	var files []string
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err == nil {
			files = append(files, f)
		}
	}
	rows.Close()
	for _, f := range files {
		_ = os.Remove(filepath.Join(s.cfg.DataDir, f))
	}
}

func (s *Store) WriteMetrics(w io.Writer) {
	fmt.Fprintf(w, "fleex_media_images_saved_total %d\n", s.imagesSaved.Load())
	fmt.Fprintf(w, "fleex_media_bytes_saved_total %d\n", s.bytesSaved.Load())
}

// sanitize strips a string down to filename-safe characters.
func sanitize(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			out = append(out, r)
		}
	}
	return string(out)
}
