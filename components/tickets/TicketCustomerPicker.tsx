'use client';

import { useState } from 'react';

import type { RetailCustomer } from './types';

/**
 * Retail customer picker — select existing / add new / edit.
 * Ported from reference/v0.4/finnix-film.html:1270-1309.
 *
 * `setCustomers` updates the in-session retail-customer list. The chosen
 * customer's name/phone are snapshotted onto the ticket by `onSelect`; the
 * ticket save action persists that snapshot (tickets.customer_name / phone).
 */
export function TicketCustomerPicker({
  customerName,
  customerPhone,
  customers,
  setCustomers,
  onSelect,
}: {
  customerName: string;
  customerPhone: string;
  customers: RetailCustomer[];
  setCustomers: (c: RetailCustomer[]) => void;
  onSelect: (c: { name: string; phone: string }) => void;
}) {
  const [mode, setMode] = useState<'select' | 'new' | 'edit'>('select');
  const [form, setForm] = useState({ name: '', phone: '' });
  const matched = customers.find((c) => c.name === customerName && c.phone === customerPhone);

  function startNew() {
    setForm({ name: '', phone: '' });
    setMode('new');
  }
  function startEdit() {
    setForm({ name: matched?.name || customerName, phone: matched?.phone || customerPhone });
    setMode('edit');
  }
  function saveNew() {
    const id = Math.max(0, ...customers.map((c) => c.id)) + 1;
    const rec = { id, ...form };
    setCustomers([...customers, rec]);
    onSelect(rec);
    setMode('select');
  }
  function saveEdit() {
    if (matched) setCustomers(customers.map((c) => (c.id === matched.id ? { ...c, ...form } : c)));
    onSelect(form);
    setMode('select');
  }

  if (mode === 'select')
    return (
      <div className="flex gap-2 items-center">
        <select
          value={matched ? matched.id : ''}
          aria-label="เลือกลูกค้าจากทะเบียน"
          onChange={(e) => {
            if (e.target.value === '__new__') {
              startNew();
            } else {
              const c = customers.find((x) => x.id === Number(e.target.value));
              if (c) onSelect(c);
            }
          }}
          className="field flex-1 text-sm px-3 py-2"
        >
          <option value="" disabled>
            เลือกลูกค้าจากทะเบียน หรือเพิ่มใหม่...
          </option>
          <option value="__new__">+ เพิ่มลูกค้าใหม่</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} &middot; {c.phone}
            </option>
          ))}
        </select>
        {matched && (
          <button
            onClick={startEdit}
            className="btn-outline px-3 py-2 rounded-lg text-xs"
            aria-label="แก้ไขข้อมูลลูกค้า"
          >
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
        {mode === 'new' ? 'เพิ่มลูกค้าใหม่เข้าทะเบียน' : 'แก้ไขข้อมูลลูกค้า'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <input
          placeholder="ชื่อลูกค้า"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="field text-sm px-3 py-2"
        />
        <input
          placeholder="เบอร์โทร"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
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
