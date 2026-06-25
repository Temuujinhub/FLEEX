// A5 / audit M2 — Excel formula-injection guard. A device/place/driver name
// like `=WEBSERVICE(...)` must be neutralised before it lands in an export.
import * as ExcelJS from 'exceljs';
import { hardenWorkbook } from '../src/reports/report-exporters';

describe('hardenWorkbook (formula-injection guard, audit M2)', () => {
  it('prefixes formula-trigger string cells, leaves safe cells / numbers / dates', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['=WEBSERVICE("http://evil")', 'Самосвал №14', '+1', '-5', '@x', 'plain']);
    ws.addRow([42, '— Төрлөөр —']); // em-dash header is NOT a hyphen → safe

    hardenWorkbook(wb);

    const r1 = ws.getRow(1);
    expect(r1.getCell(1).value).toBe('\'=WEBSERVICE("http://evil")');
    expect(r1.getCell(2).value).toBe('Самосвал №14');
    expect(r1.getCell(3).value).toBe("'+1");
    expect(r1.getCell(4).value).toBe("'-5");
    expect(r1.getCell(5).value).toBe("'@x");
    expect(r1.getCell(6).value).toBe('plain');

    const r2 = ws.getRow(2);
    expect(r2.getCell(1).value).toBe(42); // number untouched
    expect(r2.getCell(2).value).toBe('— Төрлөөр —'); // em-dash untouched
  });
});
