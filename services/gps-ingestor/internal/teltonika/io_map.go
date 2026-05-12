package teltonika

// IO id mapping for the most relevant Teltonika telemetry signals. Full table
// lives in Teltonika's wiki; we surface the ones the Fleex API understands.
const (
	IODigitalInput1 = 1
	IOIgnition      = 239
	IOMovement      = 240
	IOSpeed         = 24
	IOGSMSignal     = 21
	IOSleepMode     = 200
	IOExternalVolt  = 66
	IOBatteryVolt   = 67
	IOBatteryCurr   = 68
	IOFuelLevel     = 48
	IOOdometerTotal = 16
	IOTripOdometer  = 199
	IOEngineRPM     = 36
	IOEngineHours   = 234
	IOTotalDistance = 87
	IODriverID1     = 195
	IORFID          = 78
	IOGreenDriving  = 253
	IOOverspeeding  = 255
	IOTowing        = 246
	IOJamming       = 247
	IOCrashDetect   = 257
	IOUnplug        = 252
	IOPowerCut      = 252
)

// PickSpeedKmh returns the most reliable speed value (GPS-frame speed
// already lives on Record.Speed; some firmwares put a more accurate one in
// IO #24).
func PickSpeedKmh(r Record) float64 {
	if r.Speed > 0 {
		return float64(r.Speed)
	}
	if v, ok := r.IO[IOSpeed]; ok {
		return float64(v)
	}
	return 0
}

// PickIgnition returns ignition state where reported.
func PickIgnition(r Record) *bool {
	if v, ok := r.IO[IOIgnition]; ok {
		on := v != 0
		return &on
	}
	if v, ok := r.IO[IODigitalInput1]; ok {
		on := v != 0
		return &on
	}
	return nil
}

// PickOdometerKm returns odometer in km if present.
func PickOdometerKm(r Record) *float64 {
	if v, ok := r.IO[IOOdometerTotal]; ok {
		km := float64(v) / 1000.0
		return &km
	}
	if v, ok := r.IO[IOTotalDistance]; ok {
		km := float64(v) / 1000.0
		return &km
	}
	return nil
}

// PickBatteryVolt returns external/internal battery voltage in volts.
func PickBatteryVolt(r Record) *float64 {
	if v, ok := r.IO[IOExternalVolt]; ok {
		volt := float64(v) / 1000.0
		return &volt
	}
	if v, ok := r.IO[IOBatteryVolt]; ok {
		volt := float64(v) / 1000.0
		return &volt
	}
	return nil
}

// PickEngineHours returns engine hours if present.
func PickEngineHours(r Record) *float64 {
	if v, ok := r.IO[IOEngineHours]; ok {
		h := float64(v) / 3_600_000.0 // ms → hours
		return &h
	}
	return nil
}

// PickRFID returns the driver RFID card identifier if present.
func PickRFID(r Record) string {
	if v, ok := r.IO[IORFID]; ok && v != 0 {
		return formatHex(v)
	}
	if v, ok := r.IO[IODriverID1]; ok && v != 0 {
		return formatHex(v)
	}
	return ""
}

func formatHex(v int64) string {
	const hex = "0123456789ABCDEF"
	if v == 0 {
		return "0"
	}
	var out [16]byte
	n := 0
	u := uint64(v)
	for u > 0 {
		out[n] = hex[u&0xF]
		u >>= 4
		n++
	}
	// reverse
	r := make([]byte, n)
	for i := 0; i < n; i++ {
		r[i] = out[n-1-i]
	}
	return string(r)
}
