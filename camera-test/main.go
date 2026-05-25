// Command camtest is a SELF-CONTAINED, ISOLATED rig for testing a Teltonika
// FMC125 + DualCam against a throwaway web page — without touching the
// production Fleex stack. It listens on three ports:
//
//	:5028  AVL telemetry (Codec 8 / 8E)  -> live position on the map
//	:5029  DualCam camera server          -> captures images (+ raw stream)
//	:8090  HTTP                            -> demo page + JSON API + images
//
// Everything is in-memory plus a data volume for images; there is no database,
// no Redis, and no link to the prod containers. Tear down with
// `docker compose -f docker-compose.cam.yml down -v` and nothing remains.
package main

import (
	"embed"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"fleex-camtest/teltonika"
)

//go:embed web/index.html
var webFS embed.FS

const maxTrack = 5000

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

type Point struct {
	Lat   float64 `json:"lat"`
	Lng   float64 `json:"lng"`
	Speed uint16  `json:"speed"`
	Angle uint16  `json:"angle"`
	Time  int64   `json:"time"` // unix ms (device time)
}

type Device struct {
	IMEI      string  `json:"imei"`
	Last      Point   `json:"last"`
	Track     []Point `json:"track"`
	Online    int64   `json:"online"`    // unix ms (server last-seen, AVL)
	CamOnline int64   `json:"camOnline"` // unix ms (last camera-server contact)
	CamBytes  int64   `json:"camBytes"`  // total bytes received on the camera port
}

type Image struct {
	IMEI string `json:"imei"`
	Time int64  `json:"time"` // unix ms (server received)
	File string `json:"file"`
	Size int64  `json:"size"`
	Kind string `json:"kind"` // "photo" | "video"
}

type Store struct {
	mu         sync.RWMutex
	devices    map[string]*Device
	images     []Image
	imageDir   string
	rawDir     string
	maxFiles   int  // retention cap; oldest media pruned beyond this
	videoReq   bool // one-shot: pull a video on the next camera connection
	photoReq   bool // one-shot: pull a photo (snapshot) on the next connection
	rawEnabled bool // capture raw camera streams to disk (diagnostics only)
}

func NewStore(imageDir, rawDir string, maxFiles int) *Store {
	return &Store{devices: map[string]*Device{}, imageDir: imageDir, rawDir: rawDir, maxFiles: maxFiles}
}

// requestVideo / requestPhoto arm a one-shot pull, honoured on the camera's
// next connection. Nothing is downloaded otherwise — no continuous saving.
func (s *Store) requestVideo() {
	s.mu.Lock()
	s.videoReq = true
	s.mu.Unlock()
}

func (s *Store) takeVideoRequest() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.videoReq {
		s.videoReq = false
		return true
	}
	return false
}

func (s *Store) requestPhoto() {
	s.mu.Lock()
	s.photoReq = true
	s.mu.Unlock()
}

func (s *Store) takePhotoRequest() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.photoReq {
		s.photoReq = false
		return true
	}
	return false
}

func (s *Store) device(imei string) *Device {
	d := s.devices[imei]
	if d == nil {
		d = &Device{IMEI: imei}
		s.devices[imei] = d
	}
	return d
}

func (s *Store) markOnline(imei string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.device(imei).Online = time.Now().UnixMilli()
}

func (s *Store) camData(imei string, delta int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.device(imei)
	d.CamOnline = time.Now().UnixMilli()
	d.CamBytes += int64(delta)
}

func (s *Store) updatePositions(imei string, recs []teltonika.Record) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.device(imei)
	d.Online = time.Now().UnixMilli()
	for _, r := range recs {
		if r.Lat == 0 && r.Lng == 0 {
			continue // no GPS fix yet
		}
		p := Point{Lat: r.Lat, Lng: r.Lng, Speed: r.Speed, Angle: r.Angle, Time: r.Timestamp.UnixMilli()}
		d.Last = p
		d.Track = append(d.Track, p)
		if len(d.Track) > maxTrack {
			d.Track = d.Track[len(d.Track)-maxTrack:]
		}
	}
}

func (s *Store) addMedia(imei string, data []byte, kind string) (string, error) {
	ext := "jpg"
	if kind == "video" {
		ext = "h264" // raw stream; browser playback needs conversion (follow-up)
	}
	id := sanitize(imei)
	ms := time.Now().UnixMilli()
	var name string
	for { // ensure a unique filename even for same-millisecond bursts
		name = fmt.Sprintf("%s_%d.%s", id, ms, ext)
		if _, err := os.Stat(filepath.Join(s.imageDir, name)); os.IsNotExist(err) {
			break
		}
		ms++
	}
	if err := os.WriteFile(filepath.Join(s.imageDir, name), data, 0o644); err != nil {
		return "", err
	}
	s.mu.Lock()
	s.images = append(s.images, Image{IMEI: imei, Time: ms, File: name, Size: int64(len(data)), Kind: kind})
	s.pruneLocked()
	s.mu.Unlock()
	return name, nil
}

// pruneLocked enforces the retention cap by deleting the oldest media files so
// the test rig never accumulates much data (storage is expanded properly only
// once the fleet rollout / contract happens). Caller must hold s.mu.
func (s *Store) pruneLocked() {
	if s.maxFiles <= 0 || len(s.images) <= s.maxFiles {
		return
	}
	sort.Slice(s.images, func(i, j int) bool { return s.images[i].Time < s.images[j].Time }) // oldest first
	excess := len(s.images) - s.maxFiles
	for _, im := range s.images[:excess] {
		_ = os.Remove(filepath.Join(s.imageDir, im.File))
	}
	s.images = append([]Image(nil), s.images[excess:]...)
}

func (s *Store) snapshotDevices() []Device {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Device, 0, len(s.devices))
	for _, d := range s.devices {
		cp := *d
		cp.Track = append([]Point(nil), d.Track...)
		out = append(out, cp)
	}
	return out
}

func (s *Store) snapshotImages() []Image {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Image, 0, len(s.images))
	out = append(out, s.images...)
	sort.Slice(out, func(i, j int) bool { return out[i].Time > out[j].Time })
	return out
}

// loadExisting rebuilds the image list from disk so a restart keeps the
// gallery (filenames encode the IMEI and receive time).
func (s *Store) loadExisting() {
	entries, _ := os.ReadDir(s.imageDir)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		kind := ""
		if strings.HasSuffix(e.Name(), ".jpg") {
			kind = "photo"
		} else if strings.HasSuffix(e.Name(), ".h264") {
			kind = "video"
		} else {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		imei, ms := parseName(e.Name())
		s.images = append(s.images, Image{IMEI: imei, Time: ms, File: e.Name(), Size: info.Size(), Kind: kind})
	}
	s.mu.Lock()
	s.pruneLocked()
	s.mu.Unlock()
	log.Printf("loaded %d existing media file(s) from %s", len(s.images), s.imageDir)
}

func parseName(name string) (string, int64) {
	base := name
	if i := strings.LastIndex(base, "."); i >= 0 {
		base = base[:i]
	}
	i := strings.LastIndex(base, "_")
	if i < 0 {
		return base, 0
	}
	ms, _ := strconv.ParseInt(base[i+1:], 10, 64)
	return base[:i], ms
}

func sanitize(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			out = append(out, r)
		}
	}
	return string(out)
}

// --- TCP: AVL telemetry (:5028) --------------------------------------------

func handleAVL(conn net.Conn, st *Store) {
	defer conn.Close()
	sess := teltonika.NewSession(conn, 180*time.Second, 30*time.Second)
	imei, err := sess.Handshake()
	if err != nil {
		log.Printf("[avl] handshake %s: %v", conn.RemoteAddr(), err)
		return
	}
	log.Printf("[avl] connected imei=%s remote=%s", imei, conn.RemoteAddr())
	defer log.Printf("[avl] disconnected imei=%s", imei)
	st.markOnline(imei)
	for {
		recs, err := sess.ReadAVL()
		if err != nil {
			if err != io.EOF {
				log.Printf("[avl] read imei=%s: %v", imei, err)
			}
			return
		}
		if len(recs) > 0 {
			st.updatePositions(imei, recs)
			log.Printf("[avl] imei=%s records=%d last=%.6f,%.6f", imei, len(recs), recs[len(recs)-1].Lat, recs[len(recs)-1].Lng)
		}
		if err := sess.AckRecords(len(recs)); err != nil {
			return
		}
	}
}

// --- TCP: DualCam camera server (:5029) ------------------------------------
//
// The exact DualCam image framing (metadata version 3) isn't reimplemented
// here; instead we ACK the IMEI handshake, dump the raw stream to disk for
// later protocol analysis, and recover any complete JPEG (FF D8 FF ... FF D9)
// from the byte stream. That gets pictures on screen for the demo regardless
// of the surrounding framing. Refine into a proper parser once a raw capture
// is in hand.

// handleCamera implements the Teltonika DualCam server protocol
// (wiki: DualCam_Communication_Protocol). On connect the device sends a 16-byte
// initialization packet [header 0x0000][protocol ID][IMEI 8B][settings 4B]; the
// server then drives file transfer with the command structure
// [CMD_ID 2B][data length 2B][data]:
//
//	0x0008 FILE REQ  ("%photof"/"%photor"/...)  server -> device
//	0x0001 START     (file packet count)        device -> server
//	0x0002 RESUME    (packet offset, 1-based)    server -> device
//	0x0003 SYNC      (file offset)               device -> server
//	0x0004 DATA      (<=1024B file data + CRC16) device -> server
//	0x0005 COMPLETED (status 0)                  server -> device
func handleCamera(conn net.Conn, st *Store) {
	defer conn.Close()
	remote := conn.RemoteAddr().String()
	var r io.Reader = conn
	if st.rawEnabled { // off by default — raw mirrors full transfers and would defeat retention
		rawPath := filepath.Join(st.rawDir, fmt.Sprintf("cam_%d.bin", time.Now().UnixMilli()))
		if raw, err := os.Create(rawPath); err == nil {
			defer raw.Close()
			r = io.TeeReader(conn, raw)
			log.Printf("[cam] connection from %s raw=%s", remote, filepath.Base(rawPath))
		}
	} else {
		log.Printf("[cam] connection from %s", remote)
	}

	readCmd := func() (uint16, []byte, error) {
		_ = conn.SetReadDeadline(time.Now().Add(120 * time.Second))
		var hdr [4]byte
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			return 0, nil, err
		}
		cmd := binary.BigEndian.Uint16(hdr[0:2])
		ln := binary.BigEndian.Uint16(hdr[2:4])
		data := make([]byte, ln)
		if ln > 0 {
			if _, err := io.ReadFull(r, data); err != nil {
				return cmd, nil, err
			}
		}
		return cmd, data, nil
	}
	sendCmd := func(cmd uint16, data []byte) error {
		_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
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

	// Initialization packet (16 bytes).
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	var ini [16]byte
	if _, err := io.ReadFull(r, ini[:]); err != nil {
		log.Printf("[cam] read init %s: %v", remote, err)
		return
	}
	if binary.BigEndian.Uint16(ini[0:2]) != 0x0000 {
		log.Printf("[cam] unexpected init header from %s: % x", remote, ini[:4])
		return
	}
	protoID := binary.BigEndian.Uint16(ini[2:4])
	imei := fmt.Sprintf("%d", binary.BigEndian.Uint64(ini[4:12]))
	log.Printf("[cam] init imei=%s protoID=%d settings=% x remote=%s", imei, protoID, ini[12:16], remote)
	st.camData(imei, 16)

	// pull drains every available file of one type ("%photof" / "%videof")
	// via the START→RESUME→SYNC→DATA sequence, saving each one.
	pull := func(identifier, kind string) int {
		saved := 0
		for {
			if err := sendCmd(0x0008, []byte(identifier)); err != nil { // FILE REQ
				return saved
			}
			cmd, data, err := readCmd()
			if err != nil {
				return saved
			}
			st.camData(imei, len(data)+4)
			if cmd != 0x0001 || len(data) < 4 { // not START → none left / error
				log.Printf("[cam] imei=%s no more %s (cmd=0x%04x)", imei, identifier, cmd)
				return saved
			}
			packets := binary.BigEndian.Uint32(data[0:4])
			if packets == 0 {
				return saved
			}
			log.Printf("[cam] imei=%s %s START packets=%d", imei, identifier, packets)
			if err := sendCmd(0x0002, []byte{0, 0, 0, 1}); err != nil { // RESUME from packet 1
				return saved
			}
			if sc, _, se := readCmd(); se != nil || sc != 0x0003 { // SYNC
				log.Printf("[cam] imei=%s expected SYNC (got 0x%04x err=%v)", imei, sc, se)
				return saved
			}
			fileBuf := make([]byte, 0, int(packets)*1024)
			var prevCRC uint16
			ok := true
			for i := uint32(0); i < packets; i++ {
				dc, dd, de := readCmd()
				if de != nil || dc != 0x0004 || len(dd) < 2 {
					log.Printf("[cam] imei=%s %s DATA fail at pkt %d (cmd=0x%04x err=%v)", imei, identifier, i+1, dc, de)
					ok = false
					break
				}
				st.camData(imei, len(dd)+4)
				fileData := dd[:len(dd)-2]
				pktCRC := binary.BigEndian.Uint16(dd[len(dd)-2:])
				if calc := crc16(fileData, prevCRC); calc != pktCRC {
					log.Printf("[cam] imei=%s pkt %d CRC calc=0x%04x got=0x%04x", imei, i+1, calc, pktCRC)
				}
				prevCRC = pktCRC // chain: next packet's init is this packet's CRC
				fileBuf = append(fileBuf, fileData...)
			}
			if !ok {
				return saved
			}
			if name, e := st.addMedia(imei, fileBuf, kind); e == nil {
				saved++
				log.Printf("[cam] imei=%s %s saved file=%s bytes=%d", imei, kind, name, len(fileBuf))
			}
		}
	}

	// Nothing is pulled unless a snapshot/video was explicitly requested — the
	// rig no longer downloads photos on every connection.
	photos, videos := 0, 0
	if st.takePhotoRequest() {
		log.Printf("[cam] imei=%s on-demand snapshot", imei)
		photos = pull("%photof", "photo")
	}
	if st.takeVideoRequest() {
		log.Printf("[cam] imei=%s on-demand video pull", imei)
		videos = pull("%videof", "video")
	}
	_ = sendCmd(0x0005, []byte{0, 0, 0, 0}) // COMPLETED → device disconnects
	log.Printf("[cam] imei=%s session done, photos=%d videos=%d", imei, photos, videos)
}

// crc16 is Teltonika's CRC-16/IBM (poly 0x8408), init = previous packet's CRC.
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

// --- HTTP (:8090) ----------------------------------------------------------

func serveHTTP(port string, st *Store) {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(st.snapshotDevices())
	})
	mux.HandleFunc("/api/images", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(st.snapshotImages())
	})
	mux.HandleFunc("/api/img/", func(w http.ResponseWriter, r *http.Request) {
		name := sanitize(strings.TrimPrefix(r.URL.Path, "/api/img/"))
		if name == "" || (!strings.HasSuffix(name, ".jpg") && !strings.HasSuffix(name, ".h264")) {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(name, ".jpg") {
			w.Header().Set("Content-Type", "image/jpeg")
		} else { // raw video → download
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")
		}
		http.ServeFile(w, r, filepath.Join(st.imageDir, name))
	})
	mux.HandleFunc("/api/request-photo", func(w http.ResponseWriter, r *http.Request) {
		st.requestPhoto()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/api/request-video", func(w http.ResponseWriter, r *http.Request) {
		st.requestVideo()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		b, _ := webFS.ReadFile("web/index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(b)
	})

	srv := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("[http] listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[http] %v", err)
	}
}

func listen(name, port string, handler func(net.Conn)) {
	l, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("[%s] listen :%s: %v", name, port, err)
	}
	log.Printf("[%s] listening on :%s", name, port)
	for {
		c, err := l.Accept()
		if err != nil {
			log.Printf("[%s] accept: %v", name, err)
			time.Sleep(100 * time.Millisecond)
			continue
		}
		go handler(c)
	}
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)

	avlPort := env("CAMTEST_AVL_PORT", "5028")
	camPort := env("CAMTEST_CAM_PORT", "5029")
	httpPort := env("CAMTEST_HTTP_PORT", "8090")
	dataDir := env("CAMTEST_DATA_DIR", "/app/data")

	imageDir := filepath.Join(dataDir, "images")
	rawDir := filepath.Join(dataDir, "raw")
	if err := os.MkdirAll(imageDir, 0o755); err != nil {
		log.Fatalf("mkdir images: %v", err)
	}
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		log.Fatalf("mkdir raw: %v", err)
	}

	maxFiles, _ := strconv.Atoi(env("CAMTEST_MAX_FILES", "200"))
	st := NewStore(imageDir, rawDir, maxFiles)
	st.rawEnabled = env("CAMTEST_RAW", "0") == "1" // diagnostics only; off by default
	st.loadExisting()

	go listen("avl", avlPort, func(c net.Conn) { handleAVL(c, st) })
	go listen("cam", camPort, func(c net.Conn) { handleCamera(c, st) })
	go serveHTTP(httpPort, st)

	log.Printf("camtest up — AVL :%s  CAM :%s  HTTP :%s  data=%s  retain=%d files", avlPort, camPort, httpPort, dataDir, maxFiles)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Println("shutting down")
}
