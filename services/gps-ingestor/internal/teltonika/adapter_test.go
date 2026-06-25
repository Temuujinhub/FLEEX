package teltonika

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"github.com/temuujinhub/fleex/services/gps-ingestor/internal/protocol"
)

// buildCodec8Record assembles a one-record Codec 8 payload (codecId, num=1,
// record, num2=1) carrying ignition (IO 239=1) and odometer (IO 16=123456) so
// the adapter's neutral mapping is exercised end-to-end, not just lat/lng.
func buildCodec8Record() []byte {
	var b bytes.Buffer
	b.WriteByte(Codec8)
	b.WriteByte(1) // num records
	// --- record ---
	binary.Write(&b, binary.BigEndian, uint64(1_700_000_000_000)) // ts ms
	b.WriteByte(0)                                                // priority
	binary.Write(&b, binary.BigEndian, uint32(1_069_170_200))     // lng = 106.917020
	binary.Write(&b, binary.BigEndian, uint32(479_186_800))       // lat = 47.918680
	binary.Write(&b, binary.BigEndian, uint16(543))               // altitude
	binary.Write(&b, binary.BigEndian, uint16(90))                // angle
	b.WriteByte(7)                                                // satellites
	binary.Write(&b, binary.BigEndian, uint16(12))                // speed km/h
	b.WriteByte(0)                                                // event IO
	b.WriteByte(2)                                                // total IO count
	// 1-byte section: ignition (239) = 1
	b.WriteByte(1)
	b.WriteByte(IOIgnition)
	b.WriteByte(1)
	// 2-byte section: none
	b.WriteByte(0)
	// 4-byte section: odometer (16) = 123456
	b.WriteByte(1)
	b.WriteByte(IOOdometerTotal)
	binary.Write(&b, binary.BigEndian, uint32(123_456))
	// 8-byte section: none
	b.WriteByte(0)
	// --- trailer ---
	b.WriteByte(1) // num2
	return b.Bytes()
}

func teltonikaFactory(t *testing.T) protocol.Factory {
	t.Helper()
	f, ok := protocol.ByName("teltonika")
	if !ok {
		t.Fatal("teltonika decoder not registered")
	}
	return f
}

// Full lifecycle through the protocol.Decoder seam: IMEI handshake (accepted),
// then one AVL frame decoded into a neutral record with normalised telemetry.
// This is the regression guard that the multi-protocol refactor did not change
// the production Teltonika path.
func TestAdapterHandshakeAndDecode(t *testing.T) {
	srv, dev := net.Pipe()
	t.Cleanup(func() { _ = srv.Close(); _ = dev.Close() })

	imei := "356938035643809"
	frame := buildFrame(buildCodec8Record())
	go func() {
		var lb [2]byte
		binary.BigEndian.PutUint16(lb[:], uint16(len(imei)))
		_, _ = dev.Write(lb[:])
		_, _ = dev.Write([]byte(imei))
		ack := make([]byte, 1)
		_, _ = io.ReadFull(dev, ack) // consume accept byte (net.Pipe is unbuffered)
		_, _ = dev.Write(frame)
		// consume the record-count ack so the server's Ack() doesn't block
		_, _ = io.ReadFull(dev, make([]byte, 4))
	}()

	dec := teltonikaFactory(t)(srv, protocol.Opts{ReadTimeout: 2 * time.Second, WriteTimeout: 2 * time.Second})
	if dec.Name() != "teltonika" {
		t.Fatalf("name = %q", dec.Name())
	}
	got, err := dec.Handshake(context.Background(), func(string) bool { return true })
	if err != nil {
		t.Fatalf("handshake: %v", err)
	}
	if got != imei {
		t.Fatalf("imei = %q want %q", got, imei)
	}
	recs, frameLen, ackable, err := dec.ReadBatch(context.Background())
	if err != nil {
		t.Fatalf("readbatch: %v", err)
	}
	if !ackable || frameLen != len(frame) {
		t.Fatalf("ackable=%v frameLen=%d (want %d)", ackable, frameLen, len(frame))
	}
	if len(recs) != 1 {
		t.Fatalf("records = %d", len(recs))
	}
	r := recs[0]
	if int(r.Lat*1e6) != 47918680 || int(r.Lng*1e6) != 106917020 {
		t.Fatalf("lat/lng = %v/%v", r.Lat, r.Lng)
	}
	if r.SpeedKmh != 12 || r.Course != 90 || r.Altitude != 543 {
		t.Fatalf("speed/course/alt = %v/%v/%v", r.SpeedKmh, r.Course, r.Altitude)
	}
	if !r.Valid {
		t.Fatal("7 satellites should be a valid fix")
	}
	if r.Ignition == nil || !*r.Ignition {
		t.Fatalf("ignition = %v", r.Ignition)
	}
	if r.OdometerKm == nil || *r.OdometerKm != 123.456 {
		t.Fatalf("odometer = %v", r.OdometerKm)
	}
	if err := dec.Ack(len(recs)); err != nil {
		t.Fatalf("ack: %v", err)
	}
}

// An unregistered IMEI (accept callback returns false) must get the Teltonika
// reject byte (0x00) and surface ErrRejected — preserving the audit P4
// allowlist through the new interface.
func TestAdapterRejectsUnregistered(t *testing.T) {
	srv, dev := net.Pipe()
	t.Cleanup(func() { _ = srv.Close(); _ = dev.Close() })

	imei := "111111111111111"
	replyCh := make(chan byte, 1)
	go func() {
		var lb [2]byte
		binary.BigEndian.PutUint16(lb[:], uint16(len(imei)))
		_, _ = dev.Write(lb[:])
		_, _ = dev.Write([]byte(imei))
		b := make([]byte, 1)
		_, _ = io.ReadFull(dev, b)
		replyCh <- b[0]
	}()

	dec := teltonikaFactory(t)(srv, protocol.Opts{ReadTimeout: 2 * time.Second, WriteTimeout: 2 * time.Second})
	_, err := dec.Handshake(context.Background(), func(string) bool { return false })
	if !errors.Is(err, protocol.ErrRejected) {
		t.Fatalf("err = %v, want ErrRejected", err)
	}
	if b := <-replyCh; b != 0x00 {
		t.Fatalf("reject byte = 0x%02x, want 0x00", b)
	}
}

// CRC handling moved into the adapter: a mismatch is always counted via
// Opts.CRCErrors, and dropped (zero records, frame not acked) only when
// VerifyCRC is set — matching the old main-loop behaviour.
func TestAdapterCRCErrorCountAndDrop(t *testing.T) {
	makeBadFrame := func() []byte {
		f := buildFrame(buildCodec8Record())
		f[len(f)-1] ^= 0xFF // corrupt the CRC trailer
		return f
	}

	// VerifyCRC off: record still flows, counter increments.
	t.Run("count only", func(t *testing.T) {
		srv, dev := net.Pipe()
		t.Cleanup(func() { _ = srv.Close(); _ = dev.Close() })
		go func() { _, _ = dev.Write(makeBadFrame()); _, _ = io.ReadFull(dev, make([]byte, 4)) }()

		var crc atomic.Uint64
		dec := teltonikaFactory(t)(srv, protocol.Opts{ReadTimeout: 2 * time.Second, WriteTimeout: 2 * time.Second, CRCErrors: &crc})
		recs, _, ackable, err := dec.ReadBatch(context.Background())
		if err != nil {
			t.Fatalf("readbatch: %v", err)
		}
		if len(recs) != 1 || !ackable {
			t.Fatalf("expected the frame to flow when VerifyCRC off: recs=%d ackable=%v", len(recs), ackable)
		}
		if crc.Load() != 1 {
			t.Fatalf("crc count = %d, want 1", crc.Load())
		}
	})

	// VerifyCRC on: frame dropped (no records, not ackable), counter increments.
	t.Run("drop", func(t *testing.T) {
		srv, dev := net.Pipe()
		t.Cleanup(func() { _ = srv.Close(); _ = dev.Close() })
		go func() { _, _ = dev.Write(makeBadFrame()) }()

		var crc atomic.Uint64
		dec := teltonikaFactory(t)(srv, protocol.Opts{ReadTimeout: 2 * time.Second, WriteTimeout: 2 * time.Second, VerifyCRC: true, CRCErrors: &crc})
		recs, _, ackable, err := dec.ReadBatch(context.Background())
		if err != nil {
			t.Fatalf("readbatch: %v", err)
		}
		if len(recs) != 0 || ackable {
			t.Fatalf("expected drop: recs=%d ackable=%v", len(recs), ackable)
		}
		if crc.Load() != 1 {
			t.Fatalf("crc count = %d, want 1", crc.Load())
		}
	})
}
