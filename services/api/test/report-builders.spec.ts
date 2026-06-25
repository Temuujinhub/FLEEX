// Daily-rollup builders backing the Mileage / Utilization / Fuel-consumption
// reports (Wialon-parity batch).
import { buildDailySummary, computeFuelConsumption, type RawPosition } from '../src/reports/report-builders';

const mk = (iso: string, speed: number, ignition: boolean | null, meters: number): RawPosition => ({
  time: new Date(iso),
  latitude: 47.9,
  longitude: 106.9,
  speed,
  ignition,
  meters,
});

describe('buildDailySummary', () => {
  it('buckets distance, moving and idle by UTC day', () => {
    const rows = [
      mk('2026-06-10T00:00:00Z', 0, true, 0),
      mk('2026-06-10T00:10:00Z', 60, true, 10_000), // +10km, 10 min moving
      mk('2026-06-10T00:20:00Z', 0, true, 0), // 10 min idle (engine on)
      mk('2026-06-11T00:10:00Z', 40, true, 4_000), // next day; >30min gap → time skipped, distance kept
      mk('2026-06-11T00:20:00Z', 40, true, 6_000), // +6km, 10 min moving
    ];
    const { days, hasIgnition } = buildDailySummary(rows);
    expect(hasIgnition).toBe(true);
    expect(days.map((d) => d.date)).toEqual(['2026-06-10', '2026-06-11']);

    const d1 = days[0];
    expect(d1.distanceKm).toBeCloseTo(10);
    expect(d1.movingMin).toBeCloseTo(10);
    expect(d1.idleMin).toBeCloseTo(10);
    expect(d1.engineOnMin).toBeCloseTo(20);
    expect(d1.maxSpeed).toBe(60);

    const d2 = days[1];
    expect(d2.distanceKm).toBeCloseTo(10); // 4 + 6
    expect(d2.movingMin).toBeCloseTo(10); // only the in-window 10-min segment
    expect(d2.idleMin).toBeCloseTo(0);
  });

  it('does not invent idle time for motion-only devices (no ignition signal)', () => {
    const rows = [
      mk('2026-06-10T00:00:00Z', 50, null, 0),
      mk('2026-06-10T00:10:00Z', 0, null, 5_000), // stopped, but engine state unknown
      mk('2026-06-10T00:20:00Z', 50, null, 5_000),
    ];
    const { days, hasIgnition } = buildDailySummary(rows);
    expect(hasIgnition).toBe(false);
    expect(days[0].idleMin).toBe(0); // can't prove engine-on while stopped
    expect(days[0].distanceKm).toBeCloseTo(10);
  });

  it('returns empty for no rows', () => {
    expect(buildDailySummary([]).days).toEqual([]);
  });
});

describe('computeFuelConsumption', () => {
  it('estimates litres = distance/100 × rate', () => {
    const out = computeFuelConsumption(
      [{ date: '2026-06-10', distanceKm: 10 }, { date: '2026-06-11', distanceKm: 10 }],
      20, // 20 L/100km
    );
    expect(out.rows[0].estLiters).toBeCloseTo(2);
    expect(out.totalDistanceKm).toBeCloseTo(20);
    expect(out.totalEstLiters).toBeCloseTo(4);
  });

  it('is zero when no rate is configured', () => {
    const out = computeFuelConsumption([{ date: '2026-06-10', distanceKm: 123 }], 0);
    expect(out.totalEstLiters).toBe(0);
  });
});
