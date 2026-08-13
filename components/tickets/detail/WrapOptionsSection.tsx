'use client';

import { WRAP_OPTIONS } from '../wrapOptions';

/**
 * Option / รายการแถม — the tick row from the paper ฟิล์มกันรอย form.
 *
 * Shown once per ticket rather than once per ฟิล์มกันรอย item: it describes what
 * is done to the CAR (which trims are wrapped, which badges come off), not what
 * was sold on a particular line, and the printed sheet has always carried a
 * single row of boxes.
 */
export function WrapOptionsSection({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(name: string) {
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  }

  return (
    <div className="mb-5">
      <p
        className="text-xs font-medium mb-2 flex items-center gap-1.5"
        style={{ color: 'var(--ink-soft)' }}
      >
        <i className="fa-solid fa-gift"></i>Option / รายการแถม (งานฟิล์มกันรอย)
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {WRAP_OPTIONS.map((name) => (
          <label
            key={name}
            className="flex items-center gap-2 text-sm rounded-xl px-3 py-2 cursor-pointer"
            style={{
              border: '1px solid var(--line)',
              background: selected.includes(name) ? 'var(--paper)' : 'transparent',
            }}
          >
            <input
              type="checkbox"
              checked={selected.includes(name)}
              onChange={() => toggle(name)}
              className="flex-shrink-0"
            />
            <span>{name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
