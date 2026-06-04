// Per-template report builders. Each function takes the raw positions/events
// rows that reports.service.ts already fetches and shapes them into the
// schema the corresponding Excel/PDF export expects.
//
// We split this out from reports.service.ts so each report's logic is
// reviewable in isolation — the service file was 685 lines of mixed query
// + transform + export before this, and adding 13 template-specific
// shapers inline would have made it unmaintainable.

export interface RawPosition {
  time: Date;
  latitude: number;
  longitude: number;
  speed: number | null;
  ignition: boolean | null;
  // Optional fields populated by the windowed query
  meters?: number;
  dt_sec?: number;
}

// One ignition-on → ignition-off cycle. If the device doesn't report
// ignition (always null), we fall back to a motion-based proxy: a
// "session" is a contiguous period of speed > MOTION_THRESHOLD_KMH
// separated by gaps ≥ MOTION_BREAK_MIN minutes.
export interface EngineSession {
  sessionNum: number;
  startAt: Date;
  endAt: Date;
  durationMin: number;
  drivingMin: number;
  idleMin: number;
  distanceKm: number;
  maxSpeed: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  detection: 'ignition' | 'motion';
}

// One contiguous moving stretch (speed > MOTION_THRESHOLD_KMH). Closed
// when speed stays ≤ threshold for ≥ STOP_BREAK_SEC seconds.
export interface TripSegment {
  segmentNum: number;
  startAt: Date;
  endAt: Date;
  durationMin: number;
  distanceKm: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

// One contiguous stop while ignition is on (or — fallback — while
// engine is presumed on per motion proxy). Filters out noise stops
// shorter than IDLE_MIN_SEC seconds.
export interface IdlePeriod {
  periodNum: number;
  startAt: Date;
  endAt: Date;
  durationMin: number;
  lat: number;
  lng: number;
  reason: 'ENGINE_ON_NO_MOTION' | 'STOP_BETWEEN_TRIPS';
}

const MOTION_THRESHOLD_KMH = 3;       // < 3 km/h treated as stopped
const MOTION_BREAK_MIN = 10;          // gap that closes a motion-detected session
const STOP_BREAK_SEC = 60;            // <= 3 km/h for >= 60 s closes a trip segment
const IDLE_MIN_SEC = 60;              // ignore micro-stops shorter than this
const TIME_GAP_BREAK_SEC = 30 * 60;   // a 30-minute reporting gap always breaks state

// True when the device reported any non-null ignition value across the
// window — controls whether we use ignition transitions or a motion proxy
// to detect sessions.
function hasIgnitionSignal(rows: RawPosition[]): boolean {
  for (const r of rows) {
    if (r.ignition === true || r.ignition === false) return true;
  }
  return false;
}

export function buildEngineSessions(rows: RawPosition[]): EngineSession[] {
  if (rows.length === 0) return [];
  return hasIgnitionSignal(rows)
    ? buildSessionsByIgnition(rows)
    : buildSessionsByMotion(rows);
}

// State machine over ignition transitions. An ON edge opens a session,
// the next OFF edge (or the end of the window) closes it. Unknown
// (null) ignition values inherit the last known state.
function buildSessionsByIgnition(rows: RawPosition[]): EngineSession[] {
  const out: EngineSession[] = [];
  let open: Partial<EngineSession> & { driveSec: number; idleSec: number } | null = null;
  let lastIgnition: boolean | null = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ign = r.ignition === true ? true : r.ignition === false ? false : lastIgnition;
    const dtSec = i > 0 ? (r.time.getTime() - rows[i - 1].time.getTime()) / 1000 : 0;
    const speed = Number(r.speed ?? 0);

    if (ign === true && open === null) {
      open = {
        sessionNum: out.length + 1,
        startAt: r.time,
        startLat: Number(r.latitude),
        startLng: Number(r.longitude),
        maxSpeed: speed,
        distanceKm: 0,
        driveSec: 0,
        idleSec: 0,
        detection: 'ignition',
      };
    } else if (open) {
      if (dtSec > 0 && dtSec < TIME_GAP_BREAK_SEC) {
        if (speed > MOTION_THRESHOLD_KMH) open.driveSec += dtSec;
        else open.idleSec += dtSec;
      }
      open.distanceKm = (open.distanceKm ?? 0) + Number(r.meters ?? 0) / 1000;
      open.maxSpeed = Math.max(open.maxSpeed ?? 0, speed);

      if (ign === false) {
        out.push(closeSession(open, r));
        open = null;
      }
    }
    lastIgnition = ign;
  }

  if (open) {
    out.push(closeSession(open, rows[rows.length - 1]));
  }
  return out;
}

// Motion proxy: a session starts on the first moving row and closes
// when speed stays ≤ threshold long enough to count as parked. The
// device almost certainly is "engine on while idle" between trips —
// but without an ignition channel we cannot prove it, so we draw the
// boundary at the visible motion edge instead of inventing one.
function buildSessionsByMotion(rows: RawPosition[]): EngineSession[] {
  const out: EngineSession[] = [];
  let open: Partial<EngineSession> & { driveSec: number; idleSec: number; lastMoveIdx: number } | null = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const speed = Number(r.speed ?? 0);
    const dtSec = i > 0 ? (r.time.getTime() - rows[i - 1].time.getTime()) / 1000 : 0;
    const moving = speed > MOTION_THRESHOLD_KMH;

    if (moving && open === null) {
      open = {
        sessionNum: out.length + 1,
        startAt: r.time,
        startLat: Number(r.latitude),
        startLng: Number(r.longitude),
        maxSpeed: speed,
        distanceKm: 0,
        driveSec: 0,
        idleSec: 0,
        lastMoveIdx: i,
        detection: 'motion',
      };
    } else if (open) {
      if (dtSec > 0 && dtSec < TIME_GAP_BREAK_SEC) {
        if (moving) open.driveSec += dtSec;
        else open.idleSec += dtSec;
      }
      open.distanceKm = (open.distanceKm ?? 0) + Number(r.meters ?? 0) / 1000;
      open.maxSpeed = Math.max(open.maxSpeed ?? 0, speed);
      if (moving) open.lastMoveIdx = i;

      const stoppedFor = i - (open.lastMoveIdx ?? i) > 0
        ? (r.time.getTime() - rows[open.lastMoveIdx ?? i].time.getTime()) / 1000
        : 0;
      if (stoppedFor >= MOTION_BREAK_MIN * 60) {
        const endRow = rows[open.lastMoveIdx ?? i];
        out.push(closeSession(open, endRow));
        open = null;
      }
    }
  }

  if (open) {
    out.push(closeSession(open, rows[rows.length - 1]));
  }
  return out;
}

function closeSession(
  partial: Partial<EngineSession> & { driveSec: number; idleSec: number },
  endRow: RawPosition,
): EngineSession {
  const start = partial.startAt!;
  const end = endRow.time;
  const durationMin = Math.max(0, (end.getTime() - start.getTime()) / 60000);
  return {
    sessionNum: partial.sessionNum!,
    startAt: start,
    endAt: end,
    durationMin,
    drivingMin: partial.driveSec / 60,
    idleMin: partial.idleSec / 60,
    distanceKm: partial.distanceKm ?? 0,
    maxSpeed: partial.maxSpeed ?? 0,
    startLat: partial.startLat!,
    startLng: partial.startLng!,
    endLat: Number(endRow.latitude),
    endLng: Number(endRow.longitude),
    detection: partial.detection!,
  };
}

// Trip segments: contiguous moving stretches. Closed when the device
// stays at speed ≤ MOTION_THRESHOLD_KMH for ≥ STOP_BREAK_SEC seconds,
// OR when a reporting gap longer than TIME_GAP_BREAK_SEC breaks the
// continuity (we don't know what happened in the gap, so we can't
// pretend it was one trip).
export function buildTripSegments(rows: RawPosition[]): TripSegment[] {
  const out: TripSegment[] = [];
  if (rows.length === 0) return out;

  let open: {
    startIdx: number;
    distanceKm: number;
    driveSec: number;
    maxSpeed: number;
    stoppedSec: number;
    lastMovingIdx: number;
  } | null = null;

  const closeOpen = (endIdx: number) => {
    if (!open) return;
    const start = rows[open.startIdx];
    const end = rows[endIdx];
    const durationMin = (end.time.getTime() - start.time.getTime()) / 60000;
    if (durationMin <= 0 || open.distanceKm < 0.05) {
      open = null;
      return;
    }
    out.push({
      segmentNum: out.length + 1,
      startAt: start.time,
      endAt: end.time,
      durationMin,
      distanceKm: open.distanceKm,
      avgSpeedKmh: durationMin > 0 ? (open.distanceKm / (durationMin / 60)) : 0,
      maxSpeedKmh: open.maxSpeed,
      startLat: Number(start.latitude),
      startLng: Number(start.longitude),
      endLat: Number(end.latitude),
      endLng: Number(end.longitude),
    });
    open = null;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const speed = Number(r.speed ?? 0);
    const dtSec = i > 0 ? (r.time.getTime() - rows[i - 1].time.getTime()) / 1000 : 0;
    const moving = speed > MOTION_THRESHOLD_KMH;

    if (open && dtSec > TIME_GAP_BREAK_SEC) {
      closeOpen(open.lastMovingIdx);
    }

    if (moving) {
      if (!open) {
        open = {
          startIdx: i,
          distanceKm: 0,
          driveSec: 0,
          maxSpeed: speed,
          stoppedSec: 0,
          lastMovingIdx: i,
        };
      } else {
        if (dtSec > 0 && dtSec < TIME_GAP_BREAK_SEC) open.driveSec += dtSec;
        open.distanceKm += Number(r.meters ?? 0) / 1000;
        open.maxSpeed = Math.max(open.maxSpeed, speed);
        open.stoppedSec = 0;
        open.lastMovingIdx = i;
      }
    } else if (open) {
      if (dtSec > 0 && dtSec < TIME_GAP_BREAK_SEC) open.stoppedSec += dtSec;
      open.distanceKm += Number(r.meters ?? 0) / 1000;
      if (open.stoppedSec >= STOP_BREAK_SEC) {
        closeOpen(open.lastMovingIdx);
      }
    }
  }
  closeOpen(rows.length - 1);
  return out;
}

// Idle periods. We only consider engine-on idle (ignition===true OR no
// ignition signal at all but speed < threshold between two trips —
// labelled STOP_BETWEEN_TRIPS to set caller expectations).
export function buildIdlePeriods(rows: RawPosition[]): IdlePeriod[] {
  const out: IdlePeriod[] = [];
  if (rows.length === 0) return out;
  const hasIgn = hasIgnitionSignal(rows);

  let open: {
    startIdx: number;
    stoppedSec: number;
    reason: IdlePeriod['reason'];
  } | null = null;

  const closeOpen = (endIdx: number) => {
    if (!open) return;
    const start = rows[open.startIdx];
    const end = rows[endIdx];
    const durationSec = (end.time.getTime() - start.time.getTime()) / 1000;
    if (durationSec >= IDLE_MIN_SEC) {
      out.push({
        periodNum: out.length + 1,
        startAt: start.time,
        endAt: end.time,
        durationMin: durationSec / 60,
        lat: Number(start.latitude),
        lng: Number(start.longitude),
        reason: open.reason,
      });
    }
    open = null;
  };

  let lastIgn: boolean | null = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ign = r.ignition === true ? true : r.ignition === false ? false : lastIgn;
    const speed = Number(r.speed ?? 0);
    const stopped = speed <= MOTION_THRESHOLD_KMH;
    const engineOn = hasIgn ? ign === true : true; // motion-proxy: assume engine on
    const reason: IdlePeriod['reason'] = hasIgn ? 'ENGINE_ON_NO_MOTION' : 'STOP_BETWEEN_TRIPS';
    const dtSec = i > 0 ? (r.time.getTime() - rows[i - 1].time.getTime()) / 1000 : 0;

    if (open && dtSec > TIME_GAP_BREAK_SEC) {
      closeOpen(i - 1);
    }

    if (stopped && engineOn) {
      if (!open) open = { startIdx: i, stoppedSec: 0, reason };
      else open.stoppedSec += dtSec;
    } else if (open) {
      closeOpen(i - 1);
    }
    lastIgn = ign;
  }
  closeOpen(rows.length - 1);
  return out;
}
