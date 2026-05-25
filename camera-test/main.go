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
	"bytes"
	"embed"
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
	IMEI   string  `json:"imei"`
	Last   Point   `json:"last"`
	Track  []Point `json:"track"`
	Online int64   `json:"online"` // unix ms (server last-seen)
}

type Image struct {
	IMEI string `json:"imei"`
	Time int64  `json:"time"` // unix ms (server received)
	File string `json:"file"`
	Size int64  `json:"size"`
}

type Store struct {
	mu       sync.RWMutex
	devices  map[string]*Device
	images   []Image
	imageDir string
	rawDir   string
}

func NewStore(imageDir, rawDir string) *Store {
	return &Store{devices: map[string]*Device{}, imageDir: imageDir, rawDir: rawDir}
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

func (s *Store) addImage(imei string, data []byte) (string, error) {
	now := time.Now()
	name := fmt.Sprintf("%s_%d.jpg", sanitize(imei), now.UnixMilli())
	if err := os.WriteFile(filepath.Join(s.imageDir, name), data, 0o644); err != nil {
		return "", err
	}
	s.mu.Lock()
	s.images = append(s.images, Image{IMEI: imei, Time: now.UnixMilli(), File: name, Size: int64(len(data))})
	s.mu.Unlock()
	return name, nil
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
	out := append([]Image(nil), s.images...)
	sort.Slice(out, func(i, j int) bool { return out[i].Time > out[j].Time })
	return out
}

// loadExisting rebuilds the image list from disk so a restart keeps the
// gallery (filenames encode the IMEI and receive time).
func (s *Store) loadExisting() {
	entries, _ := os.ReadDir(s.imageDir)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jpg") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		imei, ms := parseName(e.Name())
		s.images = append(s.images, Image{IMEI: imei, Time: ms, File: e.Name(), Size: info.Size()})
	}
	log.Printf("loaded %d existing image(s) from %s", len(s.images), s.imageDir)
}

func parseName(name string) (string, int64) {
	base := strings.TrimSuffix(name, ".jpg")
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

func handleCamera(conn net.Conn, st *Store) {
	defer conn.Close()
	imei, err := camHandshake(conn)
	if err != nil {
		log.Printf("[cam] handshake %s: %v", conn.RemoteAddr(), err)
		return
	}
	log.Printf("[cam] connected imei=%s remote=%s", imei, conn.RemoteAddr())
	defer log.Printf("[cam] disconnected imei=%s", imei)
	st.markOnline(imei)

	rawPath := filepath.Join(st.rawDir, fmt.Sprintf("%s_%d.bin", sanitize(imei), time.Now().UnixMilli()))
	raw, _ := os.Create(rawPath)
	if raw != nil {
		defer raw.Close()
	}

	var buf []byte
	tmp := make([]byte, 32*1024)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(900 * time.Second))
		n, err := conn.Read(tmp)
		if n > 0 {
			chunk := tmp[:n]
			if raw != nil {
				_, _ = raw.Write(chunk)
			}
			buf = append(buf, chunk...)
			imgs, rest := extractJPEGs(buf)
			buf = rest
			for _, img := range imgs {
				name, e := st.addImage(imei, img)
				if e != nil {
					log.Printf("[cam] save image imei=%s: %v", imei, e)
				} else {
					log.Printf("[cam] image saved imei=%s file=%s bytes=%d", imei, name, len(img))
				}
			}
			if len(buf) > 16*1024*1024 { // runaway guard
				buf = buf[len(buf)-1024:]
			}
		}
		if err != nil {
			if err != io.EOF {
				log.Printf("[cam] read imei=%s: %v", imei, err)
			}
			return
		}
	}
}

// camHandshake performs the Teltonika IMEI handshake leniently (accepts the
// connection so the device proceeds to send media) and returns the IMEI.
func camHandshake(conn net.Conn) (string, error) {
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	var lenBuf [2]byte
	if _, err := io.ReadFull(conn, lenBuf[:]); err != nil {
		return "", fmt.Errorf("read imei len: %w", err)
	}
	n := int(lenBuf[0])<<8 | int(lenBuf[1])
	if n <= 0 || n > 64 {
		return "", fmt.Errorf("bogus imei length %d", n)
	}
	imei := make([]byte, n)
	if _, err := io.ReadFull(conn, imei); err != nil {
		return "", fmt.Errorf("read imei: %w", err)
	}
	_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if _, err := conn.Write([]byte{0x01}); err != nil {
		return "", fmt.Errorf("ack: %w", err)
	}
	return string(imei), nil
}

// extractJPEGs pulls every complete JPEG (SOI FF D8 FF .. EOI FF D9) out of
// the buffer, returning them plus the unconsumed tail to carry into the next
// read.
func extractJPEGs(buf []byte) ([][]byte, []byte) {
	var imgs [][]byte
	for {
		soi := bytes.Index(buf, []byte{0xFF, 0xD8, 0xFF})
		if soi < 0 {
			if len(buf) > 2 {
				return imgs, buf[len(buf)-2:] // keep tail; SOI may straddle reads
			}
			return imgs, buf
		}
		eoi := bytes.Index(buf[soi+3:], []byte{0xFF, 0xD9})
		if eoi < 0 {
			return imgs, buf[soi:] // image not complete yet
		}
		end := soi + 3 + eoi + 2
		img := make([]byte, end-soi)
		copy(img, buf[soi:end])
		imgs = append(imgs, img)
		buf = buf[end:]
	}
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
		if name == "" || !strings.HasSuffix(name, ".jpg") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		http.ServeFile(w, r, filepath.Join(st.imageDir, name))
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

	st := NewStore(imageDir, rawDir)
	st.loadExisting()

	go listen("avl", avlPort, func(c net.Conn) { handleAVL(c, st) })
	go listen("cam", camPort, func(c net.Conn) { handleCamera(c, st) })
	go serveHTTP(httpPort, st)

	log.Printf("camtest up — AVL :%s  CAM :%s  HTTP :%s  data=%s", avlPort, camPort, httpPort, dataDir)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Println("shutting down")
}
