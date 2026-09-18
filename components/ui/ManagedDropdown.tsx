'use client';

import { useState } from 'react';

import { SearchableSelect } from './SearchableSelect';
import { useCanManageOptions } from './optionManage';

/**
 * Ported from reference/v0.4/finnix-film.html:1150-1183 (managed dropdown,
 * add/remove options inline).
 *
 * The inline "+ เพิ่มตัวเลือกใหม่..." row and the delete button are admin-only
 * (`options.manage`). The prototype let anyone extend these lists and the trial
 * run showed where that leads — the time-slot list filled up with typos and
 * duplicates. Everyone can still SELECT from the list.
 *
 * พิมพ์ค้นหาได้ (ร้านขอ 18 ก.ย. 2569): the lists behind these — จองผ่าน, ยี่ห้อรถ,
 * หมวดค่าใช้จ่าย, ชนิดสินค้า — have grown past what anyone can scroll accurately,
 * so the control is the same typed picker the customer fields use. It still
 * stores the VALUE, which for these lists is the label itself.
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
      <SearchableSelect
        value={value}
        onChange={(v) => (v === '__add__' ? setAdding(true) : onChange(v))}
        options={[
          // Stays above the results, so it is reachable whatever has been typed.
          ...(canManage
            ? [{ value: '__add__', label: '+ เพิ่มตัวเลือกใหม่...', action: true }]
            : []),
          ...shown.map((o) => ({ value: o, label: o })),
        ]}
        placeholder={placeholder || 'เลือก...'}
        label={placeholder || 'เลือก...'}
        className="field flex-1 text-sm px-3 py-2"
        emptyText="ไม่พบตัวเลือกที่ค้นหา"
      />
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
