package teltonika

import (
	"encoding/binary"
	"math"
	"net"
	"testing"
	"time"
)

// buildFrame wraps a payload in the Teltonika TCP envelope:
// preamble(4) + dataLen(4) + payload + crc(4, lower 16 bits = CRC-16/IBM).
func buildFrame(payload []byte) []byte {
	f := make([]byte, 0, 8+len(payload)+4)
	f = append(f, 0, 0, 0, 0) // preamble
	dl := make([]byte, 4)
	binary.BigEndian.PutUint32(dl, uint32(len(payload)))
	f = append(f, dl...)
	f = append(f, payload...)
	tr := make([]byte, 4)
	binary.BigEndian.PutUint32(tr, uint32(crc16IBM(payload)))
	return append(f, tr...)
}

// decodeFrame feeds raw bytes through a real Session over net.Pipe and returns
// the result. A panic is converted to a test failure so a parser regression
// can never silently pass.
func decodeFrame(t *testing.T, frame []byte) (sess *Session, recs []Record, err error) {
	t.Helper()
	c1, c2 := net.Pipe()
	t.Cleanup(func() { _ = c1.Close(); _ = c2.Close() })
	go func() { _, _ = c2.Write(frame) }()

	sess = NewSession(c1, 2*time.Second, 2*time.Second)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("ReadAVL panicked on input %x: %v", frame, r)
		}
	}()
	recs, err = sess.ReadAVL()
	return sess, recs, err
}

// Regression for the remote-DoS panic: a frame whose dataLen is below the
// 3-byte minimum used to index payload[1] / payload[2:] out of range and
// crash the whole ingestor. It must now return an error, not panic.
func TestReadAVL_RejectsShortDataLen(t *testing.T) {
	for _, dl := range []uint32{1, 2} {
		frame := make([]byte, 0, 16)
		frame = append(frame, 0, 0, 0, 0) // preamble
		b := make([]byte, 4)
		binary.BigEndian.PutUint32(b, dl)
		frame = append(frame, b...)
		frame = append(frame, make([]byte, dl)...) // short payload
		frame = append(frame, 0, 0, 0, 0)          // trailer
		if _, _, err := decodeFrame(t, frame); err == nil {
			t.Fatalf("dataLen=%d: expected error, got nil", dl)
		}
	}
}

// A minimal valid Codec 8 frame with zero records (codec, num=0, num2=0)
// decodes cleanly and its CRC verifies.
func TestReadAVL_ZeroRecordsValidCRC(t *testing.T) {
	frame := buildFrame([]byte{Codec8, 0x00, 0x00})
	sess, recs, err := decodeFrame(t, frame)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(recs) != 0 {
		t.Fatalf("expected 0 records, got %d", len(recs))
	}
	if !sess.LastCRCOK() {
		t.Fatal("expected CRC to verify on a well-formed frame")
	}
}

// A corrupted trailer must be detectable via LastCRCOK (enforcement is opt-in
// at the caller, but the signal has to be correct).
func TestReadAVL_DetectsCRCMismatch(t *testing.T) {
	frame := buildFrame([]byte{Codec8, 0x00, 0x00})
	frame[len(frame)-1] ^= 0xFF // corrupt the CRC trailer
	sess, _, err := decodeFrame(t, frame)
	if err != nil {
		t.Fatalf("a CRC mismatch must still parse (caller decides to drop): %v", err)
	}
	if sess.LastCRCOK() {
		t.Fatal("expected CRC mismatch to be reported")
	}
}

// Locks in the two's-complement sign extension for every IO width. The 8-byte
// case in particular was suspected to overflow; this proves it does not.
func TestReadSignedN(t *testing.T) {
	cases := []struct {
		bytes []byte
		size  int
		want  int64
	}{
		{[]byte{0xFF}, 1, -1},
		{[]byte{0x80}, 1, -128},
		{[]byte{0x7F}, 1, 127},
		{[]byte{0xFF, 0xFF}, 2, -1},
		{[]byte{0x80, 0x00}, 2, -32768},
		{[]byte{0x80, 0x00, 0x00, 0x00}, 4, math.MinInt32},
		{[]byte{0x00, 0x00, 0x01, 0x00}, 4, 256},
		{[]byte{0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}, 8, -1},
		{[]byte{0x80, 0, 0, 0, 0, 0, 0, 0}, 8, math.MinInt64},
		{[]byte{0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}, 8, math.MaxInt64},
	}
	for _, c := range cases {
		p := newParser(c.bytes)
		got, err := p.readSignedN(c.size)
		if err != nil {
			t.Fatalf("size=%d bytes=%x: %v", c.size, c.bytes, err)
		}
		if got != c.want {
			t.Errorf("size=%d bytes=%x: got %d want %d", c.size, c.bytes, got, c.want)
		}
	}
}
