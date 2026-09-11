'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * ช่องเลือกที่พิมพ์ค้นหาได้ สำหรับรายการที่เก็บเป็น id ไม่ใช่ชื่อ.
 *
 * The shop asked for the same typing that Book งาน's product picker gives them,
 * on the wholesale customer field: a list of 40+ shop names, several of which
 * start with the same word ("Finnix เชียงใหม่", "Finnix เชียงราย", "Finnix ลำพูน"),
 * is not something anyone can scroll through accurately.
 *
 * WHY NOT `ProductPicker`. That one is keyed on the product NAME, because a name
 * is exactly what a ticket line and a PO line store. A customer is stored by
 * `customer_id`, and two customers may legitimately share a name — matching one
 * back by its label would pick whichever happened to be first. So this returns
 * the value it was given, and the label is only ever for reading.
 *
 * Keyboard behaviour matches ProductPicker on purpose: the two sit on the same
 * form, and a picker that answered ArrowDown differently from the one above it
 * would be its own small bug.
 */

export type SearchableOption = {
  /** Stable key and what `onChange` hands back — an id, not a label. */
  value: string;
  label: string;
  /** Right-hand hint, e.g. a phone number. Searchable too. */
  note?: string;
  /** Renders first, above the real options — e.g. "+ เพิ่มลูกค้าใหม่". */
  action?: boolean;
};

function matches(o: SearchableOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return o.label.toLowerCase().includes(q) || (o.note ?? '').toLowerCase().includes(q);
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  label,
  className = 'field w-full text-sm px-3 py-2',
  emptyText = 'ไม่พบรายการที่ค้นหา',
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  /** Accessible name for the input — the visible caption sits outside. */
  label?: string;
  className?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // An action row ("+ เพิ่มลูกค้าใหม่") is not a search result and stays put, so
  // it is reachable no matter what has been typed.
  const actions = options.filter((o) => o.action);
  const found = options.filter((o) => !o.action && matches(o, query));
  const shown = [...actions, ...found];

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

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQuery('');
  }

  const selected = options.find((o) => o.value === value && !o.action);
  // While the list is open the box shows what is being typed; closed, it falls
  // back to whatever is actually selected.
  const display = open ? query : (selected?.label ?? '');

  return (
    <div ref={wrapRef} className="relative flex-1">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label ?? placeholder}
        value={display}
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
            setActive((i) => Math.min(i + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open && shown[active]) {
            e.preventDefault();
            choose(shown[active].value);
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
            maxHeight: 240,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: '0 8px 24px rgba(0,0,0,.12)',
          }}
        >
          {shown.length === 0 && (
            <li className="px-3 py-2 text-xs" style={{ color: 'var(--ink-faint)' }}>
              {emptyText}
            </li>
          )}
          {shown.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              // onMouseDown, not onClick: the outside-click handler above fires
              // on mousedown and would close the list before a click landed.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o.value);
              }}
              onMouseEnter={() => setActive(i)}
              className="px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-3"
              style={{
                background: i === active ? 'var(--paper)' : 'transparent',
                color: o.action ? 'var(--primary)' : 'var(--ink)',
                fontWeight: o.action || o.value === value ? 600 : 400,
              }}
            >
              <span className="truncate">{o.label}</span>
              {o.note && (
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--ink-faint)' }}>
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
