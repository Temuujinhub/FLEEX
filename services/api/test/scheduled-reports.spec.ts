// R1 — scheduled-report cadence logic. The cron fires daily; these pure
// helpers decide which reports are due and what window each covers.
import { isReportDue, reportPeriod } from '../src/reports/scheduled-reports.service';

const at = (y: number, m: number, d: number, h = 6) => new Date(y, m - 1, d, h);

describe('isReportDue', () => {
  it('DAILY: due once per day', () => {
    expect(isReportDue('DAILY', null, at(2026, 6, 10))).toBe(true);
    expect(isReportDue('DAILY', at(2026, 6, 9), at(2026, 6, 10))).toBe(true);
    expect(isReportDue('DAILY', at(2026, 6, 10, 6), at(2026, 6, 10, 6))).toBe(false); // already today
  });

  it('WEEKLY: only on Mondays, once', () => {
    // 2026-06-15 is a Monday.
    const monday = at(2026, 6, 15);
    const tuesday = at(2026, 6, 16);
    expect(monday.getDay()).toBe(1);
    expect(isReportDue('WEEKLY', null, monday)).toBe(true);
    expect(isReportDue('WEEKLY', null, tuesday)).toBe(false); // not Monday
    expect(isReportDue('WEEKLY', monday, monday)).toBe(false); // already ran
  });

  it('MONTHLY: only on the 1st, once', () => {
    const first = at(2026, 7, 1);
    const second = at(2026, 7, 2);
    expect(isReportDue('MONTHLY', null, first)).toBe(true);
    expect(isReportDue('MONTHLY', null, second)).toBe(false);
    expect(isReportDue('MONTHLY', first, first)).toBe(false);
  });
});

describe('reportPeriod', () => {
  it('DAILY covers yesterday', () => {
    const p = reportPeriod('DAILY', at(2026, 6, 10));
    expect(p.from).toEqual(new Date(2026, 5, 9));
    expect(p.to).toEqual(new Date(2026, 5, 10));
  });

  it('WEEKLY covers the last 7 days', () => {
    const p = reportPeriod('WEEKLY', at(2026, 6, 15));
    expect(p.from).toEqual(new Date(2026, 5, 8));
    expect(p.to).toEqual(new Date(2026, 5, 15));
  });

  it('MONTHLY covers the previous calendar month', () => {
    const p = reportPeriod('MONTHLY', at(2026, 7, 1));
    expect(p.from).toEqual(new Date(2026, 5, 1)); // June 1
    expect(p.to).toEqual(new Date(2026, 6, 1)); // July 1
  });
});
