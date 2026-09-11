'use client';

import { useState } from 'react';

import type { SalesPerson } from './types';

/**
 * เลือกพนักงานขายของ PO และเพิ่ม/แก้ไขชื่อกับเบอร์โทรได้จากตรงนี้.
 *
 * `sales_people` had no screen anywhere in the app (migration 0047 created the
 * table and seeded โหน่ง and เคน with empty phones), so the phone number that the
 * invoice, the delivery note and the shipping label are built around could only
 * be set by editing the database by hand.
 *
 * It lives inside the PO form rather than in a settings page for the same reason
 * `CustomerPicker` does: the moment somebody notices the number is missing is
 * the moment they are filling in a PO, and sending them to another screen to fix
 * it means the PO gets saved without it.
 */
export function SalesPersonPicker({
  value,
  shop,
  people,
  canManage,
  onSelect,
  onSavePerson,
}: {
  /** The NAME stored on the PO (`orders.sales_by`), not an id. */
  value: string;
  shop: string;
  /** Already filtered to this branch by the caller. */
  people: SalesPerson[];
  /** `options.manage` — selecting is for everyone, editing the list is not. */
  canManage: boolean;
  onSelect: (name: string) => void;
  onSavePerson?: (input: {
    id?: number;
    shop: string;
    name: string;
    phone: string;
  }) => Promise<{ ok: boolean; error?: string; name?: string }>;
}) {
  const [mode, setMode] = useState<'select' | 'new' | 'edit'>('select');
  const [list, setList] = useState<SalesPerson[]>(people);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [error, setError] = useState('');
  const current = list.find((p) => p.name === value) ?? null;

  function startNew() {
    setError('');
    setForm({ name: '', phone: '' });
    setMode('new');
  }
  function startEdit() {
    if (!current) return;
    setError('');
    setForm({ name: current.name, phone: current.phone });
    setMode('edit');
  }

  async function save() {
    const name = form.name.trim();
    if (!name) {
      setError('ต้องใส่ชื่อพนักงานขาย');
      return;
    }
    const res = await onSavePerson?.({ id: current?.id, shop, name, phone: form.phone.trim() });
    if (res && !res.ok) {
      setError(res.error ?? 'บันทึกไม่สำเร็จ');
      return;
    }
    /*
      Mirrored locally so the picker is usable immediately — the page revalidates
      behind this, but the person is mid-PO and should not have to wait or
      re-pick. On an edit the PO's stored name follows the rename, because
      `orders.sales_by` holds the name and a rename would otherwise orphan it.
    */
    if (mode === 'edit' && current) {
      setList(
        list.map((p) => (p.id === current.id ? { ...p, name, phone: form.phone.trim() } : p)),
      );
      if (value === current.name) onSelect(name);
    } else {
      setList([...list, { id: Date.now(), shop, name, phone: form.phone.trim() }]);
      onSelect(name);
    }
    setMode('select');
  }

  if (mode === 'select') {
    return (
      <div className="mt-2">
        <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
          พนักงานขาย
        </label>
        <div className="flex gap-2 items-center">
          <select
            aria-label="พนักงานขายของ PO นี้"
            value={value}
            onChange={(e) => onSelect(e.target.value)}
            className="field flex-1 text-sm px-3 py-2"
          >
            <option value="">ยังไม่ระบุ</option>
            {list.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
                {p.phone ? ` · ${p.phone}` : ' · ยังไม่มีเบอร์'}
              </option>
            ))}
          </select>
          {canManage && (
            <>
              {current && (
                <button
                  onClick={startEdit}
                  aria-label="แก้ไขพนักงานขาย"
                  title="แก้ไขชื่อ/เบอร์โทร"
                  className="btn-outline px-3 py-2 rounded-lg text-xs flex-shrink-0"
                >
                  <i className="fa-solid fa-pen"></i>
                </button>
              )}
              <button
                onClick={startNew}
                className="btn-outline px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
              >
                <i className="fa-solid fa-plus"></i>เพิ่ม
              </button>
            </>
          )}
        </div>
        {/* Said out loud, because a missing number is invisible until a customer
            cannot ring anyone back off a document that has already gone out. */}
        {current && !current.phone && (
          <p className="text-xs mt-1" style={{ color: '#8A5A12' }}>
            <i className="fa-solid fa-triangle-exclamation mr-1"></i>
            ยังไม่มีเบอร์โทร — เอกสารของ PO นี้จะขึ้นแค่ชื่อ
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-4 mt-2"
      style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}
    >
      <p className="text-xs font-semibold mb-3" style={{ color: 'var(--primary)' }}>
        {mode === 'new' ? 'เพิ่มพนักงานขาย' : 'แก้ไขพนักงานขาย'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <input
          placeholder="ชื่อพนักงานขาย"
          aria-label="ชื่อพนักงานขาย"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="field text-sm px-3 py-2"
        />
        <input
          placeholder="เบอร์โทร (พิมพ์บนเอกสาร)"
          aria-label="เบอร์โทรพนักงานขาย"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="field text-sm px-3 py-2"
        />
      </div>
      {error && (
        <p className="text-xs mb-2" style={{ color: '#B23A48' }} role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button onClick={save} className="btn-primary flex-1 rounded-xl py-2 text-sm font-semibold">
          บันทึก
        </button>
        <button
          onClick={() => setMode('select')}
          className="btn-outline flex-1 rounded-xl py-2 text-sm font-medium"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
