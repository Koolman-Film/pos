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

/**
 * The shop's clock. Every branch is in Thailand, so this is a constant.
 *
 * A `timestamptz` is an instant, not a wall time — turning one into "16:00"
 * needs a time zone, and until this existed the code used whatever zone the
 * process happened to run in. In development that is the shop’s own machine,
 * so it looked right; the deployed server runs in UTC, where a job booked for
 * 11:00 printed as 04:00 and a 02:00 job showed on the previous day.
 *
 * Pinning it also removes a whole class of hydration mismatch: the HTML the
 * server renders and the HTML the browser re-renders now agree by
 * construction, wherever either of them is running.
 */
export const SHOP_TIME_ZONE = 'Asia/Bangkok';

const thaiDateFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: SHOP_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const clockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHOP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `YYYY-MM-DD` on the shop's calendar — the key to group a day by. */
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function usable(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

export function fmtThaiDate(d: Date | null | undefined): string {
  if (!d) return '-';
  if (!usable(d)) return '-';
  return thaiDateFmt.format(d);
}

/**
 * The clock part of a Date as `HH:MM` on the shop's clock, or `` when there is
 * no usable date.
 *
 * Printed forms carry a time beside the date (เวลารับรถ / เวลาส่งมอบรถ), and
 * the ticket stores both in one timestamp.
 */
export function hhmm(d: Date | null | undefined): string {
  if (!usable(d)) return '';
  return clockFmt.format(d);
}

/**
 * The day this instant falls on, on the shop's calendar, as `YYYY-MM-DD`.
 *
 * For grouping by day — never format this for a reader. Two jobs booked an
 * hour apart at 23:30 and 00:30 belong to different days, and which days
 * those are must not depend on where the code runs.
 */
export function shopDayKey(d: Date | null | undefined): string {
  if (!usable(d)) return '';
  return dayKeyFmt.format(d);
}

/**
 * The instant the shop's day containing `d` begins (00:00 in Bangkok).
 *
 * `setHours(0,0,0,0)` gives midnight in whatever zone the process runs in —
 * 07:00 Bangkok on a UTC server, so "today" started seven hours late and the
 * early bookings of the day fell outside it.
 */
export function startOfShopDay(d: Date = new Date()): Date {
  const key = shopDayKey(d);
  // +07:00 is fixed: Thailand has no daylight saving and has not changed
  // offset since 1940.
  return new Date(`${key}T00:00:00+07:00`);
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
