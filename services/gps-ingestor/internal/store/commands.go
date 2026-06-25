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
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/protocol"
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
		// No Redis configured: there are no commands to deliver. Sleep the poll
		// interval instead of returning instantly so the caller's loop doesn't
		// busy-spin at 100% CPU per connection (audit L8).
		select {
		case <-ctx.Done():
		case <-time.After(timeout):
		}
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

// ToProtocol converts the queued envelope into a protocol-neutral Command.
// Each decoder maps it to its own wire format (Teltonika Codec 12 text,
// Queclink AT+GT…). A literal `text` payload becomes RawText — the
// SUPER_ADMIN escape hatch the API gates — and bypasses type translation in
// every decoder.
func (cmd *QueuedCommand) ToProtocol() protocol.Command {
	params := make(map[string]string, len(cmd.Payload))
	raw := ""
	for k, v := range cmd.Payload {
		str := fmt.Sprint(v)
		params[k] = str
		if k == "text" {
			raw = str
		}
	}
	return protocol.Command{Type: cmd.Type, Params: params, RawText: raw}
}
