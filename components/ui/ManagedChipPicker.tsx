'use client';

import { useState } from 'react';

/** Ported from reference/v0.4/finnix-film.html:1197-1237 (click to select, add/remove options). */
export function ManagedChipPicker({
  value,
  onChange,
  options,
  setOptions,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  setOptions: (opts: string[]) => void;
}) {
  const [manage, setManage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState('');

  function commitAdd() {
    const v = newVal.trim();
    if (v && !options.includes(v)) setOptions([...options, v]);
    if (v) onChange(v);
    setAdding(false);
    setNewVal('');
  }

  function removeOption(o: string) {
    setOptions(options.filter((x) => x !== o));
    if (value === o) onChange('');
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center">
        {options.map((o) => (
          <div key={o} className="relative group">
            <button
              onClick={() => onChange(o)}
              className="text-xs px-3 py-1.5 rounded-full font-semibold"
              style={{
                background: value === o ? 'var(--primary)' : 'var(--paper)',
                color: value === o ? '#fff' : 'var(--ink-soft)',
                border: value === o ? 'none' : '1px solid var(--line)',
              }}
            >
              {o}
            </button>
            {manage && (
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
        {adding ? (
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
          <button
            onClick={() => setAdding(true)}
            aria-label="เพิ่มตัวเลือกใหม่"
            className="text-xs w-7 h-7 rounded-full flex items-center justify-center"
            style={{ border: '1px dashed var(--line-strong)', color: 'var(--ink-soft)' }}
          >
            <i className="fa-solid fa-plus"></i>
          </button>
        )}
        <button
          onClick={() => setManage(!manage)}
          className="text-xs w-7 h-7 rounded-full flex items-center justify-center"
          style={{ color: manage ? 'var(--primary)' : 'var(--ink-faint)' }}
          title="จัดการตัวเลือก"
          aria-label="จัดการตัวเลือก"
        >
          <i className="fa-solid fa-gear"></i>
        </button>
      </div>
    </div>
  );
}
