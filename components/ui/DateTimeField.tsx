'use client';

import { ManagedDropdown } from './ManagedDropdown';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Ported from reference/v0.4/finnix-film.html:1184-1196 (date + admin-manageable time slots).
 *
 * Deviation from the prototype: the prototype derives the date string with
 * `value.toISOString().slice(0,10)`, which is UTC. In Asia/Bangkok (UTC+7) that
 * renders the *previous* day for any time before 07:00, and `setTime` then
 * rebuilds the Date from that shifted day — silently moving a booking back one
 * day. We format from the local date parts instead, which is identical for all
 * mid-day values and correct at the edges.
 */
export function DateTimeField({
  value,
  onChange,
  timeSlots,
  setTimeSlots,
  label,
}: {
  value: Date;
  onChange: (d: Date) => void;
  timeSlots: string[];
  setTimeSlots: (s: string[]) => void;
  /**
   * Names the date input for assistive tech. The visible caption sits outside
   * this component, so without it the field is announced only as "date".
   */
  label?: string;
}) {
  const dateStr = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const timeStr = `${pad(value.getHours())}:${pad(value.getMinutes())}`;

  function setDate(d: string) {
    const [h, m] = timeStr.split(':');
    onChange(new Date(`${d}T${h}:${m}:00`));
  }
  function setTime(t: string) {
    onChange(new Date(`${dateStr}T${t}:00`));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="date"
        value={dateStr}
        aria-label={label ? `${label} — วันที่` : undefined}
        onChange={(e) => setDate(e.target.value)}
        className="field w-full text-sm px-3 py-2"
      />
      <ManagedDropdown
        value={timeStr}
        onChange={setTime}
        options={timeSlots}
        setOptions={setTimeSlots}
        placeholder="เลือกเวลา..."
      />
    </div>
  );
}
