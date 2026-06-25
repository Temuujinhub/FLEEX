// Package queclink decodes the Queclink @Track Air Interface protocol (ASCII
// GPRS), used by the GV350CEU and the wider GV family, behind the neutral
// protocol.Decoder interface. See docs/QUECLINK-INTEGRATION-PLAN.md and
// docs/MULTI-PROTOCOL-DESIGN.md.
//
// Wire shape (one message per `$`-terminated line):
//
//	+RESP:GTFRI,<protocolVer>,<IMEI>,<name>,…,<accuracy>,<speed>,<azimuth>,
//	            <altitude>,<longitude>,<latitude>,<UTC YYYYMMDDHHMMSS>,…,<count>$
//	+BUFF:GTFRI,…$                      (buffered — needs +SACK)
//	+RESP:GTIGN/GTIGF,…$                (ignition on / off)
//	+ACK:GTHBD,<ver>,<IMEI>,…,<count>$  (heartbeat — needs +SACK)
//
// IMPORTANT: the exact field *offsets* differ by model and firmware. Rather
// than hard-code a column count (which the QUECLINK plan warns is firmware
// specific), this parser anchors on two stable invariants:
//   - the IMEI is the first 15-digit field, and
//   - the GNSS fix is the six fields immediately preceding the 14-digit UTC
//     stamp, in the documented order accuracy,speed,azimuth,altitude,lon,lat.
//
// That makes it tolerant of leading reserved/ERI fields. Per the plan it must
// still be confirmed on a real GV350CEU (phase 5 bench) before production —
// especially the DR102 RFID report layout, which is stubbed below.
package queclink

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/protocol"
)

const maxMessageBytes = 4096 // bound a single $-terminated message (DoS guard)

func init() {
	protocol.Register("queclink", func(conn net.Conn, opts protocol.Opts) protocol.Decoder {
		return &decoder{
			conn: conn,
			r:    bufio.NewReaderSize(conn, 8192),
			opts: opts,
		}
	})
}

type decoder struct {
	conn   net.Conn
	r      *bufio.Reader
	opts   protocol.Opts
	imei   string
	replay []protocol.Record // first data message, stashed during Handshake
}

func (d *decoder) Name() string { return "queclink" }

// Handshake — Queclink has no dedicated login frame; the IMEI rides in every
// message. We read messages until one yields an IMEI (answering any heartbeat
// in between), gate it on the allowlist, and stash a first data message so
// ReadBatch can replay it.
func (d *decoder) Handshake(ctx context.Context, accept func(imei string) bool) (string, error) {
	for {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		line, err := d.readMessage()
		if err != nil {
			return "", err
		}
		msg, ok := parse(line)
		if !ok || msg.imei == "" {
			continue // junk or a message without a usable IMEI
		}
		if !accept(msg.imei) {
			// No reject byte exists in @Track; just drop the connection.
			return "", protocol.ErrRejected
		}
		d.imei = msg.imei
		if msg.heartbeat {
			_ = d.sendSACK(msg.protocolVer, msg.count)
			continue // keep reading until a data message (or just return IMEI)
		}
		if msg.needsAck {
			_ = d.sendSACK(msg.protocolVer, msg.count)
		}
		if msg.hasRecord {
			d.replay = append(d.replay, msg.record)
		}
		return d.imei, nil
	}
}

func (d *decoder) ReadBatch(ctx context.Context) ([]protocol.Record, int, bool, error) {
	if len(d.replay) > 0 {
		recs := d.replay
		d.replay = nil
		// @Track +RESP messages are not record-count acked, so ackable=false;
		// any +SACK was already sent during Handshake.
		return recs, 0, false, nil
	}
	for {
		if ctx.Err() != nil {
			return nil, 0, false, ctx.Err()
		}
		line, err := d.readMessage()
		if err != nil {
			return nil, 0, false, err
		}
		msg, ok := parse(line)
		if !ok {
			continue
		}
		if msg.heartbeat {
			_ = d.sendSACK(msg.protocolVer, msg.count)
			continue
		}
		if msg.needsAck {
			_ = d.sendSACK(msg.protocolVer, msg.count)
		}
		if !msg.hasRecord {
			continue
		}
		return []protocol.Record{msg.record}, len(line), false, nil
	}
}

// Ack is a no-op: @Track acknowledgement (+SACK, only for +BUFF/heartbeats) is
// handled inside ReadBatch, so the generic loop never needs to call this.
func (d *decoder) Ack(n int) error { return nil }

// EncodeAndSend builds a Queclink AT+GT… command. RawText (a SUPER_ADMIN
// escape hatch) is sent verbatim. The structured encodings below are
// best-effort per the @Track command spec and MUST be confirmed on a real
// GV350CEU (password/serial/field count are firmware specific) — until then
// operators should issue the exact AT string via RawText.
func (d *decoder) EncodeAndSend(cmd protocol.Command) error {
	text := d.commandText(cmd)
	if text == "" {
		return protocol.ErrUnsupported
	}
	if err := d.conn.SetWriteDeadline(time.Now().Add(d.opts.WriteTimeout)); err != nil {
		return err
	}
	_, err := d.conn.Write([]byte(text))
	return err
}

func (d *decoder) commandText(cmd protocol.Command) string {
	if cmd.RawText != "" {
		return cmd.RawText
	}
	pw := cmd.Params["password"]
	if pw == "" {
		pw = "gv350ceu"
	}
	serial := cmd.Params["serial"]
	if serial == "" {
		serial = "FFFF"
	}
	switch cmd.Type {
	case "engine_block":
		// AT+GTOUT digital output ON (engine-cut relay). Field layout per @Track
		// command doc — confirm on bench before production.
		return fmt.Sprintf("AT+GTOUT=%s,1,0,0,0,0,0,0,0,0,0,0,0,0,%s$", pw, serial)
	case "engine_unblock":
		return fmt.Sprintf("AT+GTOUT=%s,0,0,0,0,0,0,0,0,0,0,0,0,0,%s$", pw, serial)
	case "request_info", "request_status":
		// AT+GTRTO request the current position/info report.
		return fmt.Sprintf("AT+GTRTO=%s,1,,,,,,%s$", pw, serial)
	default:
		return ""
	}
}

// sendSACK answers a +BUFF/heartbeat with +SACK:GTHBD,<protocolVer>,<count>$.
func (d *decoder) sendSACK(protocolVer, count string) error {
	if d.opts.WriteTimeout > 0 {
		_ = d.conn.SetWriteDeadline(time.Now().Add(d.opts.WriteTimeout))
	}
	_, err := d.conn.Write([]byte(fmt.Sprintf("+SACK:GTHBD,%s,%s$", protocolVer, count)))
	return err
}

// readMessage reads one $-terminated @Track message, bounded by maxMessageBytes
// and the read deadline so a peer that never sends `$` can't hang or OOM us.
func (d *decoder) readMessage() (string, error) {
	if d.opts.ReadTimeout > 0 {
		if err := d.conn.SetReadDeadline(time.Now().Add(d.opts.ReadTimeout)); err != nil {
			return "", err
		}
	}
	var sb strings.Builder
	for {
		b, err := d.r.ReadByte()
		if err != nil {
			return "", err
		}
		if b == '$' {
			return sb.String(), nil
		}
		if b == '\r' || b == '\n' {
			continue // tolerate framing whitespace between messages
		}
		sb.WriteByte(b)
		if sb.Len() > maxMessageBytes {
			return "", errors.New("queclink message too long")
		}
	}
}

// --- pure parsing (unit-tested) --------------------------------------------

type message struct {
	prefix      string // "+RESP", "+BUFF", "+ACK"
	word        string // "GTFRI", "GTIGN", "GTHBD", …
	protocolVer string
	imei        string
	count       string // trailing count number (echoed in +SACK)
	heartbeat   bool
	needsAck    bool // +BUFF (and heartbeats) require +SACK
	hasRecord   bool
	record      protocol.Record
}

// parse decodes one @Track line (without the trailing `$`).
func parse(line string) (message, bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return message{}, false
	}
	head, rest, found := strings.Cut(line, ":")
	if !found {
		return message{}, false
	}
	fields := strings.Split(rest, ",")
	if len(fields) < 3 {
		return message{}, false
	}
	m := message{
		prefix:      head,      // "+RESP" / "+BUFF" / "+ACK"
		word:        fields[0], // "GTFRI", "GTHBD", …
		protocolVer: fields[1], //
		count:       fields[len(fields)-1],
		needsAck:    head == "+BUFF" || head == "+ACK",
	}
	m.imei = findIMEI(fields)

	switch m.word {
	case "GTHBD":
		m.heartbeat = true
		m.needsAck = true
		return m, true
	case "GTIGN", "GTIGF":
		if rec, ok := parseGNSS(fields); ok {
			ign := m.word == "GTIGN"
			rec.Ignition = &ign
			m.record = rec
			m.hasRecord = true
		}
		return m, true
	default:
		// GTFRI and the other position-bearing reports all share the GNSS block.
		if rec, ok := parseGNSS(fields); ok {
			m.record = rec
			m.hasRecord = true
		}
		return m, true
	}
}

// findIMEI returns the first 15-digit field (the @Track Unique ID / IMEI).
func findIMEI(fields []string) string {
	for _, f := range fields {
		if len(f) == 15 && isAllDigits(f) {
			return f
		}
	}
	return ""
}

// parseGNSS locates the 14-digit UTC stamp and reads the six GNSS fields that
// precede it: accuracy, speed, azimuth, altitude, longitude, latitude.
func parseGNSS(fields []string) (protocol.Record, bool) {
	utcIdx := -1
	for i, f := range fields {
		if len(f) == 14 && isAllDigits(f) {
			utcIdx = i
			break
		}
	}
	if utcIdx < 6 {
		return protocol.Record{}, false
	}
	accuracy := fields[utcIdx-6]
	speed := fields[utcIdx-5]
	azimuth := fields[utcIdx-4]
	altitude := fields[utcIdx-3]
	lonStr := fields[utcIdx-2]
	latStr := fields[utcIdx-1]

	lat, err1 := strconv.ParseFloat(latStr, 64)
	lon, err2 := strconv.ParseFloat(lonStr, 64)
	if err1 != nil || err2 != nil {
		return protocol.Record{}, false
	}
	ts, err := time.ParseInLocation("20060102150405", fields[utcIdx], time.UTC)
	if err != nil {
		return protocol.Record{}, false
	}
	rec := protocol.Record{
		Timestamp: ts,
		Lat:       lat,
		Lng:       lon,
		SpeedKmh:  parseFloat(speed),
		Course:    parseFloat(azimuth),
		Altitude:  parseFloat(altitude),
		// @Track reports HDOP-style "GPS accuracy" rather than a satellite
		// count; a non-zero value means a usable fix.
		Valid: parseFloat(accuracy) > 0,
		IO:    map[uint16]int64{},
	}
	return rec, true
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func parseFloat(s string) float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0
	}
	return v
}
