package teltonika

import (
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"
)

// drives one IMEI handshake over net.Pipe: the "device" side sends the IMEI
// frame and reads back the single accept/reject byte, while the caller runs the
// server side (ReadIMEI + Accept/Reject). Returns the IMEI the server parsed
// and the reply byte the device received.
func runHandshake(t *testing.T, imei string, accept bool) (string, byte) {
	t.Helper()
	c1, c2 := net.Pipe()
	t.Cleanup(func() { _ = c1.Close(); _ = c2.Close() })

	reply := make(chan byte, 1)
	go func() {
		var lb [2]byte
		binary.BigEndian.PutUint16(lb[:], uint16(len(imei)))
		_, _ = c2.Write(lb[:])
		_, _ = c2.Write([]byte(imei))
		b := make([]byte, 1)
		_, _ = io.ReadFull(c2, b)
		reply <- b[0]
	}()

	sess := NewSession(c1, 2*time.Second, 2*time.Second)
	got, err := sess.ReadIMEI()
	if err != nil {
		t.Fatalf("ReadIMEI: %v", err)
	}
	if accept {
		if err := sess.AcceptIMEI(); err != nil {
			t.Fatalf("AcceptIMEI: %v", err)
		}
	} else {
		if err := sess.RejectIMEI(); err != nil {
			t.Fatalf("RejectIMEI: %v", err)
		}
	}
	return got, <-reply
}

func TestHandshakeAccept(t *testing.T) {
	imei := "356938035643809"
	got, reply := runHandshake(t, imei, true)
	if got != imei {
		t.Fatalf("imei = %q, want %q", got, imei)
	}
	if reply != 0x01 {
		t.Fatalf("accept byte = 0x%02x, want 0x01", reply)
	}
}

func TestHandshakeReject(t *testing.T) {
	imei := "111111111111111"
	got, reply := runHandshake(t, imei, false)
	if got != imei {
		t.Fatalf("imei = %q, want %q", got, imei)
	}
	// A rejected (unregistered) device must receive 0x00 so it drops and retries.
	if reply != 0x00 {
		t.Fatalf("reject byte = 0x%02x, want 0x00", reply)
	}
}
