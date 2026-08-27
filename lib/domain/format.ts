// Ported behavior-for-behavior from reference/v0.4/finnix-film.html:83-108 (and the
// `fmt` helper at :380). The Thai number-to-text conversion is copied verbatim from the
// prototype, including its irregular-case branch order (สิบ / ยี่สิบ / เอ็ด) — do not
// re-derive it.

export function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d;
}

export function fmtThaiDate(d: Date | null | undefined): string {
  if (!d) return '-';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The clock part of a Date as `HH:MM`, or '' when there is no usable date.
 *
 * Printed forms carry a time beside the date (เวลารับรถ / เวลาส่งมอบรถ), and
 * the ticket stores both in one timestamp.
 */
export function hhmm(d: Date | null | undefined): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmt(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const NUM_TEXT = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const DIGIT_TEXT = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

function convertGroup(str: string): string {
  let s = '';
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const d = Number(str[i]);
    const pos = len - i - 1;
    if (d === 0) continue;
    if (pos === 0 && d === 1 && len > 1) s += 'เอ็ด';
    else if (pos === 1 && d === 2) s += 'ยี่' + DIGIT_TEXT[1];
    else if (pos === 1 && d === 1) s += DIGIT_TEXT[1];
    else s += NUM_TEXT[d] + DIGIT_TEXT[pos];
  }
  return s;
}

export function thaiBahtText(num: number): string {
  const n = Math.round(Number(num) || 0);
  if (n === 0) return 'ศูนย์บาทถ้วน';
  const str = String(n);
  let result = '';
  const groups: string[] = [];
  for (let i = str.length; i > 0; i -= 6) groups.unshift(str.slice(Math.max(0, i - 6), i));
  groups.forEach((g, idx) => {
    const conv = convertGroup(g.replace(/^0+/, '') || '0');
    if (conv && conv !== 'ศูนย์') result += conv + (idx < groups.length - 1 ? 'ล้าน' : '');
  });
  return (result || 'ศูนย์') + 'บาทถ้วน';
}
