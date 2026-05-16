// Package geo provides the two geometry primitives the events engine needs:
//   - HaversineM:    great-circle distance in meters, for CIRCLE geofences.
//   - PointInPolygon: ray-casting test, for POLYGON geofences.
//
// Polygons are stored as [lng,lat] pairs (GeoJSON convention) so x=lng, y=lat.
package geo

import "math"

const earthRadiusM = 6_371_000.0

// HaversineM returns the great-circle distance between two WGS-84 points
// in meters. Accurate to ~0.5% globally — plenty for fleet-scale geofences
// where the largest "circle" is typically a 20 km mine perimeter.
func HaversineM(lat1, lng1, lat2, lng2 float64) float64 {
	φ1 := lat1 * math.Pi / 180
	φ2 := lat2 * math.Pi / 180
	dφ := (lat2 - lat1) * math.Pi / 180
	dλ := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dφ/2)*math.Sin(dφ/2) +
		math.Cos(φ1)*math.Cos(φ2)*math.Sin(dλ/2)*math.Sin(dλ/2)
	return 2 * earthRadiusM * math.Asin(math.Sqrt(a))
}

// PointInPolygon runs a standard ray-casting test. The polygon must have at
// least 3 points; the caller is responsible for that check (the geofences
// service rejects shorter polygons at create time).
//
// Polygon points are [lng,lat] (matching the stored geometry); pass (lng, lat)
// for the test point so coordinates stay consistent.
func PointInPolygon(lng, lat float64, polygon [][2]float64) bool {
	inside := false
	n := len(polygon)
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		xi, yi := polygon[i][0], polygon[i][1]
		xj, yj := polygon[j][0], polygon[j][1]
		// Edge crosses the ray cast east from (lng,lat).
		if (yi > lat) != (yj > lat) &&
			lng < (xj-xi)*(lat-yi)/(yj-yi)+xi {
			inside = !inside
		}
	}
	return inside
}
