// Codec 12 implementation — server → device text commands. Used to deliver
// the commands queued in Postgres / Redis (engine block, setodometer,
// digital-output toggles, ...) over the device's open TCP socket.
//
// Wire format (server → device):
//
//	uint32 preamble  (0x00000000)
//	uint32 dataLen   (length of payload, in bytes)
//	uint8  codecId   (0x0C = Codec 12)
//	uint8  qty1      (number of commands; almost always 1)
//	uint8  cmdType   (0x05 = command, 0x06 = response)
//	uint32 cmdLen    (length of command bytes that follow)
//	bytes  command   (ASCII, e.g. "getinfo", "setdigout 1?? 1 0 0")
//	uint8  qty2      (must match qty1)
//	uint32 crc16     (CRC-16/IBM of payload, lower 16 bits)
//
// Device responds with the same envelope but cmdType = 0x06 and the
// response payload is the device's textual reply. We capture that reply
// elsewhere; here we only encode the outbound frame.

package teltonika

import (
	"encoding/binary"
	"errors"
	"fmt"
	"time"
)

// EncodeCodec12 builds a Codec 12 frame carrying a single ASCII command.
// Returns the bytes ready to be Write()n to the device's TCP socket.
func EncodeCodec12(command string) ([]byte, error) {
	if command == "" {
		return nil, errors.New("empty command")
	}
	if len(command) > 1024 {
		return nil, fmt.Errorf("command too long (%d bytes)", len(command))
	}
	cmdBytes := []byte(command)
	// Payload: codecId(1) + qty1(1) + cmdType(1) + cmdLen(4) + cmd + qty2(1).
	payloadLen := 1 + 1 + 1 + 4 + len(cmdBytes) + 1
	frame := make([]byte, 0, 4+4+payloadLen+4)
	frame = append(frame, 0x00, 0x00, 0x00, 0x00)          // preamble
	frame = append(frame, 0x00, 0x00, 0x00, 0x00)          // dataLen placeholder
	binary.BigEndian.PutUint32(frame[4:8], uint32(payloadLen))
	// Payload starts here.
	payloadStart := len(frame)
	frame = append(frame, 0x0C) // codec id 12
	frame = append(frame, 0x01) // qty1 = 1
	frame = append(frame, 0x05) // cmdType = command
	cl := make([]byte, 4)
	binary.BigEndian.PutUint32(cl, uint32(len(cmdBytes)))
	frame = append(frame, cl...)
	frame = append(frame, cmdBytes...)
	frame = append(frame, 0x01) // qty2 = 1
	// CRC-16/IBM over payload only (lower 16 bits in a uint32 trailer).
	crc := crc16IBM(frame[payloadStart:])
	crcBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(crcBytes, uint32(crc))
	frame = append(frame, crcBytes...)
	return frame, nil
}

// SendCommand writes a Codec 12 command frame onto the open device socket
// and updates the write deadline. Caller is responsible for queueing
// retries on failure.
func (s *Session) SendCommand(text string) error {
	frame, err := EncodeCodec12(text)
	if err != nil {
		return err
	}
	if err := s.conn.SetWriteDeadline(time.Now().Add(s.writeTimeout)); err != nil {
		return err
	}
	_, err = s.conn.Write(frame)
	return err
}

// crc16IBM is the CRC-16 IBM (a.k.a. ARC) used by Teltonika.
func crc16IBM(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}
