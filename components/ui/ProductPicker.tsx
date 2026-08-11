'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Type-to-search product picker, replacing the plain `<select>` the ticket form
 * used for สินค้าที่ขาย / สินค้าที่จอง / สินค้าที่สนใจ and the per-position pickers.
 *
 * Two things the trial run asked for, both of which a `<select>` cannot do:
 *
 *  1. Search by name OR short name. A shop carries 135+ products whose names
 *     share long prefixes ("(ตรฟ.) ฟิล์มกรองแสง 3M Ceramate 40%"), so scrolling a
 *     native dropdown to find one is hopeless; staff know the short name
 *     ("3M CRM 35") and type that.
 *  2. Short name FIRST. The prototype rendered `name (shortName)`, which buries
 *     the part that identifies the product at the end of a line that is usually
 *     truncated. `productDisplay` puts the short name in front everywhere.
 *
 * The selected value stays the product's full `name` — that is the key the stock
 * lookup, the price matrix and the saved ticket rows all use. Only the display
 * changes.
 */

export type ProductOption = {
  id: number | string;
  name: string;
  shortName?: string;
  /** Right-hand hint, e.g. "คงเหลือ 18" or "ไม่มีในสาขานี้". */
  note?: string;
  /** Dims the row — used for products this shop does not stock. */
  muted?: boolean;
};

/** `ชื่อย่อ · ชื่อเต็ม`, or just the name when there is no short name. */
export function productDisplay(p: { name: string; shortName?: string }): string {
  return p.shortName ? `${p.shortName} · ${p.name}` : p.name;
}

/** Display label for a stored product name, resolved against the known options. */
export function productDisplayFor(name: string, options: ProductOption[]): string {
  if (!name) return '';
  const match = options.find((o) => o.name === name);
  return match ? productDisplay(match) : name;
}

/** Case-insensitive match over both the full name and the short name. */
export function productMatches(p: ProductOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return p.name.toLowerCase().includes(q) || (p.shortName ?? '').toLowerCase().includes(q);
}

export function ProductPicker({
  value,
  onChange,
  options,
  placeholder = 'ค้นหาสินค้า...',
  emptyLabel,
  disabled = false,
  className = 'field w-full text-sm px-3 py-2',
  label,
}: {
  /** The selected product's full name (''  when nothing is chosen). */
  value: string;
  onChange: (name: string) => void;
  options: ProductOption[];
  placeholder?: string;
  /** When set, the list offers a "clear" row with this label (optional fields). */
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Accessible name for the input — the visible caption sits outside. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const matches = useMemo(() => options.filter((o) => productMatches(o, query)), [options, query]);

  // Clicking anywhere else closes the list and drops the half-typed query, so
  // the input falls back to showing the product that is actually selected.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function choose(name: string) {
    onChange(name);
    setOpen(false);
    setQuery('');
  }

  const display = open ? query : productDisplayFor(value, options);

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label ?? placeholder}
        value={display}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault();
            choose(matches[active].name);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
          }
        }}
        className={className}
      />
      {open && (
        <ul
          role="listbox"
          id={listId}
          className="absolute z-20 left-0 right-0 mt-1 rounded-xl overflow-y-auto scrollbar-thin"
          style={{
            maxHeight: 220,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: '0 8px 24px rgba(0,0,0,.12)',
          }}
        >
          {emptyLabel && (
            <li
              role="option"
              aria-selected={value === ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose('')}
              className="px-3 py-2 text-xs cursor-pointer"
              style={{ color: 'var(--ink-faint)' }}
            >
              {emptyLabel}
            </li>
          )}
          {matches.length === 0 && (
            <li className="px-3 py-2 text-xs" style={{ color: 'var(--ink-faint)' }}>
              ไม่พบสินค้าที่ตรงกับ &quot;{query}&quot;
            </li>
          )}
          {matches.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.name === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o.name)}
              className="px-3 py-2 text-xs cursor-pointer flex items-baseline gap-2"
              style={{
                background:
                  i === active ? 'var(--paper)' : o.name === value ? 'var(--paper)' : 'transparent',
                fontWeight: o.name === value ? 600 : 400,
                opacity: o.muted ? 0.7 : 1,
              }}
            >
              <span className="min-w-0 flex-1 truncate">
                {o.shortName && <span className="font-semibold">{o.shortName}</span>}
                {o.shortName && <span style={{ color: 'var(--ink-faint)' }}> · </span>}
                <span style={{ color: o.shortName ? 'var(--ink-soft)' : undefined }}>{o.name}</span>
              </span>
              {o.note && (
                <span className="flex-shrink-0" style={{ color: 'var(--ink-faint)' }}>
                  {o.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
