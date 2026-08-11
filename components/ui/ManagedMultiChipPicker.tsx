'use client';

import { useState } from 'react';

import { useCanManageOptions } from './optionManage';

/**
 * Ported from reference/v0.4/finnix-film.html:1238-1269 (managed multi-select
 * chip picker). Adding and removing entries is admin-only (`options.manage`);
 * ticking the existing ones is not.
 */
export function ManagedMultiChipPicker({
  values,
  onChange,
  options,
  setOptions,
}: {
  values: string[];
  onChange: (vs: string[]) => void;
  options: string[];
  setOptions: (opts: string[]) => void;
}) {
  const canManage = useCanManageOptions();
  const [manage, setManage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState('');

  function toggle(o: string) {
    onChange(values.includes(o) ? values.filter((x) => x !== o) : [...values, o]);
  }

  function commitAdd() {
    const v = newVal.trim();
    if (v && !options.includes(v)) setOptions([...options, v]);
    setAdding(false);
    setNewVal('');
  }

  function removeOption(o: string) {
    setOptions(options.filter((x) => x !== o));
    onChange(values.filter((x) => x !== o));
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {options.map((o) => (
        <div key={o} className="relative group">
          <button
            onClick={() => toggle(o)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold"
            style={{
              background: values.includes(o) ? 'var(--primary)' : 'var(--paper)',
              color: values.includes(o) ? '#fff' : 'var(--ink-soft)',
              border: values.includes(o) ? 'none' : '1px solid var(--line)',
            }}
          >
            {o}
          </button>
          {canManage && manage && (
            <button
              onClick={() => removeOption(o)}
              aria-label={`ลบ ${o}`}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] flex items-center justify-center"
              style={{ background: '#C24B57', color: '#fff' }}
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          )}
        </div>
      ))}
      {canManage && adding ? (
        <div className="flex gap-1 items-center">
          <input
            autoFocus
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            placeholder="ตัวเลือกใหม่"
            className="field text-xs px-2.5 py-1.5 w-28"
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <button
            onClick={commitAdd}
            aria-label="ยืนยันเพิ่มตัวเลือก"
            className="text-xs px-2 py-1.5 rounded-full"
            style={{ background: 'var(--primary)', color: '#fff' }}
          >
            <i className="fa-solid fa-check"></i>
          </button>
        </div>
      ) : (
        canManage && (
          <button
            onClick={() => setAdding(true)}
            aria-label="เพิ่มตัวเลือกใหม่"
            className="text-xs w-7 h-7 rounded-full flex items-center justify-center"
            style={{ border: '1px dashed var(--line-strong)', color: 'var(--ink-soft)' }}
          >
            <i className="fa-solid fa-plus"></i>
          </button>
        )
      )}
      {canManage && (
        <button
          onClick={() => setManage(!manage)}
          aria-label="จัดการตัวเลือก"
          className="text-xs w-7 h-7 rounded-full flex items-center justify-center"
          style={{ color: manage ? 'var(--primary)' : 'var(--ink-faint)' }}
        >
          <i className="fa-solid fa-gear"></i>
        </button>
      )}
    </div>
  );
}
