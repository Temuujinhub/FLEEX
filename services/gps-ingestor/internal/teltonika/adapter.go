// Teltonika protocol.Decoder adapter. This is the ONLY new code the
// multi-protocol refactor adds to the Teltonika path: it wraps the existing
// Session (Codec 8/8E parser, IMEI handshake, Codec 12 commands) behind the
// neutral protocol.Decoder interface so the store and main loop no longer
// reference this package directly. The wire parser is reused verbatim — there
// is no second decode path to keep in sync.
package teltonika

import (
	"context"
	"net"

	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/protocol"
)

func init() {
	protocol.Register("teltonika", func(conn net.Conn, opts protocol.Opts) protocol.Decoder {
		return &decoder{
			sess: NewSession(conn, opts.ReadTimeout, opts.WriteTimeout),
			opts: opts,
		}
	})
}

type decoder struct {
	sess *Session
	opts protocol.Opts
}

func (d *decoder) Name() string { return "teltonika" }

// Handshake reads the IMEI without acking, gates it on the registration
// allowlist (audit P4), then sends accept (0x01) or reject (0x00). This keeps
// the exact behaviour main.go had before the refactor.
func (d *decoder) Handshake(ctx context.Context, accept func(imei string) bool) (string, error) {
	imei, err := d.sess.ReadIMEI()
	if err != nil {
		return "", err
	}
	if !accept(imei) {
		_ = d.sess.RejectIMEI()
		return "", protocol.ErrRejected
	}
	if err := d.sess.AcceptIMEI(); err != nil {
		return "", err
	}
	return imei, nil
}

// ReadBatch reads one AVL frame and normalises its records. CRC handling
// mirrors the old main loop: always evaluate, count a mismatch, and only drop
// the frame (return zero records, no ack) when VerifyCRC is enabled — the
// device re-sends un-acked data so dropping is lossless.
func (d *decoder) ReadBatch(ctx context.Context) ([]protocol.Record, int, bool, error) {
	recs, err := d.sess.ReadAVL()
	if err != nil {
		return nil, 0, false, err
	}
	if !d.sess.LastCRCOK() {
		if d.opts.CRCErrors != nil {
			d.opts.CRCErrors.Add(1)
		}
		if d.opts.VerifyCRC {
			return nil, d.sess.LastFrameLen(), false, nil // drop; device re-sends
		}
	}
	out := make([]protocol.Record, 0, len(recs))
	for _, r := range recs {
		out = append(out, toNeutral(r))
	}
	return out, d.sess.LastFrameLen(), true, nil
}

func (d *decoder) Ack(n int) error { return d.sess.AckRecords(n) }

func (d *decoder) EncodeAndSend(cmd protocol.Command) error {
	text := commandText(cmd)
	if text == "" {
		return protocol.ErrUnsupported
	}
	return d.sess.SendCommand(text)
}

// toNeutral maps a decoded Teltonika record onto the protocol-neutral shape,
// applying the same telemetry Pick* heuristics the store used to call inline.
func toNeutral(r Record) protocol.Record {
	vin := ""
	if r.IOStrings != nil {
		// Codec 8E variable IO 256 = VIN (OBD auto-detect).
		if v, ok := r.IOStrings[256]; ok {
			vin = v
		}
	}
	return protocol.Record{
		Timestamp:   r.Timestamp,
		Lat:         r.Lat,
		Lng:         r.Lng,
		SpeedKmh:    PickSpeedKmh(r),
		Course:      float64(r.Angle),
		Altitude:    float64(r.Altitude),
		Satellites:  int(r.Satellites),
		Valid:       r.Satellites >= 3,
		Ignition:    PickIgnition(r),
		OdometerKm:  PickOdometerKm(r),
		EngineHours: PickEngineHours(r),
		BatteryVolt: PickBatteryVolt(r),
		RFID:        PickRFID(r),
		VIN:         vin,
		EventIO:     r.EventIO,
		Priority:    r.Priority,
		IO:          r.IO,
		IOStrings:   r.IOStrings,
	}
}

// commandText turns a neutral command into Teltonika Codec 12 text. A literal
// RawText (the SUPER_ADMIN escape hatch, carried as payload.text) bypasses the
// type mapping; an unknown type with no text yields "" → ErrUnsupported.
func commandText(cmd protocol.Command) string {
	if cmd.RawText != "" {
		return cmd.RawText
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
		return ""
	}
}
