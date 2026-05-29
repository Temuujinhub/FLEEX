package store

import (
	"testing"
	"time"

	// Embed tzdata so LoadLocation works in the test binary regardless of the
	// host OS shipping the IANA database.
	_ "time/tzdata"
)

func fptr(v float64) *float64 { return &v }
func sptr(s string) *string   { return &s }

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestEffectiveSpeedLimit_DayNight(t *testing.T) {
	g := &Geofence{
		SpeedLimit:      fptr(60),
		SpeedLimitNight: fptr(40),
		NightStart:      sptr("22:00"),
		NightEnd:        sptr("06:00"), // wraps midnight
	}
	at := func(h, m int) time.Time { return time.Date(2026, 1, 2, h, m, 0, 0, time.UTC) }
	cases := []struct {
		h, m int
		want float64
	}{
		{23, 0, 40},  // night
		{2, 0, 40},   // night, after midnight
		{5, 59, 40},  // night, just before end
		{6, 0, 60},   // day, end is exclusive
		{12, 0, 60},  // day
		{21, 59, 60}, // day, just before start
		{22, 0, 40},  // night, at start (inclusive)
	}
	for _, c := range cases {
		got := g.EffectiveSpeedLimit(at(c.h, c.m))
		if got == nil || *got != c.want {
			t.Errorf("%02d:%02d → got %v want %v", c.h, c.m, deref(got), c.want)
		}
	}
}

func TestEffectiveSpeedLimit_NoNightConfig(t *testing.T) {
	g := &Geofence{SpeedLimit: fptr(50)}
	if got := g.EffectiveSpeedLimit(time.Now()); got == nil || *got != 50 {
		t.Fatalf("expected day limit 50, got %v", deref(got))
	}
}

// Locks in R-6: the window must be evaluated in the company's local time, not
// UTC. 15:00 UTC is 23:00 in Asia/Ulaanbaatar (UTC+8) — inside a 22:00–06:00
// night window — so the night limit must apply only after converting.
func TestEffectiveSpeedLimit_LocalTimeMatters(t *testing.T) {
	ub, err := time.LoadLocation("Asia/Ulaanbaatar")
	if err != nil {
		t.Fatalf("load tz: %v", err)
	}
	g := &Geofence{
		SpeedLimit:      fptr(60),
		SpeedLimitNight: fptr(40),
		NightStart:      sptr("22:00"),
		NightEnd:        sptr("06:00"),
	}
	utc := time.Date(2026, 1, 2, 15, 0, 0, 0, time.UTC)
	if got := g.EffectiveSpeedLimit(utc); got == nil || *got != 60 {
		t.Errorf("UTC eval (old bug) → got %v want 60 (day)", deref(got))
	}
	if got := g.EffectiveSpeedLimit(utc.In(ub)); got == nil || *got != 40 {
		t.Errorf("local eval → got %v want 40 (night)", deref(got))
	}
}
