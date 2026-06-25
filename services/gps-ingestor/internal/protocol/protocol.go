// Package protocol is the vendor-neutral seam that lets the ingestor speak
// more than one device protocol (Teltonika, Queclink, …) without the hot
// path — store batcher, TimescaleDB COPY, Redis fan-out — knowing which
// wire format a record came from.
//
// Design: docs/MULTI-PROTOCOL-DESIGN.md. Each protocol lives in its own
// package, implements Decoder, and registers a Factory in init(). main.go
// opens one TCP listener per protocol (per-port routing, see config
// INGESTOR_PROTOCOL_PORTS) and drives every connection through this one
// interface. The existing Teltonika code is reused verbatim behind an
// adapter — there is no second copy of the Codec 8/8E parser.
package protocol

import (
	"context"
	"errors"
	"net"
	"sync/atomic"
	"time"
)

// Record is one decoded AVL point, normalised across protocols. Each decoder
// is responsible for mapping its raw fields into these neutral ones (speed in
// km/h, ignition as a tri-state, odometer in km, …) so the store can build a
// positions row without any protocol-specific Pick* calls.
type Record struct {
	Timestamp   time.Time
	Lat, Lng    float64
	SpeedKmh    float64
	Course      float64 // degrees
	Altitude    float64 // metres
	Satellites  int
	Valid       bool // decoder's verdict on whether this is a usable GNSS fix
	Ignition    *bool
	OdometerKm  *float64
	EngineHours *float64
	BatteryVolt *float64
	RFID        string
	VIN         string
	EventIO     uint16
	Priority    uint8
	// IO carries the raw protocol IO map (Teltonika AVL IDs, Queclink param
	// codes) so the store can persist attributes->io_<n> and the events-engine
	// can read sensor inputs. Keys are protocol-specific but the storage shape
	// (io_<n>) is shared, which is what Sensor.sourceParam already targets.
	IO        map[uint16]int64
	IOStrings map[uint16]string
}

// Command is a neutral operator command. Each decoder translates it into its
// own wire format (Teltonika Codec 12 text, Queclink AT+GT…) or returns
// ErrUnsupported when the protocol can't express it.
type Command struct {
	Type    string            // "engine_block", "engine_unblock", "request_info", …
	Params  map[string]string // decoded command payload (stringified)
	RawText string            // verbatim wire command (SUPER_ADMIN escape hatch)
}

// Opts is the per-connection configuration handed to a Factory. It keeps the
// Decoder interface free of protocol-specific knobs: a decoder that doesn't
// care about CRC simply ignores those fields.
type Opts struct {
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	// VerifyCRC asks a decoder that has a frame checksum (Teltonika CRC-16/IBM)
	// to drop frames that fail it. The device re-sends un-acked data, so a drop
	// is lossless. Default off: the mismatch is only counted.
	VerifyCRC bool
	// CRCErrors, when non-nil, is incremented by the decoder on every checksum
	// mismatch so the process can expose fleex_ingestor_crc_errors_total
	// without the generic loop knowing what a CRC is.
	CRCErrors *atomic.Uint64
}

// Decoder owns the lifecycle of a single device connection for one protocol.
type Decoder interface {
	// Name is the protocol identifier ("teltonika", "queclink"); it is stamped
	// onto raw_messages.protocol.
	Name() string
	// Handshake reads the device's login/identification and returns its IMEI.
	// `accept` gates registration (the P4 allowlist): a decoder must call it
	// with the parsed IMEI and, if it returns false, send the protocol's
	// rejection (where one exists) and return ErrRejected. Protocols without a
	// dedicated handshake frame (Queclink) read the first data message here and
	// replay it on the first ReadBatch.
	Handshake(ctx context.Context, accept func(imei string) bool) (imei string, err error)
	// ReadBatch returns the next message's records. ackable=false means the
	// message needs no record-count ACK (a heartbeat the decoder already
	// answered, or a frame dropped on CRC); the loop then skips Ack.
	ReadBatch(ctx context.Context) (recs []Record, frameLen int, ackable bool, err error)
	// Ack sends the protocol's "n records accepted" response.
	Ack(n int) error
	// EncodeAndSend writes one operator command, or returns ErrUnsupported.
	EncodeAndSend(cmd Command) error
}

// Factory builds a Decoder for a freshly accepted connection.
type Factory func(conn net.Conn, opts Opts) Decoder

var (
	// ErrUnsupported is returned by EncodeAndSend when the protocol cannot
	// express the requested command (so the UI/command queue can mark it
	// failed without disconnecting the device).
	ErrUnsupported = errors.New("command not supported by protocol")
	// ErrRejected is returned by Handshake when `accept` denied the IMEI.
	ErrRejected = errors.New("device not registered")
)

// registry maps a protocol name to its Factory. Decoders self-register in
// init(); main.go resolves the per-port factories via ByName.
var registry = map[string]Factory{}

// Register wires a decoder's Factory under `name`. Called from each decoder
// package's init(); a duplicate name panics (a build-time wiring bug).
func Register(name string, f Factory) {
	if _, dup := registry[name]; dup {
		panic("protocol: duplicate registration for " + name)
	}
	registry[name] = f
}

// ByName returns the Factory registered for `name`.
func ByName(name string) (Factory, bool) {
	f, ok := registry[name]
	return f, ok
}
