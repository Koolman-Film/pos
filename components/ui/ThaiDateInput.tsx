'use client';

import { fmtThaiDayString } from '@/lib/domain/format';

/**
 * ช่องเลือกวันที่ ที่บอกวันที่เป็นภาษาไทยเสมอ.
 *
 * `<input type="date">` is drawn by the BROWSER in the device's locale, and no
 * CSS or attribute changes that. On a phone set to English it reads `09/10/2026`
 * — which is 9 October to half the world and 10 September to the other half, and
 * on a ใบงาน that difference is a car arriving a month early.
 *
 * The native control stays, because it is the picker people already know and the
 * only good one on a phone. What is added is a caption underneath stating the
 * same date the unambiguous way: `10 ก.ย. 2569`.
 *
 * The caption is formatted from the input's OWN `YYYY-MM-DD` string rather than
 * from a Date, so the two can never disagree: no time zone sits between them to
 * shift one and not the other.
 */
export function ThaiDateInput({
  value,
  onChange,
  ariaLabel,
  className = 'field w-full text-sm px-3 py-2',
  disabled,
}: {
  /** `YYYY-MM-DD`, exactly as the native input holds it. */
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <input
        type="date"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        disabled={disabled}
      />
      {/* aria-hidden: a screen reader already reads the input's real value, and
          hearing the same date twice in two formats is noise, not clarity. */}
      {value && (
        <p
          aria-hidden="true"
          className="text-xs mt-0.5"
          style={{ color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}
        >
          {fmtThaiDayString(value)}
        </p>
      )}
    </div>
  );
}
