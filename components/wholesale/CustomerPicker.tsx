'use client';

import { useState } from 'react';

import type { WsCustomer } from './types';

/**
 * Ported from reference/v0.4/finnix-film.html:2649-2689.
 *
 * The prototype mutated an in-memory `customers` array through `setCustomers`.
 * In the port the list lives in the database, so saving a new/edited customer
 * goes through the optional `onSaveCustomer` server action (which returns the
 * persisted id). When no action is supplied — e.g. a unit test rendering the
 * picker in isolation — it falls back to the prototype's local-only behaviour so
 * the component stays self-contained.
 */
export function CustomerPicker({
  customerId,
  customers,
  onSelect,
  onSaveCustomer,
}: {
  customerId: number | null;
  customers: WsCustomer[];
  onSelect: (id: number) => void;
  onSaveCustomer?: (input: {
    id?: number;
    name: string;
    phone: string;
    address: string;
  }) => Promise<number> | number;
}) {
  const [mode, setMode] = useState<'select' | 'new' | 'edit'>('select');
  const [list, setList] = useState<WsCustomer[]>(customers);
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const current = list.find((c) => c.id === customerId);

  function startEdit() {
    if (!current) return;
    setForm({ name: current.name, phone: current.phone, address: current.address });
    setMode('edit');
  }
  function startNew() {
    setForm({ name: '', phone: '', address: '' });
    setMode('new');
  }
  async function saveNew() {
    let id: number;
    if (onSaveCustomer) {
      id = await onSaveCustomer(form);
    } else {
      id = Math.max(0, ...list.map((c) => c.id)) + 1;
    }
    setList([...list, { id, ...form }]);
    onSelect(id);
    setMode('select');
  }
  async function saveEdit() {
    if (!current) return;
    if (onSaveCustomer) await onSaveCustomer({ id: current.id, ...form });
    setList(list.map((c) => (c.id === current.id ? { ...c, ...form } : c)));
    setMode('select');
  }

  if (mode === 'select')
    return (
      <div className="flex gap-2 items-center">
        <button
          onClick={startNew}
          className="btn-outline px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
        >
          <i className="fa-solid fa-plus"></i>ลูกค้าใหม่
        </button>
        <select
          value={customerId || ''}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              startNew();
            } else {
              onSelect(Number(e.target.value));
            }
          }}
          className="field flex-1 text-sm px-3 py-2 font-medium"
        >
          <option value="" disabled>
            เลือกลูกค้า...
          </option>
          <option value="__new__">+ เพิ่มลูกค้าใหม่</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {current && (
          <button onClick={startEdit} className="btn-outline px-3 py-2 rounded-lg text-xs">
            <i className="fa-solid fa-pen"></i>
          </button>
        )}
      </div>
    );

  return (
    <div
      className="rounded-2xl p-4"
      style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}
    >
      <p className="text-xs font-semibold mb-3" style={{ color: 'var(--primary)' }}>
        {mode === 'new' ? 'เพิ่มลูกค้าใหม่' : 'แก้ไขข้อมูลลูกค้า'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <input
          placeholder="ชื่อลูกค้า/ร้าน"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="field text-sm px-3 py-2 sm:col-span-1"
        />
        <input
          placeholder="เบอร์โทร"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="field text-sm px-3 py-2"
        />
        <input
          placeholder="ที่อยู่ / จังหวัด"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          className="field text-sm px-3 py-2"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setMode('select')}
          className="btn-outline flex-1 rounded-lg py-2 text-xs font-medium"
        >
          ยกเลิก
        </button>
        <button
          onClick={mode === 'new' ? saveNew : saveEdit}
          className="btn-primary flex-1 rounded-lg py-2 text-xs font-semibold"
        >
          {mode === 'new' ? 'บันทึกลูกค้าใหม่' : 'บันทึกการแก้ไข'}
        </button>
      </div>
    </div>
  );
}
