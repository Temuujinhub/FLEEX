package geo

import (
	"math"
	"testing"
)

func TestHaversineM_KnownDistance(t *testing.T) {
	// Ulaanbaatar (47.918, 106.917) → Erdenet (49.029, 104.045).
	// Great-circle distance is ≈ 245 km (the surface road is longer at ~370 km).
	got := HaversineM(47.918, 106.917, 49.029, 104.045)
	want := 245_000.0
	if math.Abs(got-want) > 2_000 {
		t.Fatalf("Haversine UB→Erdenet: got %.0f m, want ≈ %.0f m", got, want)
	}
}

func TestHaversineM_Zero(t *testing.T) {
	if d := HaversineM(0, 0, 0, 0); d != 0 {
		t.Fatalf("identical points should be 0 m, got %f", d)
	}
}

func TestPointInPolygon_Square(t *testing.T) {
	// Unit square in (lng,lat) space.
	square := [][2]float64{
		{0, 0}, {2, 0}, {2, 2}, {0, 2},
	}
	cases := []struct {
		name        string
		lng, lat    float64
		wantInside  bool
	}{
		{"center",       1, 1, true},
		{"left of square", -1, 1, false},
		{"right of square", 3, 1, false},
		{"above square",   1, 3, false},
		{"below square",   1, -1, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := PointInPolygon(c.lng, c.lat, square); got != c.wantInside {
				t.Fatalf("(%g, %g) inside? got %v, want %v", c.lng, c.lat, got, c.wantInside)
			}
		})
	}
}

func TestPointInPolygon_Concave(t *testing.T) {
	// L-shape: the notch on the right means (2.5, 1) is OUTSIDE despite being
	// "between" the bounding box corners. A naive bbox test would fail this.
	l := [][2]float64{
		{0, 0}, {3, 0}, {3, 1}, {1, 1}, {1, 3}, {0, 3},
	}
	if PointInPolygon(2.5, 1.5, l) {
		t.Fatalf("(2.5, 1.5) should be outside the L-notch")
	}
	if !PointInPolygon(0.5, 2.5, l) {
		t.Fatalf("(0.5, 2.5) should be inside the L-arm")
	}
}
