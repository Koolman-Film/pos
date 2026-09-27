import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';

/*
  The SheetJS calls this app makes, pinned against the version in vendor/.

  xlsx is installed from vendor/xlsx-0.20.3.tgz (SheetJS no longer publishes to
  npm, and 0.18.5 from npm carries two unfixed advisories). These are exactly
  the functions the exports and the stock import use — json_to_sheet,
  book_new/book_append_sheet, write (base64 and array), read, sheet_to_json —
  round-tripped with Thai text, so an upgrade that changes any of them fails
  here rather than in a shop's download.
*/
describe('xlsx (vendored SheetJS) — the API the app relies on', () => {
  const rows = [
    { วันที่: '27 ก.ย. 2569', รายการ: 'ฟิล์มกรองแสง', จำนวนเงิน: 6400 },
    { วันที่: '27 ก.ย. 2569', รายการ: '=HYPERLINK("x")', จำนวนเงิน: 0.1 + 0.2 },
  ];

  function workbook() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'FN เชียงใหม่');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'ลำพูน');
    return wb;
  }

  it('is the vendored 0.20.3', () => {
    expect(XLSX.version).toBe('0.20.3');
  });

  it('round-trips a Thai workbook through base64, as the server exports do', () => {
    const b64 = XLSX.write(workbook(), { type: 'base64', bookType: 'xlsx' }) as string;
    const back = XLSX.read(b64, { type: 'base64' });
    expect(back.SheetNames).toEqual(['FN เชียงใหม่', 'ลำพูน']);
    expect(XLSX.utils.sheet_to_json(back.Sheets['ลำพูน'])).toEqual(rows);
  });

  it('writes a formula-looking cell as text, not a formula', () => {
    const b64 = XLSX.write(workbook(), { type: 'base64', bookType: 'xlsx' }) as string;
    const cell = XLSX.read(b64, { type: 'base64' }).Sheets['FN เชียงใหม่'].B3;
    expect(cell.t).toBe('s');
    expect(cell.f).toBeUndefined();
  });

  it('reads an uploaded file as an ArrayBuffer, as the stock import does', () => {
    const buf = XLSX.write(workbook(), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const back = XLSX.read(buf, { type: 'array' });
    expect(XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]])).toHaveLength(2);
  });

  it('still offers writeFile for the browser downloads', () => {
    expect(typeof XLSX.writeFile).toBe('function');
  });
});
