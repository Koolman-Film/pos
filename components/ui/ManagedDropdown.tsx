'use client';

import { useState } from 'react';

import { useCanManageOptions } from './optionManage';

/**
 * Ported from reference/v0.4/finnix-film.html:1150-1183 (managed dropdown,
 * add/remove options inline).
 *
 * The inline "+ เพิ่มตัวเลือกใหม่..." row and the delete button are admin-only
 * (`options.manage`). The prototype let anyone extend these lists and the trial
 * run showed where that leads — the time-slot list filled up with typos and
 * duplicates. Everyone can still SELECT from the list.
 */
export function ManagedDropdown({
  value,
  onChange,
  options,
  setOptions,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  setOptions: (opts: string[]) => void;
  placeholder?: string;
}) {
  const canManage = useCanManageOptions();
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState('');

  /**
   * A saved value that is no longer in the list still belongs in the list.
   *
   * Without this the `<select>` has no matching `<option>`, so the browser
   * displays the FIRST one — a product whose ชนิดสินค้า is "จอ" read as
   * "ฟิล์มกรองแสง", and saving the row from that screen wrote the wrong
   * category. Same rule the payment-method picker already follows.
   */
  const shown = value && !options.includes(value) ? [value, ...options] : options;

  function commitAdd() {
    const v = newVal.trim();
    if (!v) {
      setAdding(false);
      return;
    }
    if (!options.includes(v)) setOptions([...options, v]);
    onChange(v);
    setAdding(false);
    setNewVal('');
  }

  function removeCurrent() {
    setOptions(options.filter((o) => o !== value));
    onChange('');
  }

  if (adding)
    return (
      <div className="flex gap-2">
        <input
          autoFocus
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          placeholder="พิมพ์ตัวเลือกใหม่..."
          aria-label={`เพิ่มตัวเลือกใหม่${placeholder ? ` — ${placeholder}` : ''}`}
          className="field flex-1 text-sm px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitAdd();
            if (e.key === 'Escape') setAdding(false);
          }}
        />
        <button onClick={commitAdd} className="btn-primary px-3 rounded-lg text-xs font-semibold">
          เพิ่ม
        </button>
        <button onClick={() => setAdding(false)} className="btn-outline px-3 rounded-lg text-xs">
          ยกเลิก
        </button>
      </div>
    );

  return (
    <div className="flex gap-2">
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === '__add__') {
            setAdding(true);
          } else {
            onChange(e.target.value);
          }
        }}
        // The visible cue for this control is its placeholder option; without
        // this the select is announced as unnamed.
        aria-label={placeholder || 'เลือก...'}
        className="field flex-1 text-sm px-3 py-2"
      >
        <option value="" disabled>
          {placeholder || 'เลือก...'}
        </option>
        {shown.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {canManage && <option value="__add__">+ เพิ่มตัวเลือกใหม่...</option>}
      </select>
      {canManage && value && (
        <button
          onClick={removeCurrent}
          title="ลบตัวเลือกนี้ออกจากระบบ"
          aria-label="ลบตัวเลือกนี้ออกจากระบบ"
          className="btn-outline px-3 rounded-lg text-xs"
          style={{ color: '#B23A48' }}
        >
          <i className="fa-solid fa-trash"></i>
        </button>
      )}
    </div>
  );
}
