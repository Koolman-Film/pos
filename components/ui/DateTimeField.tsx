'use client';

import { hhmm, shopDayKey } from '@/lib/domain/format';

import { ThaiDateInput } from './ThaiDateInput';
import { TimeSelect } from './TimeSelect';

/** Thailand has no daylight saving; the shop's offset is fixed. */
const SHOP_OFFSET = '+07:00';

/**
 * Ported from reference/v0.4/finnix-film.html:1184-1196 (date + time slots).
 *
 * Deviation from the prototype: the prototype derives the date string with
 * `value.toISOString().slice(0,10)`, which is UTC. In Asia/Bangkok (UTC+7) that
 * renders the *previous* day for any time before 07:00, and `setTime` then
 * rebuilds the Date from that shifted day — silently moving a booking back one
 * day.
 *
 * Nor is it the process's local zone: the page renders on Vercel (UTC) and
 * again in the browser (Bangkok), and a delivery at 00:30 Bangkok read as the
 * 28th on the server and the 29th in the browser — a hydration error on every
 * such ticket. The day and time are read AND written on the shop's clock
 * (`shopDayKey` / `hhmm`, and an explicit +07:00), so both renders agree
 * wherever the code runs.
 *
 * Second deviation: the time part is a fixed 09:00–18:00 list (`TimeSelect`),
 * not an admin-managed one — see that file for why.
 */
export function DateTimeField({
  value,
  onChange,
  label,
}: {
  value: Date;
  onChange: (d: Date) => void;
  /**
   * Names the date input for assistive tech. The visible caption sits outside
   * this component, so without it the field is announced only as "date".
   */
  label?: string;
}) {
  const dateStr = shopDayKey(value);
  const timeStr = hhmm(value);

  function setDate(d: string) {
    onChange(new Date(`${d}T${timeStr}:00${SHOP_OFFSET}`));
  }
  function setTime(t: string) {
    onChange(new Date(`${dateStr}T${t}:00${SHOP_OFFSET}`));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Through ThaiDateInput so the date is also stated as 10 ก.ย. 2569: the
          native control renders in the DEVICE locale, and 09/10/2026 means two
          different months to two different readers. */}
      <ThaiDateInput
        value={dateStr}
        onChange={setDate}
        ariaLabel={label ? `${label} — วันที่` : undefined}
      />
      <TimeSelect value={timeStr} onChange={setTime} />
    </div>
  );
}
