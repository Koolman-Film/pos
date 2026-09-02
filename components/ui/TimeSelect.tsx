'use client';

/**
 * Appointment-time picker over a FIXED list of business hours.
 *
 * This replaces the `ManagedDropdown` the prototype used for time slots
 * (reference/v0.4/finnix-film.html:1184-1196). That control let anyone add an
 * option inline, and the trial run showed what that produces in practice: the
 * shared `time_slots` list drifted into "16.00", "17.0", "12.00" — typos and
 * mixed separators, appended in creation order, so the dropdown was neither
 * complete nor sorted. Times are not a per-shop taxonomy like film positions or
 * technicians; they are the shop's opening hours, so they are a constant here
 * rather than an admin-managed list.
 */

/** 09:00 through 18:00, on the hour — the bookable window, already in order. */
export const TIME_SLOTS: string[] = Array.from(
  { length: 10 },
  (_, i) => `${String(9 + i).padStart(2, '0')}:00`,
);

export function TimeSelect({
  value,
  onChange,
  placeholder = 'เลือกเวลา...',
  className = 'field w-full text-sm px-3 py-2',
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /**
   * Overrides the placeholder as the accessible name. Needed wherever several
   * of these sit on one form — four "เวลา..." selects in a row are announced
   * identically and cannot be told apart, by a screen reader or by a test.
   */
  ariaLabel?: string;
}) {
  // A ticket saved before this change can hold a time outside the window (08:00,
  // or one of the malformed entries). Keeping it in the list means opening such
  // a ticket shows its real time instead of silently reading as blank — and
  // re-saving does not rewrite it behind the user's back. Only this one extra
  // value is admitted; there is still no way to add another.
  const options = value && !TIME_SLOTS.includes(value) ? [...TIME_SLOTS, value].sort() : TIME_SLOTS;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // The visible cue for this control is its placeholder option; without this
      // the select is announced as unnamed.
      aria-label={ariaLabel ?? placeholder}
      className={className}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
