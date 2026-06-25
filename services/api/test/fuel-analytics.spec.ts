// R2 — fuel fill/theft detection from the FUEL_LEVEL series.
import { detectFuelEvents } from '../src/reports/fuel-analytics.service';

const t0 = new Date('2026-06-10T00:00:00Z').getTime();
const mk = (mins: number, level: number, ignition: boolean | null = true) => ({
  t: new Date(t0 + mins * 60_000),
  level,
  ignition,
});

describe('detectFuelEvents', () => {
  it('detects a refuelling (sudden rise within the window)', () => {
    const ev = detectFuelEvents([mk(0, 50), mk(5, 52), mk(10, 90)]); // +40 in 10 min
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe('FUEL_FILL');
    expect(ev[0].deltaL).toBeCloseTo(40);
  });

  it('detects a drain/theft and flags engine-off', () => {
    const ev = detectFuelEvents([mk(0, 80), mk(5, 78), mk(10, 50, false)]); // −30, ignition off
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe('FUEL_DRAIN');
    expect(ev[0].ignitionOff).toBe(true);
  });

  it('ignores slow driving consumption (no window exceeds threshold)', () => {
    const r = [];
    for (let i = 0; i <= 8; i++) r.push(mk(i * 30, 100 - i * 2)); // −2 every 30 min
    expect(detectFuelEvents(r)).toEqual([]);
  });

  it('ignores sub-threshold noise', () => {
    expect(detectFuelEvents([mk(0, 50), mk(5, 53), mk(10, 49)])).toEqual([]);
  });

  it('does not mistake a sparse gap (> window) for a drain', () => {
    // Two readings 60 min apart (window 20 min) with a big drop = normal driving.
    expect(detectFuelEvents([mk(0, 100), mk(60, 80)])).toEqual([]);
  });
});
