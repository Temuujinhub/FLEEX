// Per-template Excel / PDF builders. Each function takes pre-shaped data
// from reports.service.ts (sessions / segments / events / etc.) and writes
// a workbook or PDF Buffer with columns that mirror what the UI shows for
// that template — so a "Мото цаг" Excel matches the engine-sessions table
// the user sees on the page, not a generic positions dump.
//
// Why one file: every exporter is ~30-60 lines of ExcelJS / pdfkit
// scaffolding, and they share the same "header sheet + data sheet" shape.
// Keeping them together makes drift between templates obvious in review.

import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Event } from '@prisma/client';
import type { EngineSession, TripSegment, IdlePeriod } from './report-builders';

export interface DeviceHeader {
  name: string;
  plateNumber: string | null;
  imei: string;
}

export interface ReportRange {
  from: Date;
  to: Date;
}

// ── Helpers ───────────────────────────────────────────────────
function fmtDt(d: Date): string {
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19);
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return h > 0 ? `${h}ц ${m}мин` : `${m}мин`;
}

function attachHeader(ws: ExcelJS.Worksheet, title: string, device: DeviceHeader, range: ReportRange) {
  ws.mergeCells('A1', 'F1');
  ws.getCell('A1').value = `Fleex — ${title}`;
  ws.getCell('A1').font = { size: 14, bold: true };
  ws.mergeCells('A2', 'F2');
  ws.getCell('A2').value = `${device.name}${device.plateNumber ? ` · ${device.plateNumber}` : ''} · IMEI ${device.imei}`;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF6B7280' } };
  ws.mergeCells('A3', 'F3');
  ws.getCell('A3').value = `Хугацаа: ${fmtDt(range.from)} → ${fmtDt(range.to)}`;
  ws.getCell('A3').font = { size: 10, color: { argb: 'FF6B7280' } };
  ws.addRow([]);
}

async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  wb.creator = 'Fleex';
  wb.created = new Date();
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function pdfToBuffer(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function pdfHeader(doc: PDFKit.PDFDocument, title: string, device: DeviceHeader, range: ReportRange) {
  doc.fontSize(18).text(`Fleex — ${title}`, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor('gray').text(
    `${device.name}${device.plateNumber ? ' · ' + device.plateNumber : ''} · IMEI ${device.imei}`,
    { align: 'center' },
  );
  doc.fontSize(10).text(`${fmtDt(range.from)} → ${fmtDt(range.to)}`, { align: 'center' });
  doc.fillColor('black').moveDown();
}

function kvList(doc: PDFKit.PDFDocument, pairs: Array<[string, string]>) {
  for (const [k, v] of pairs) {
    doc.font('Helvetica-Bold').text(k + ': ', { continued: true });
    doc.font('Helvetica').text(v);
  }
}

// ── Engine hours (Мото цаг) ───────────────────────────────────
export async function engineSessionsExcel(
  device: DeviceHeader,
  range: ReportRange,
  sessions: EngineSession[],
  totals: { totalEngineHours: number; totalDrivingHours: number; totalIdleHours: number; maxSpeed: number; distanceKm: number },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const summary = wb.addWorksheet('Хураангуй');
  attachHeader(summary, 'Мото цаг (Engine hours)', device, range);
  summary.addRows([
    ['Хөдөлгүүр асаалттай байсан нийт цаг', totals.totalEngineHours.toFixed(2) + ' ц'],
    ['Үүнээс хөдөлгөөнтэй',                 totals.totalDrivingHours.toFixed(2) + ' ц'],
    ['Үүнээс сул зогсолт',                  totals.totalIdleHours.toFixed(2) + ' ц'],
    ['Үр ашиг (driving / engine)',          totals.totalEngineHours > 0
      ? ((totals.totalDrivingHours / totals.totalEngineHours) * 100).toFixed(0) + '%'
      : '—'],
    ['Дээд хурд',                           totals.maxSpeed.toFixed(1) + ' км/ц'],
    ['Туулсан зам',                         totals.distanceKm.toFixed(1) + ' км'],
    ['Session-ийн тоо',                     sessions.length],
    ['Илрүүлэлт',                           sessions[0]?.detection === 'motion'
      ? 'хөдөлгөөн (ignition signal алга)'
      : 'ignition signal'],
  ]);
  summary.getColumn(1).width = 38;
  summary.getColumn(2).width = 28;

  const sheet = wb.addWorksheet('Engine sessions');
  sheet.columns = [
    { header: '#',                key: 'n',     width: 5 },
    { header: 'Эхлэлт',           key: 'start', width: 21 },
    { header: 'Дуусгавар',        key: 'end',   width: 21 },
    { header: 'Үргэлжлэл',        key: 'dur',   width: 12 },
    { header: 'Хөдөлгөөнд',       key: 'drv',   width: 12 },
    { header: 'Сул зогссон',      key: 'idle',  width: 12 },
    { header: 'Зам (км)',         key: 'km',    width: 10 },
    { header: 'Дээд хурд (км/ц)', key: 'spd',   width: 14 },
    { header: 'Эхлэх Lat',        key: 'sLat',  width: 11 },
    { header: 'Эхлэх Lng',        key: 'sLng',  width: 11 },
    { header: 'Дуусах Lat',       key: 'eLat',  width: 11 },
    { header: 'Дуусах Lng',       key: 'eLng',  width: 11 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const s of sessions) {
    sheet.addRow({
      n: s.sessionNum,
      start: fmtDt(s.startAt),
      end: fmtDt(s.endAt),
      dur: fmtMin(s.durationMin),
      drv: fmtMin(s.drivingMin),
      idle: fmtMin(s.idleMin),
      km: Number(s.distanceKm.toFixed(2)),
      spd: Number(s.maxSpeed.toFixed(1)),
      sLat: Number(s.startLat.toFixed(5)),
      sLng: Number(s.startLng.toFixed(5)),
      eLat: Number(s.endLat.toFixed(5)),
      eLng: Number(s.endLng.toFixed(5)),
    });
  }
  return workbookToBuffer(wb);
}

export function engineSessionsPdf(
  device: DeviceHeader,
  range: ReportRange,
  sessions: EngineSession[],
  totals: { totalEngineHours: number; totalDrivingHours: number; totalIdleHours: number; maxSpeed: number; distanceKm: number },
): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    pdfHeader(doc, 'Мото цаг (Engine hours)', device, range);
    kvList(doc, [
      ['Хөдөлгүүр асаалттай', `${totals.totalEngineHours.toFixed(2)} ц`],
      ['Хөдөлгөөнд',          `${totals.totalDrivingHours.toFixed(2)} ц`],
      ['Сул зогсолт',         `${totals.totalIdleHours.toFixed(2)} ц`],
      ['Үр ашиг',             totals.totalEngineHours > 0
        ? `${((totals.totalDrivingHours / totals.totalEngineHours) * 100).toFixed(0)}%`
        : '—'],
      ['Туулсан зам',         `${totals.distanceKm.toFixed(1)} км`],
      ['Дээд хурд',           `${totals.maxSpeed.toFixed(1)} км/ц`],
      ['Session-ийн тоо',     String(sessions.length)],
    ]);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).text('Session-уудын жагсаалт');
    doc.font('Helvetica').fontSize(9);
    for (const s of sessions.slice(0, 50)) {
      doc.text(
        `#${s.sessionNum}  ${fmtDt(s.startAt)} → ${fmtDt(s.endAt)}  ·  ${fmtMin(s.durationMin)} ` +
          `(drive ${fmtMin(s.drivingMin)}, idle ${fmtMin(s.idleMin)})  ·  ` +
          `${s.distanceKm.toFixed(1)} км  ·  max ${s.maxSpeed.toFixed(0)} км/ц`,
      );
    }
    if (sessions.length > 50) {
      doc.moveDown(0.5).fillColor('gray').text(
        `… бүгд ${sessions.length} session — бүтнээр Excel татна уу.`,
      );
    }
  });
}

// ── Trip segments (Зорчилт) ───────────────────────────────────
export async function tripSegmentsExcel(
  device: DeviceHeader,
  range: ReportRange,
  segments: TripSegment[],
  totals: { distanceKm: number; durationMin: number; maxSpeed: number; avgSpeed: number },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet('Хураангуй');
  attachHeader(summary, 'Зорчилт (Trips)', device, range);
  summary.addRows([
    ['Нийт зам',          totals.distanceKm.toFixed(2) + ' км'],
    ['Жолоодлогын цаг',   (totals.durationMin / 60).toFixed(2) + ' ц'],
    ['Дундаж хурд',       totals.avgSpeed.toFixed(1) + ' км/ц'],
    ['Дээд хурд',         totals.maxSpeed.toFixed(1) + ' км/ц'],
    ['Trip-ийн тоо',      segments.length],
  ]);
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 22;

  const sheet = wb.addWorksheet('Trips');
  sheet.columns = [
    { header: '#',                key: 'n',    width: 5 },
    { header: 'Эхлэлт',           key: 's',    width: 21 },
    { header: 'Дуусгавар',        key: 'e',    width: 21 },
    { header: 'Үргэлжлэл',        key: 'd',    width: 12 },
    { header: 'Зам (км)',         key: 'km',   width: 10 },
    { header: 'Дундаж (км/ц)',    key: 'avg',  width: 13 },
    { header: 'Дээд (км/ц)',      key: 'max',  width: 13 },
    { header: 'Эхлэх Lat',        key: 'sLat', width: 11 },
    { header: 'Эхлэх Lng',        key: 'sLng', width: 11 },
    { header: 'Дуусах Lat',       key: 'eLat', width: 11 },
    { header: 'Дуусах Lng',       key: 'eLng', width: 11 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const t of segments) {
    sheet.addRow({
      n: t.segmentNum,
      s: fmtDt(t.startAt),
      e: fmtDt(t.endAt),
      d: fmtMin(t.durationMin),
      km: Number(t.distanceKm.toFixed(2)),
      avg: Number(t.avgSpeedKmh.toFixed(1)),
      max: Number(t.maxSpeedKmh.toFixed(1)),
      sLat: Number(t.startLat.toFixed(5)),
      sLng: Number(t.startLng.toFixed(5)),
      eLat: Number(t.endLat.toFixed(5)),
      eLng: Number(t.endLng.toFixed(5)),
    });
  }
  return workbookToBuffer(wb);
}

export function tripSegmentsPdf(
  device: DeviceHeader,
  range: ReportRange,
  segments: TripSegment[],
  totals: { distanceKm: number; durationMin: number; maxSpeed: number; avgSpeed: number },
): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    pdfHeader(doc, 'Зорчилт', device, range);
    kvList(doc, [
      ['Нийт зам',        `${totals.distanceKm.toFixed(2)} км`],
      ['Жолоодлогын цаг', `${(totals.durationMin / 60).toFixed(2)} ц`],
      ['Дундаж хурд',     `${totals.avgSpeed.toFixed(1)} км/ц`],
      ['Дээд хурд',       `${totals.maxSpeed.toFixed(1)} км/ц`],
      ['Trip-ийн тоо',    String(segments.length)],
    ]);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).text('Trip жагсаалт');
    doc.font('Helvetica').fontSize(9);
    for (const t of segments.slice(0, 50)) {
      doc.text(
        `#${t.segmentNum}  ${fmtDt(t.startAt)} → ${fmtDt(t.endAt)}  ·  ${fmtMin(t.durationMin)} ` +
          `· ${t.distanceKm.toFixed(2)} км · avg ${t.avgSpeedKmh.toFixed(0)} / max ${t.maxSpeedKmh.toFixed(0)} км/ц`,
      );
    }
    if (segments.length > 50) {
      doc.moveDown(0.5).fillColor('gray').text(`… бүгд ${segments.length} trip — бүтнээр Excel татна уу.`);
    }
  });
}

// ── Idle periods (Зогсолт) ────────────────────────────────────
export async function idlePeriodsExcel(
  device: DeviceHeader,
  range: ReportRange,
  periods: IdlePeriod[],
  totals: { totalIdleHours: number; periodCount: number },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet('Хураангуй');
  attachHeader(summary, 'Зогсолт (Idle periods)', device, range);
  summary.addRows([
    ['Нийт сул зогсолт',  totals.totalIdleHours.toFixed(2) + ' ц'],
    ['Зогсолтын тоо',     totals.periodCount],
    ['Хамгийн урт зогсолт', periods.length > 0
      ? fmtMin(Math.max(...periods.map((p) => p.durationMin)))
      : '—'],
  ]);
  summary.getColumn(1).width = 26;
  summary.getColumn(2).width = 18;

  const sheet = wb.addWorksheet('Idle periods');
  sheet.columns = [
    { header: '#',            key: 'n',    width: 5 },
    { header: 'Эхлэлт',       key: 's',    width: 21 },
    { header: 'Дуусгавар',    key: 'e',    width: 21 },
    { header: 'Үргэлжлэл',    key: 'd',    width: 14 },
    { header: 'Lat',          key: 'lat',  width: 12 },
    { header: 'Lng',          key: 'lng',  width: 12 },
    { header: 'Шалтгаан',     key: 'r',    width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const p of periods) {
    sheet.addRow({
      n: p.periodNum,
      s: fmtDt(p.startAt),
      e: fmtDt(p.endAt),
      d: fmtMin(p.durationMin),
      lat: Number(p.lat.toFixed(5)),
      lng: Number(p.lng.toFixed(5)),
      r: p.reason === 'ENGINE_ON_NO_MOTION'
        ? 'Хөдөлгүүр асаалттай хөдөлгөөнгүй'
        : 'Trip-үүдийн хооронд зогссон',
    });
  }
  return workbookToBuffer(wb);
}

export function idlePeriodsPdf(
  device: DeviceHeader,
  range: ReportRange,
  periods: IdlePeriod[],
  totals: { totalIdleHours: number; periodCount: number },
): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    pdfHeader(doc, 'Зогсолт', device, range);
    kvList(doc, [
      ['Нийт сул зогсолт',  `${totals.totalIdleHours.toFixed(2)} ц`],
      ['Зогсолтын тоо',     String(totals.periodCount)],
    ]);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).text('Зогсолтын жагсаалт (эхний 60)');
    doc.font('Helvetica').fontSize(9);
    for (const p of periods.slice(0, 60)) {
      doc.text(
        `#${p.periodNum}  ${fmtDt(p.startAt)} → ${fmtDt(p.endAt)}  ·  ${fmtMin(p.durationMin)}  ·  ` +
          `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
      );
    }
    if (periods.length > 60) {
      doc.moveDown(0.5).fillColor('gray').text(`… бүгд ${periods.length} зогсолт — бүтнээр Excel татна уу.`);
    }
  });
}

// ── Events-based reports ─────────────────────────────────────
// Used by all event-driven templates (driver-behaviour, overspeed, panic,
// geofence, safety, ignition, offline, power, tamper). Title + filtered
// rows come from the dispatcher; we always render the same column shape
// because Event rows share a single schema.
export interface EventReportMeta {
  title: string;
  // Sub-title for the summary sheet — clarifies what was filtered.
  subtitle?: string;
}

export async function eventsExcel(
  meta: EventReportMeta,
  device: DeviceHeader,
  range: ReportRange,
  events: Event[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet('Хураангуй');
  attachHeader(summary, meta.title, device, range);

  const bySeverity = { CRITICAL: 0, WARNING: 0, INFO: 0 } as Record<string, number>;
  const byType: Record<string, number> = {};
  for (const e of events) {
    bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }
  summary.addRows([
    ['Нийт дохиолол',     events.length],
    ['Ноцтой (CRITICAL)', bySeverity.CRITICAL],
    ['Анхааруулга (WARNING)', bySeverity.WARNING],
    ['Мэдэгдэл (INFO)',   bySeverity.INFO],
  ]);
  if (Object.keys(byType).length > 0) {
    summary.addRow([]);
    summary.addRow(['— Төрлөөр —']);
    for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      summary.addRow([t, c]);
    }
  }
  summary.getColumn(1).width = 28;
  summary.getColumn(2).width = 14;

  const sheet = wb.addWorksheet('Events');
  sheet.columns = [
    { header: 'Огноо',     key: 't',    width: 21 },
    { header: 'Төрөл',     key: 'type', width: 22 },
    { header: 'Зэрэг',     key: 'sev',  width: 11 },
    { header: 'Зурваас',   key: 'msg',  width: 50 },
    { header: 'Lat',       key: 'lat',  width: 11 },
    { header: 'Lng',       key: 'lng',  width: 11 },
    { header: 'Хурд',      key: 'spd',  width: 9 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const e of events) {
    sheet.addRow({
      t: fmtDt(e.occurredAt),
      type: e.type,
      sev: e.severity,
      msg: e.message ?? '',
      lat: e.lat != null ? Number(Number(e.lat).toFixed(5)) : '',
      lng: e.lng != null ? Number(Number(e.lng).toFixed(5)) : '',
      spd: e.speed != null ? Number(e.speed) : '',
    });
  }
  return workbookToBuffer(wb);
}

export function eventsPdf(
  meta: EventReportMeta,
  device: DeviceHeader,
  range: ReportRange,
  events: Event[],
): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    pdfHeader(doc, meta.title, device, range);
    const bySeverity = { CRITICAL: 0, WARNING: 0, INFO: 0 } as Record<string, number>;
    for (const e of events) bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    kvList(doc, [
      ['Нийт дохиолол', String(events.length)],
      ['Ноцтой',        String(bySeverity.CRITICAL)],
      ['Анхааруулга',   String(bySeverity.WARNING)],
      ['Мэдэгдэл',      String(bySeverity.INFO)],
    ]);
    doc.moveDown(0.5);
    if (meta.subtitle) {
      doc.fontSize(9).fillColor('gray').text(meta.subtitle).fillColor('black').moveDown(0.5);
    }
    doc.font('Helvetica-Bold').fontSize(12).text('Дохиоллын жагсаалт (эхний 80)');
    doc.font('Helvetica').fontSize(9);
    for (const e of events.slice(0, 80)) {
      const loc = e.lat != null && e.lng != null ? `${Number(e.lat).toFixed(4)}, ${Number(e.lng).toFixed(4)}` : '—';
      doc.text(`${fmtDt(e.occurredAt)}  [${e.severity}]  ${e.type}  ${loc}  ${e.message ?? ''}`);
    }
    if (events.length > 80) {
      doc.moveDown(0.5).fillColor('gray').text(`… бүгд ${events.length} мөр — бүтнээр Excel татна уу.`);
    }
  });
}
