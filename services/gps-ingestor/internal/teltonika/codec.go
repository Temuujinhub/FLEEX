// Package teltonika decodes the Teltonika Codec 8 and Codec 8 Extended
// protocols. Reference: Teltonika "Codec 8 / 8E Protocols" wiki page.
//
// Wire format summary (per TCP frame):
//
//	uint32 preamble  (always 0x00000000)
//	uint32 dataLen   (length of payload, in bytes)
//	uint8  codecId   (0x08 = Codec 8, 0x8E = Codec 8E)
//	uint8  numData1
//	repeated AVL records ...
//	uint8  numData2  (must equal numData1)
//	uint32 crc16     (CRC-16/IBM over payload, lower 16 bits)
//
// Handshake: first packet from device is its IMEI length (uint16) + IMEI
// bytes. Server responds with one byte: 0x01 to accept, 0x00 to reject.
package teltonika

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"time"
)

const (
	CodecGH        = 0x07
	Codec8         = 0x08
	Codec8Extended = 0x8E
	Codec16        = 0x10
)

// Record is a single decoded AVL data record.
type Record struct {
	Timestamp  time.Time
	Priority   uint8
	Lng        float64
	Lat        float64
	Altitude   int16
	Angle      uint16
	Satellites uint8
	Speed      uint16
	EventIO    uint16
	IO         map[uint16]int64  // ioId -> value (sign-extended where applicable)
	// IOStrings keeps the ASCII payload of Codec 8E variable-length IOs
	// when the bytes look like printable text (VIN, firmware string,
	// driver-card UID, ...). Numeric io map still gets a truncated
	// int64 in `IO` for backwards compatibility; consumers that want
	// the textual form should prefer `IOStrings`.
	IOStrings  map[uint16]string
}

// Session manages one device connection.
type Session struct {
	conn         net.Conn
	r            *bufio.Reader
	readTimeout  time.Duration
	writeTimeout time.Duration
	imei         string
	lastFrameLen int  // total bytes of the most recent AVL frame (header + payload + crc)
	lastCRCOK    bool // whether the most recent AVL frame's CRC-16/IBM matched
}

func NewSession(conn net.Conn, rTO, wTO time.Duration) *Session {
	return &Session{
		conn:         conn,
		r:            bufio.NewReaderSize(conn, 8192),
		readTimeout:  rTO,
		writeTimeout: wTO,
	}
}

// LastFrameLen returns the byte size of the most recently read AVL frame so
// the store can credit it against the device's monthly GPRS counter.
func (s *Session) LastFrameLen() int { return s.lastFrameLen }

// LastCRCOK reports whether the CRC-16/IBM of the most recently read AVL
// frame matched the value the device sent. The caller decides whether a
// mismatch should drop the frame (INGESTOR_VERIFY_CRC) so enforcement is a
// safe, observable opt-in on real hardware.
func (s *Session) LastCRCOK() bool { return s.lastCRCOK }

// Handshake performs the Teltonika IMEI handshake and returns the IMEI.
func (s *Session) Handshake() (string, error) {
	if err := s.conn.SetReadDeadline(time.Now().Add(s.readTimeout)); err != nil {
		return "", err
	}
	var lenBuf [2]byte
	if _, err := io.ReadFull(s.r, lenBuf[:]); err != nil {
		return "", fmt.Errorf("read imei len: %w", err)
	}
	n := binary.BigEndian.Uint16(lenBuf[:])
	if n == 0 || n > 64 {
		return "", fmt.Errorf("bogus imei length %d", n)
	}
	imei := make([]byte, n)
	if _, err := io.ReadFull(s.r, imei); err != nil {
		return "", fmt.Errorf("read imei: %w", err)
	}
	for _, b := range imei {
		if b < '0' || b > '9' {
			return "", fmt.Errorf("non-numeric imei: %s", hex.EncodeToString(imei))
		}
	}

	if err := s.conn.SetWriteDeadline(time.Now().Add(s.writeTimeout)); err != nil {
		return "", err
	}
	if _, err := s.conn.Write([]byte{0x01}); err != nil {
		return "", fmt.Errorf("imei ack: %w", err)
	}
	s.imei = string(imei)
	return s.imei, nil
}

// ReadAVL reads one AVL data packet and returns its records.
func (s *Session) ReadAVL() ([]Record, error) {
	if err := s.conn.SetReadDeadline(time.Now().Add(s.readTimeout)); err != nil {
		return nil, err
	}

	var header [8]byte
	if _, err := io.ReadFull(s.r, header[:]); err != nil {
		return nil, err
	}
	if binary.BigEndian.Uint32(header[0:4]) != 0 {
		return nil, errors.New("invalid preamble")
	}
	dataLen := binary.BigEndian.Uint32(header[4:8])
	// Minimum valid payload is codecId(1) + numData1(1) + numData2(1) = 3
	// bytes (a zero-record frame). Anything shorter cannot carry codec/count
	// bytes — rejecting it here prevents the payload[0]/payload[1] indexing
	// below from panicking on a 1- or 2-byte payload (remote DoS guard).
	if dataLen < 3 || dataLen > 1<<20 {
		return nil, fmt.Errorf("bad data len %d", dataLen)
	}

	payload := make([]byte, dataLen)
	if _, err := io.ReadFull(s.r, payload); err != nil {
		return nil, err
	}

	var trailer [4]byte
	if _, err := io.ReadFull(s.r, trailer[:]); err != nil {
		return nil, err
	}
	// CRC-16/IBM is computed over the payload (codecId..numData2). We always
	// evaluate it so the ingestor can surface a mismatch counter; whether a
	// mismatch *drops* the frame is the caller's decision via
	// INGESTOR_VERIFY_CRC, keeping enforcement a safe opt-in on real hardware.
	s.lastCRCOK = crc16IBM(payload) == uint16(binary.BigEndian.Uint32(trailer[:]))

	// Header(8) + payload(dataLen) + trailer(4) — total bytes-on-wire for this
	// AVL packet. Recorded so the store can charge the GPRS counter.
	s.lastFrameLen = 8 + int(dataLen) + 4

	codec := payload[0]
	num := payload[1]
	if codec != Codec8 && codec != Codec8Extended {
		return nil, fmt.Errorf("unsupported codec 0x%x", codec)
	}

	records := make([]Record, 0, num)
	p := newParser(payload[2:])
	for i := 0; i < int(num); i++ {
		rec, err := p.readRecord(codec)
		if err != nil {
			return nil, fmt.Errorf("record %d: %w", i, err)
		}
		records = append(records, rec)
	}
	tailNum, err := p.readUint8()
	if err != nil {
		return nil, fmt.Errorf("read trailing count: %w", err)
	}
	if tailNum != num {
		return nil, fmt.Errorf("record count mismatch: %d vs %d", num, tailNum)
	}
	return records, nil
}

// AckRecords sends the per-Teltonika "number of records accepted" response.
func (s *Session) AckRecords(n int) error {
	if err := s.conn.SetWriteDeadline(time.Now().Add(s.writeTimeout)); err != nil {
		return err
	}
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], uint32(n))
	_, err := s.conn.Write(b[:])
	return err
}

// --- parser -----------------------------------------------------------------

type parser struct {
	buf []byte
	off int
}

func newParser(b []byte) *parser { return &parser{buf: b} }

func (p *parser) need(n int) error {
	if p.off+n > len(p.buf) {
		return io.ErrUnexpectedEOF
	}
	return nil
}

func (p *parser) readUint8() (uint8, error) {
	if err := p.need(1); err != nil {
		return 0, err
	}
	v := p.buf[p.off]
	p.off++
	return v, nil
}

func (p *parser) readUint16() (uint16, error) {
	if err := p.need(2); err != nil {
		return 0, err
	}
	v := binary.BigEndian.Uint16(p.buf[p.off:])
	p.off += 2
	return v, nil
}

func (p *parser) readUint32() (uint32, error) {
	if err := p.need(4); err != nil {
		return 0, err
	}
	v := binary.BigEndian.Uint32(p.buf[p.off:])
	p.off += 4
	return v, nil
}

func (p *parser) readUint64() (uint64, error) {
	if err := p.need(8); err != nil {
		return 0, err
	}
	v := binary.BigEndian.Uint64(p.buf[p.off:])
	p.off += 8
	return v, nil
}

func (p *parser) readBytes(n int) ([]byte, error) {
	if err := p.need(n); err != nil {
		return nil, err
	}
	b := p.buf[p.off : p.off+n]
	p.off += n
	return b, nil
}

func (p *parser) readRecord(codec uint8) (Record, error) {
	var rec Record
	tsMs, err := p.readUint64()
	if err != nil {
		return rec, err
	}
	rec.Timestamp = time.UnixMilli(int64(tsMs)).UTC()

	pr, err := p.readUint8()
	if err != nil {
		return rec, err
	}
	rec.Priority = pr

	lngRaw, err := p.readUint32()
	if err != nil {
		return rec, err
	}
	latRaw, err := p.readUint32()
	if err != nil {
		return rec, err
	}
	rec.Lng = float64(int32(lngRaw)) / 10_000_000.0
	rec.Lat = float64(int32(latRaw)) / 10_000_000.0

	alt, err := p.readUint16()
	if err != nil {
		return rec, err
	}
	rec.Altitude = int16(alt)

	ang, err := p.readUint16()
	if err != nil {
		return rec, err
	}
	rec.Angle = ang

	sat, err := p.readUint8()
	if err != nil {
		return rec, err
	}
	rec.Satellites = sat

	sp, err := p.readUint16()
	if err != nil {
		return rec, err
	}
	rec.Speed = sp

	// Event IO id and total IO count. Codec 8 uses 1-byte ids and counts;
	// Codec 8E uses 2-byte ids and 2-byte counts.
	if codec == Codec8 {
		evt, err := p.readUint8()
		if err != nil {
			return rec, err
		}
		rec.EventIO = uint16(evt)
		total, err := p.readUint8()
		if err != nil {
			return rec, err
		}
		_ = total // we read by section count anyway
		rec.IO = make(map[uint16]int64, 16)
		for _, size := range []int{1, 2, 4, 8} {
			n, err := p.readUint8()
			if err != nil {
				return rec, err
			}
			for i := 0; i < int(n); i++ {
				id, err := p.readUint8()
				if err != nil {
					return rec, err
				}
				val, err := p.readSignedN(size)
				if err != nil {
					return rec, err
				}
				rec.IO[uint16(id)] = val
			}
		}
	} else { // Codec 8E
		evt, err := p.readUint16()
		if err != nil {
			return rec, err
		}
		rec.EventIO = evt
		total, err := p.readUint16()
		if err != nil {
			return rec, err
		}
		_ = total
		rec.IO = make(map[uint16]int64, 24)
		for _, size := range []int{1, 2, 4, 8} {
			n, err := p.readUint16()
			if err != nil {
				return rec, err
			}
			for i := 0; i < int(n); i++ {
				id, err := p.readUint16()
				if err != nil {
					return rec, err
				}
				val, err := p.readSignedN(size)
				if err != nil {
					return rec, err
				}
				rec.IO[id] = val
			}
		}
		// Variable-length section (codec 8E only). Holds VIN, firmware
		// version, RFID UIDs and similar strings — anything that doesn't
		// fit into the fixed 1/2/4/8-byte buckets.
		nvar, err := p.readUint16()
		if err != nil {
			return rec, err
		}
		if nvar > 0 && rec.IOStrings == nil {
			rec.IOStrings = make(map[uint16]string, nvar)
		}
		for i := 0; i < int(nvar); i++ {
			id, err := p.readUint16()
			if err != nil {
				return rec, err
			}
			ln, err := p.readUint16()
			if err != nil {
				return rec, err
			}
			payload, err := p.readBytes(int(ln))
			if err != nil {
				return rec, err
			}
			// Keep first 8 bytes as int64 for callers that already index
			// by `rec.IO[id]`. The full payload also lands in IOStrings
			// when it's printable ASCII, so the API can use the textual
			// form for VIN auto-population and similar.
			n := len(payload)
			if n > 8 {
				n = 8
			}
			var v int64
			for _, b := range payload[:n] {
				v = (v << 8) | int64(b)
			}
			rec.IO[id] = v

			if isPrintableASCII(payload) && len(payload) > 0 {
				rec.IOStrings[id] = string(payload)
			}
		}
	}
	return rec, nil
}

// isPrintableASCII returns true when every byte is printable 7-bit ASCII
// (including space). Used to pick out VIN-like fields in the variable
// IO section without misinterpreting binary RFID UIDs as text.
func isPrintableASCII(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	for _, c := range b {
		if c < 0x20 || c > 0x7E {
			return false
		}
	}
	return true
}

func (p *parser) readSignedN(size int) (int64, error) {
	b, err := p.readBytes(size)
	if err != nil {
		return 0, err
	}
	var v int64
	if b[0]&0x80 != 0 {
		v = -1
	}
	for _, x := range b {
		v = (v << 8) | int64(x)
	}
	return v, nil
}
