// Package camera implements the Teltonika DualCam server-side file-transfer
// protocol (wiki: DualCam_Communication_Protocol). The device connects, sends
// a 16-byte init packet, then the server drives transfer with command frames
// [CMD 2B][len 2B][data]:
//
//	0x0008 FILE REQ   server -> device   ("%photof" / "%videof" / ...)
//	0x0001 START      device -> server   (file packet count)
//	0x0002 RESUME     server -> device   (packet offset, 1-based)
//	0x0003 SYNC       device -> server
//	0x0004 DATA       device -> server   (<=1024B file data + CRC16)
//	0x0005 COMPLETED  server -> device   (status 0 → device disconnects)
//
// Ported from the proven camera-test rig, hardened for production: unknown
// IMEIs are refused, transfers are size-capped, and blobs/metadata are
// persisted tenant-scoped via the store.
package camera

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/temuujinhub/fleex/services/media-service/internal/config"
	"github.com/temuujinhub/fleex/services/media-service/internal/store"
)

// maxPackets caps a single file at 64 MB (65536 * 1024B) so a malicious or
// faulty camera can't drive an unbounded allocation from the START count.
const maxPackets = 1 << 16

// Handle drives one DualCam connection to completion.
func Handle(ctx context.Context, conn net.Conn, st *store.Store, cfg *config.Config) {
	remote := conn.RemoteAddr().String()

	readCmd := func() (uint16, []byte, error) {
		_ = conn.SetReadDeadline(time.Now().Add(cfg.ReadTimeout))
		var hdr [4]byte
		if _, err := io.ReadFull(conn, hdr[:]); err != nil {
			return 0, nil, err
		}
		cmd := binary.BigEndian.Uint16(hdr[0:2])
		ln := binary.BigEndian.Uint16(hdr[2:4])
		data := make([]byte, ln)
		if ln > 0 {
			if _, err := io.ReadFull(conn, data); err != nil {
				return cmd, nil, err
			}
		}
		return cmd, data, nil
	}
	sendCmd := func(cmd uint16, data []byte) error {
		_ = conn.SetWriteDeadline(time.Now().Add(cfg.WriteTimeout))
		hdr := []byte{byte(cmd >> 8), byte(cmd), byte(len(data) >> 8), byte(len(data))}
		if _, err := conn.Write(hdr); err != nil {
			return err
		}
		if len(data) > 0 {
			if _, err := conn.Write(data); err != nil {
				return err
			}
		}
		return nil
	}

	// Initialization packet (16 bytes): [0x0000][protoID 2B][IMEI 8B][settings 4B]
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	var ini [16]byte
	if _, err := io.ReadFull(conn, ini[:]); err != nil {
		log.Debug().Err(err).Str("remote", remote).Msg("cam read init")
		return
	}
	if binary.BigEndian.Uint16(ini[0:2]) != 0x0000 {
		log.Warn().Str("remote", remote).Msgf("cam unexpected init header: % x", ini[:4])
		return
	}
	imei := fmt.Sprintf("%d", binary.BigEndian.Uint64(ini[4:12]))
	logger := log.With().Str("imei", imei).Str("remote", remote).Logger()

	// Refuse unknown devices — we won't store media we can't tenant-scope.
	dev, ok := st.ResolveDevice(ctx, imei)
	if !ok {
		logger.Warn().Msg("cam unknown device — refusing transfer")
		return
	}

	// pull drains every available file of one type via START→RESUME→SYNC→DATA.
	pull := func(identifier, kind, trigger string) int {
		saved := 0
		for {
			if err := sendCmd(0x0008, []byte(identifier)); err != nil { // FILE REQ
				return saved
			}
			cmd, data, err := readCmd()
			if err != nil {
				return saved
			}
			if cmd != 0x0001 || len(data) < 4 { // not START → none left / error
				return saved
			}
			packets := binary.BigEndian.Uint32(data[0:4])
			if packets == 0 {
				return saved
			}
			if packets > maxPackets {
				logger.Warn().Uint32("packets", packets).Msg("cam refusing oversized transfer")
				return saved
			}
			logger.Info().Str("id", identifier).Uint32("packets", packets).Msg("cam transfer START")
			if err := sendCmd(0x0002, []byte{0, 0, 0, 1}); err != nil { // RESUME from packet 1
				return saved
			}
			if sc, _, se := readCmd(); se != nil || sc != 0x0003 { // SYNC
				logger.Debug().Uint16("got", sc).Msg("cam expected SYNC")
				return saved
			}
			fileBuf := make([]byte, 0, int(packets)*1024)
			var prevCRC uint16
			complete := true
			for i := uint32(0); i < packets; i++ {
				dc, dd, de := readCmd()
				if de != nil || dc != 0x0004 || len(dd) < 2 {
					logger.Debug().Uint32("pkt", i+1).Uint16("cmd", dc).Msg("cam DATA fail")
					complete = false
					break
				}
				fileData := dd[:len(dd)-2]
				pktCRC := binary.BigEndian.Uint16(dd[len(dd)-2:])
				if calc := crc16(fileData, prevCRC); calc != pktCRC {
					logger.Debug().Uint32("pkt", i+1).Msg("cam packet CRC mismatch")
				}
				prevCRC = pktCRC // chain: each packet's CRC seeds the next
				fileBuf = append(fileBuf, fileData...)
			}
			if !complete {
				return saved
			}
			if name, e := st.SaveMedia(ctx, dev, imei, kind, trigger, fileBuf); e == nil {
				saved++
				logger.Info().Str("kind", kind).Str("file", name).Int("bytes", len(fileBuf)).Msg("cam media saved")
			} else {
				logger.Warn().Err(e).Msg("cam save media")
			}
		}
	}

	photos, videos := 0, 0
	if cfg.AutoPull || st.TakePhotoRequest(ctx, imei) {
		trigger := "manual"
		if cfg.AutoPull {
			trigger = "auto"
		}
		photos = pull("%photof", "photo", trigger)
	}
	if st.TakeVideoRequest(ctx, imei) {
		videos = pull("%videof", "video", "manual")
	}
	_ = sendCmd(0x0005, []byte{0, 0, 0, 0}) // COMPLETED → device disconnects
	logger.Info().Int("photos", photos).Int("videos", videos).Msg("cam session done")
}

// crc16 is Teltonika DualCam's CRC-16 (poly 0x8408), seeded with the previous
// packet's CRC (chained across a file's packets).
func crc16(data []byte, init uint16) uint16 {
	crc := init
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			carry := crc & 1
			crc >>= 1
			if carry != 0 {
				crc ^= 0x8408
			}
		}
	}
	return crc
}
