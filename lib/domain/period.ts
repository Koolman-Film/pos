// One implementation of the "is this row inside the selected period?" test.
//
// The prototype inlined the same four-branch comparison in every module
// (reference/v0.4/finnix-film.html:2517-2524 and its copies), and the port
// carried that duplication over into `TicketList`, `AccountingModule` and — by
// omission — left the Dashboard without one at all, which is why its stat cards
// ignored the filter. Everything now shares this function.
//
// Semantics, unchanged from the ported copies:
//  - a missing date passes every period (rows that carry no date are never
//    filtered out by the period control);
//  - comparisons are on the SHOP's calendar day (Asia/Bangkok). They used to be
//    on the running process's local day, which is the shop's own machine in
//    development and UTC on the deployed server — so the same job could count
//    into July in production and August on the laptop, and "วันนี้" meant
//    yesterday until 07:00;
//  - `year` accepts either a Buddhist-era year (2569) or a CE one.

import { SHOP_TIME_ZONE, shopDayKey } from './format';

/** The four period modes of the shared period/shop filter bar. */
export type PeriodKey = 'today' | 'month' | 'year' | 'range';

/** The period every module starts on. */
export const DEFAULT_PERIOD: PeriodKey = 'month';

/**
 * The Thai caption for the selected window, e.g. "สรุปข้อมูลรายเดือน ·
 * สิงหาคม 2569". The dashboard header used to say "สรุปข้อมูลวันนี้" whatever the
 * filter said, which stopped being true once the default became รายเดือน.
 *
 * `now` is injected so the caller decides when the impure read happens (a Server
 * Component body, or an event handler) — same reason `lib/domain/now.ts` exists.
 */
export function periodCaption(
  period: string,
  periodValue: string,
  rangeStart: string,
  rangeEnd: string,
  now: Date,
): string {
  const thaiDate = (d: Date) =>
    d.toLocaleDateString('th-TH', {
      timeZone: SHOP_TIME_ZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  if (period === 'month') {
    const [y, m] = (periodValue || '').split('-').map(Number);
    const d = y && m ? new Date(y, m - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
    return `สรุปข้อมูลรายเดือน · ${d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}`;
  }
  if (period === 'year') {
    const rawY = Number(periodValue);
    const beYear = rawY > 2400 ? rawY : (rawY || now.getFullYear()) + 543;
    return `สรุปข้อมูลรายปี · ${beYear}`;
  }
  if (period === 'range') {
    const s = rangeStart ? new Date(rangeStart) : null;
    const e = rangeEnd ? new Date(rangeEnd) : null;
    if (!s && !e) return 'สรุปข้อมูลช่วงเวลาที่เลือก';
    return `สรุปข้อมูลช่วงเวลา · ${s ? thaiDate(s) : '…'} – ${e ? thaiDate(e) : '…'}`;
  }
  return `สรุปข้อมูลวันนี้ · ${thaiDate(now)}`;
}

export function isInPeriod(
  dateObj: Date | string | null | undefined,
  period: string,
  periodValue: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  if (!dateObj) return true;
  // `YYYY-MM-DD` on the shop's calendar. Comparing those strings compares the
  // days, and it cannot drift with the server's time zone the way reading
  // getFullYear()/getMonth() off a Date does.
  const key = shopDayKey(new Date(dateObj));
  if (!key) return true;
  const [dy, dm] = key.split('-').map(Number);
  const todayKey = shopDayKey(new Date());

  if (period === 'today') return key === todayKey;
  if (period === 'month') {
    const [y, m] = (periodValue || '').split('-').map(Number);
    return y && m ? dy === y && dm === m : true;
  }
  if (period === 'year') {
    const rawY = Number(periodValue);
    const y = rawY && rawY > 2400 ? rawY - 543 : rawY || Number(todayKey.slice(0, 4));
    return dy === y;
  }
  if (period === 'range') {
    // Both bounds arrive as the `YYYY-MM-DD` an <input type="date"> produces, so
    // both ends are inclusive by plain string comparison.
    return (!rangeStart || key >= rangeStart) && (!rangeEnd || key <= rangeEnd);
  }
  return true;
}
