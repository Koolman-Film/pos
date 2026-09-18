'use client';

import { useState } from 'react';

import { PhoneInput, PhoneOwnersWarning } from '@/components/ui/PhoneField';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { cleanPhones, findPhoneOwners, samePhones } from '@/lib/domain/phone';

import type { RetailCustomer } from './types';

/**
 * Retail customer picker — select existing / add new / edit.
 * Ported from reference/v0.4/finnix-film.html:1270-1309.
 *
 * `setCustomers` updates the in-session retail-customer list. The chosen
 * customer's name/phone are snapshotted onto the ticket by `onSelect`; the
 * ticket save action persists that snapshot (tickets.customer_name / phone).
 *
 * พิมพ์ค้นหาได้ (ร้านขอ 18 ก.ย. 2569): the registry runs to hundreds of names,
 * which is not a list anyone scrolls accurately. The phone is searchable too —
 * a customer ringing about their car gives that before their name.
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
  // By the digits: a customer saved as 081-234-5678 is still the one whose
  // ticket now says 0812345678.
  const matched = customers.find(
    (c) => c.name === customerName && samePhones(c.phone, customerPhone),
  );
  // เบอร์ซ้ำ — anyone else already under a number being typed in here.
  const owners =
    mode === 'select'
      ? []
      : findPhoneOwners(form.phone, customers, mode === 'edit' ? matched?.id : undefined);

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
    const rec = { id, ...form, phone: cleanPhones(form.phone) };
    setCustomers([...customers, rec]);
    onSelect(rec);
    setMode('select');
  }
  function saveEdit() {
    const rec = { ...form, phone: cleanPhones(form.phone) };
    if (matched) setCustomers(customers.map((c) => (c.id === matched.id ? { ...c, ...rec } : c)));
    onSelect(rec);
    setMode('select');
  }

  if (mode === 'select')
    return (
      <div className="flex gap-2 items-center">
        <SearchableSelect
          value={matched ? String(matched.id) : ''}
          label="เลือกลูกค้าจากทะเบียน"
          placeholder="เลือกลูกค้าจากทะเบียน หรือพิมพ์ชื่อ/เบอร์เพื่อค้นหา..."
          emptyText="ไม่พบลูกค้าที่ค้นหา — กด + เพิ่มลูกค้าใหม่ ด้านบน"
          options={[
            { value: '__new__', label: '+ เพิ่มลูกค้าใหม่', action: true },
            ...customers.map((c) => ({
              value: String(c.id),
              label: c.name,
              note: c.phone,
            })),
          ]}
          onChange={(v) => {
            if (v === '__new__') {
              startNew();
              return;
            }
            const c = customers.find((x) => String(x.id) === v);
            if (c) onSelect(c);
          }}
          className="field flex-1 text-sm px-3 py-2"
        />
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
        <PhoneInput
          placeholder="เบอร์โทร (ไม่ต้องใส่ - · หลายเบอร์คั่นด้วย ,)"
          ariaLabel="เบอร์โทรลูกค้าใหม่"
          value={form.phone}
          onChange={(phone) => setForm({ ...form, phone })}
          className="field text-sm px-3 py-2"
        />
      </div>
      <PhoneOwnersWarning
        owners={owners}
        onUse={
          mode === 'new'
            ? (c) => {
                onSelect(c);
                setMode('select');
              }
            : undefined
        }
      />
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
          {mode === 'new'
            ? owners.length > 0
              ? 'ยืนยันเพิ่มเป็นลูกค้าใหม่'
              : 'บันทึกลูกค้าใหม่'
            : 'บันทึกการแก้ไข'}
        </button>
      </div>
    </div>
  );
}
