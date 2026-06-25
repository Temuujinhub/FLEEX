package queclink

import (
	"context"
	"errors"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/protocol"
)

// A representative @Track +RESP:GTFRI line (Ulaanbaatar coordinates). The GNSS
// block (accuracy,speed,azimuth,altitude,lon,lat,utc) sits before the 14-digit
// UTC stamp, which is how parseGNSS anchors regardless of leading fields.
const gtfri = "+RESP:GTFRI,C30203,867162050000000,GV350CEU,,10,1,1,1,12.3,90,543.0,106.917020,47.918680,20260625073045,0428,0001,1B2C,01234567,00,0,80,,,20260625073100,1A2B"

func TestParseGTFRI(t *testing.T) {
	m, ok := parse(gtfri)
	if !ok {
		t.Fatal("parse returned ok=false")
	}
	if m.imei != "867162050000000" {
		t.Fatalf("imei = %q", m.imei)
	}
	if !m.hasRecord {
		t.Fatal("expected a record")
	}
	r := m.record
	if !floatEq(r.Lat, 47.918680) || !floatEq(r.Lng, 106.917020) {
		t.Fatalf("lat/lng = %v/%v", r.Lat, r.Lng)
	}
	if !floatEq(r.SpeedKmh, 12.3) {
		t.Fatalf("speed = %v", r.SpeedKmh)
	}
	if !floatEq(r.Course, 90) {
		t.Fatalf("course = %v", r.Course)
	}
	if !floatEq(r.Altitude, 543.0) {
		t.Fatalf("altitude = %v", r.Altitude)
	}
	if !r.Valid {
		t.Fatal("expected a valid fix (accuracy > 0)")
	}
	want := time.Date(2026, 6, 25, 7, 30, 45, 0, time.UTC)
	if !r.Timestamp.Equal(want) {
		t.Fatalf("ts = %v want %v", r.Timestamp, want)
	}
}

func TestParseNoFix(t *testing.T) {
	// accuracy = 0 → no usable GNSS fix.
	line := "+RESP:GTFRI,C30203,867162050000000,GV350CEU,,10,1,1,0,0.0,0,0.0,0.000000,0.000000,20260625073045,0428,0001,1B2C,01234567,,,20260625073100,1A2B"
	m, ok := parse(line)
	if !ok || !m.hasRecord {
		t.Fatal("expected a parsed record")
	}
	if m.record.Valid {
		t.Fatal("accuracy 0 should mark the fix invalid")
	}
}

func TestParseIgnition(t *testing.T) {
	on := "+RESP:GTIGN,C30203,867162050000000,GV350CEU,,1,12.3,90,543.0,106.917020,47.918680,20260625073045,0428,0001,1B2C,01234567,20260625073100,1A2B"
	m, ok := parse(on)
	if !ok || !m.hasRecord || m.record.Ignition == nil || !*m.record.Ignition {
		t.Fatalf("GTIGN should set ignition on: ok=%v rec=%v", ok, m.record.Ignition)
	}
	off := strings.Replace(on, "GTIGN", "GTIGF", 1)
	m, ok = parse(off)
	if !ok || m.record.Ignition == nil || *m.record.Ignition {
		t.Fatalf("GTIGF should set ignition off: %v", m.record.Ignition)
	}
}

func TestParseHeartbeat(t *testing.T) {
	hb := "+ACK:GTHBD,C30203,867162050000000,GV350CEU,20260625073045,00A1"
	m, ok := parse(hb)
	if !ok {
		t.Fatal("parse heartbeat ok=false")
	}
	if !m.heartbeat || !m.needsAck {
		t.Fatalf("heartbeat flags: hb=%v needsAck=%v", m.heartbeat, m.needsAck)
	}
	if m.count != "00A1" {
		t.Fatalf("count = %q", m.count)
	}
	if m.protocolVer != "C30203" {
		t.Fatalf("protocolVer = %q", m.protocolVer)
	}
}

func TestParseRejectsGarbage(t *testing.T) {
	// Unparseable: no colon, or too few fields to even be a header.
	for _, junk := range []string{"", "not-a-message", "+RESP:", "+RESP:GTFRI"} {
		if _, ok := parse(junk); ok {
			t.Fatalf("expected ok=false for %q", junk)
		}
	}
	// A well-formed header that carries neither an IMEI nor a GNSS fix parses
	// but yields nothing actionable — Handshake/ReadBatch skip it.
	m, ok := parse("+RESP:GTFRI,only,two")
	if !ok {
		t.Fatal("a 3-field header should still parse")
	}
	if m.imei != "" || m.hasRecord {
		t.Fatalf("expected no imei/record, got imei=%q hasRecord=%v", m.imei, m.hasRecord)
	}
}

// End-to-end through the Decoder over net.Pipe: a registered device's first
// GTFRI is read in Handshake (IMEI extracted) and replayed by ReadBatch.
func TestDecoderHandshakeReplay(t *testing.T) {
	srv, dev := net.Pipe()
	t.Cleanup(func() { _ = srv.Close(); _ = dev.Close() })
	go func() { _, _ = dev.Write([]byte(gtfri + "$")) }()

	dec := newTestDecoder(srv)
	imei, err := dec.Handshake(context.Background(), func(string) bool { return true })
	if err != nil {
		t.Fatalf("handshake: %v", err)
	}
	if imei != "867162050000000" {
		t.Fatalf("imei = %q", imei)
	}
	recs, _, ackable, err := dec.ReadBatch(context.Background())
	if err != nil {
		t.Fatalf("readbatch: %v", err)
	}
	if ackable {
		t.Fatal("+RESP messages are not record-acked")
	}
	if len(recs) != 1 || !floatEq(recs[0].Lat, 47.918680) {
		t.Fatalf("replayed records = %+v", recs)
	}
}

// The allowlist (audit P4) is enforced via the accept callback: a device the
// callback rejects gets ErrRejected and no IMEI.
func TestDecoderRejectsUnregistered(t *testing.T) {
	srv, dev := net.Pipe()
	t.Cleanup(func() { _ = srv.Close(); _ = dev.Close() })
	go func() { _, _ = dev.Write([]byte(gtfri + "$")) }()

	dec := newTestDecoder(srv)
	_, err := dec.Handshake(context.Background(), func(string) bool { return false })
	if !errors.Is(err, protocol.ErrRejected) {
		t.Fatalf("err = %v, want ErrRejected", err)
	}
}

// A heartbeat is answered with +SACK and does not surface as a record; the
// following GTFRI is the first batch returned.
func TestDecoderHeartbeatSACK(t *testing.T) {
	srv, dev := net.Pipe()
	t.Cleanup(func() { _ = srv.Close(); _ = dev.Close() })

	hb := "+ACK:GTHBD,C30203,867162050000000,GV350CEU,20260625073045,00A1$"
	sackCh := make(chan string, 1)
	go func() {
		_, _ = dev.Write([]byte(hb))
		// Read the server's +SACK response (net.Pipe is unbuffered).
		buf := make([]byte, 128)
		n, _ := dev.Read(buf)
		sackCh <- string(buf[:n])
		_, _ = dev.Write([]byte(gtfri + "$"))
	}()

	dec := newTestDecoder(srv)
	imei, err := dec.Handshake(context.Background(), func(string) bool { return true })
	if err != nil {
		t.Fatalf("handshake: %v", err)
	}
	if imei != "867162050000000" {
		t.Fatalf("imei = %q", imei)
	}
	sack := <-sackCh
	if !strings.HasPrefix(sack, "+SACK:GTHBD,C30203,00A1") {
		t.Fatalf("sack = %q", sack)
	}
	recs, _, _, err := dec.ReadBatch(context.Background())
	if err != nil || len(recs) != 1 {
		t.Fatalf("readbatch after heartbeat: recs=%v err=%v", recs, err)
	}
}

func TestEncodeAndSend(t *testing.T) {
	// RawText escape hatch is sent verbatim.
	assertSends(t, protocol.Command{RawText: "AT+GTRTO=pw,1,,,,,,FFFF$"}, "AT+GTRTO=pw,1,,,,,,FFFF$")
	// engine_block maps to an AT+GTOUT output-on command.
	out := captureSend(t, protocol.Command{Type: "engine_block", Params: map[string]string{"password": "secret", "serial": "0001"}})
	if !strings.HasPrefix(out, "AT+GTOUT=secret,1,") || !strings.HasSuffix(out, ",0001$") {
		t.Fatalf("engine_block = %q", out)
	}
}

func TestEncodeAndSendUnsupported(t *testing.T) {
	srv, dev := net.Pipe()
	t.Cleanup(func() { _ = srv.Close(); _ = dev.Close() })
	dec := newTestDecoder(srv)
	err := dec.EncodeAndSend(protocol.Command{Type: "do_a_barrel_roll"})
	if !errors.Is(err, protocol.ErrUnsupported) {
		t.Fatalf("err = %v, want ErrUnsupported", err)
	}
}

// --- helpers ----------------------------------------------------------------

func newTestDecoder(conn net.Conn) protocol.Decoder {
	f, ok := protocol.ByName("queclink")
	if !ok {
		panic("queclink decoder not registered")
	}
	return f(conn, protocol.Opts{ReadTimeout: 2 * time.Second, WriteTimeout: 2 * time.Second})
}

// captureSend runs EncodeAndSend over a pipe and returns what reached the wire.
func captureSend(t *testing.T, cmd protocol.Command) string {
	t.Helper()
	srv, dev := net.Pipe()
	t.Cleanup(func() { _ = srv.Close(); _ = dev.Close() })
	dec := newTestDecoder(srv)
	errCh := make(chan error, 1)
	go func() { errCh <- dec.EncodeAndSend(cmd) }()
	buf := make([]byte, 256)
	_ = dev.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, err := dev.Read(buf)
	if err != nil && err != io.EOF {
		t.Fatalf("read: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("EncodeAndSend: %v", err)
	}
	return string(buf[:n])
}

func assertSends(t *testing.T, cmd protocol.Command, want string) {
	t.Helper()
	if got := captureSend(t, cmd); got != want {
		t.Fatalf("sent %q, want %q", got, want)
	}
}

func floatEq(a, b float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d < 1e-6
}
