'use client';

import { shortShopName } from '@/lib/domain/format';

/**
 * สาขาเป็นปุ่ม ไม่ใช่ดรอปดาวน์ — one control for every place a branch is picked.
 *
 * A dropdown hides every branch but the chosen one, so switching between two
 * of them is three actions and you cannot see what else is there. The
 * dashboard and Book งาน filters were already a row of buttons; the forms that
 * open a ticket or a PO still had a dropdown, so the same choice looked
 * different depending on the screen (ร้านแจ้ง 21 ก.ย. 2569). The row wraps, so
 * a seventh branch costs a line, not a redesign.
 *
 * A group of toggle buttons rather than radios: the pressed one is the value,
 * and `aria-pressed` is what a screen reader announces for it.
 */
export function ShopButtons({
  shops,
  value,
  onChange,
  label,
}: {
  shops: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  /** The group's accessible name — also what tests find it by. */
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {shops.map((s) => {
        const on = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            aria-pressed={on}
            title={s.name}
            className="text-xs px-3 py-2 rounded-xl font-semibold"
            style={{
              background: on ? 'var(--primary)' : 'transparent',
              color: on ? '#fff' : 'var(--ink-soft)',
              border: on ? '1.5px solid var(--primary)' : '1.5px solid var(--line)',
            }}
          >
            {shortShopName(s.name)}
          </button>
        );
      })}
    </div>
  );
}
