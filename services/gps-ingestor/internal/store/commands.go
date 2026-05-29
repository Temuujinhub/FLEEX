// Command delivery — the ingestor pops queued Codec 12 text commands from
// Redis (key `fleex.commands:{imei}`) and writes them onto the device's
// TCP socket while the connection is alive. The API enqueues new commands
// when an operator clicks "Send command" in the UI; we keep delivery
// stateless so multiple ingestor pods can race-pop without coordination
// (BLPOP is atomic).
//
// Result flow: when SendCommand succeeds we update the corresponding
// `commands` row to SENT. Real device responses (Codec 12 reply frames)
// can wire into the same row by `id` in a later pass.

package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// QueuedCommand mirrors the JSON envelope the API pushes onto Redis. The
// `id` is the Postgres bigint stringified so we can join back to the
// commands row when reporting delivery.
type QueuedCommand struct {
	ID      string         `json:"id"`
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

// PopCommand blocks until a command for `imei` is available or `timeout`
// elapses. Returns (nil, nil) on timeout — caller is expected to retry.
func (s *Store) PopCommand(ctx context.Context, imei string, timeout time.Duration) (*QueuedCommand, error) {
	if s.rdb == nil {
		return nil, nil
	}
	key := "fleex.commands:" + imei
	res, err := s.rdb.BLPop(ctx, timeout, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	if len(res) < 2 {
		return nil, nil
	}
	var cmd QueuedCommand
	if err := json.Unmarshal([]byte(res[1]), &cmd); err != nil {
		log.Warn().Err(err).Str("raw", res[1]).Msg("bad command envelope")
		return nil, nil
	}
	return &cmd, nil
}

// MarkCommandSent stamps the Postgres row so the UI shows "Sent" promptly.
// Failures here are non-fatal — Redis already popped the command.
func (s *Store) MarkCommandSent(ctx context.Context, idStr string) {
	if idStr == "" {
		return
	}
	_, err := s.pg.Exec(ctx, `
		UPDATE commands
		SET status = 'SENT', "sentAt" = NOW(), attempts = attempts + 1
		WHERE id = $1::bigint
	`, idStr)
	if err != nil {
		log.Debug().Err(err).Str("id", idStr).Msg("mark command sent")
	}
}

// MarkCommandFailed records a failure and bumps the attempt counter.
func (s *Store) MarkCommandFailed(ctx context.Context, idStr, reason string) {
	if idStr == "" {
		return
	}
	_, err := s.pg.Exec(ctx, `
		UPDATE commands
		SET status = 'FAILED', attempts = attempts + 1, result = $2
		WHERE id = $1::bigint
	`, idStr, reason)
	if err != nil {
		log.Debug().Err(err).Str("id", idStr).Msg("mark command failed")
	}
}

// CommandToText turns a queued command envelope into a Teltonika-text
// command suitable for Codec 12. The mapping is deliberately permissive:
// callers that already pass a literal text command (under `text` payload
// key) bypass the type-based translation.
func CommandToText(cmd *QueuedCommand) string {
	if cmd.Payload != nil {
		if v, ok := cmd.Payload["text"].(string); ok && v != "" {
			return v
		}
	}
	switch cmd.Type {
	case "engine_block":
		return "setdigout 1?? 1 0 0"
	case "engine_unblock":
		return "setdigout 0?? 1 0 0"
	case "request_info":
		return "getinfo"
	case "request_status":
		return "getstatus"
	case "reset":
		return "cpureset"
	default:
		// Unknown type with no explicit text → send nothing. The API is the
		// authority on who may issue what (raw text + arbitrary types are
		// SUPER_ADMIN-only); this is defense-in-depth against a bad envelope.
		return ""
	}
}
