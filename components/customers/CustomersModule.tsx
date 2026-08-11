'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Badge, type StatusConfig } from '@/components/ui/Badge';
import { fmt, fmtThaiDate } from '@/lib/domain/format';

import type { CustomerRow } from './types';

/**
 * ทะเบียนลูกค้า — the customer registry.
 *
 * One row per `retail_customers` record, with the job history, vehicles and
 * lifetime spend derived server-side from that customer's tickets. The point of
 * the module is the two things the trial run asked for: somewhere to look a
 * customer up, and a one-click "สร้างใบงาน" that carries their details into a
 * new ticket instead of retyping the name and phone every visit.
 */
export function CustomersModule({
  customers,
  shops,
  statuses,
  canEdit,
  canCreateTicket,
  saveAction,
  deleteAction,
}: {
  customers: CustomerRow[];
  shops: { id: string; name: string }[];
  statuses: StatusConfig[];
  canEdit: boolean;
  canCreateTicket: boolean;
  saveAction: (input: {
    id?: number;
    name: string;
    phone: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  deleteAction: (id: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [form, setForm] = useState<{ id?: number; name: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? id;

  const q = search.trim().toLowerCase();
  const visible = q
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.vehicles.some(
            (v) =>
              v.plate.toLowerCase().includes(q) ||
              `${v.brand} ${v.model}`.toLowerCase().includes(q),
          ),
      )
    : customers;

  function submit() {
    if (!form) return;
    setError(null);
    startTransition(async () => {
      const res = await saveAction(form);
      if (!res.ok) {
        setError(res.error || 'บันทึกไม่สำเร็จ');
        return;
      }
      setForm(null);
      router.refresh();
    });
  }

  function remove(c: CustomerRow) {
    if (!window.confirm(`ลบ ${c.name} ออกจากทะเบียนลูกค้า?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAction(c.id);
      if (!res.ok) {
        setError(res.error || 'ลบไม่สำเร็จ');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">ทะเบียนลูกค้า</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
            ลูกค้าทั้งหมด {customers.length} ราย &middot; ประวัติงานและรถดึงจากใบงานโดยตรง
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => {
              setError(null);
              setForm({ name: '', phone: '' });
            }}
            className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2"
          >
            <i className="fa-solid fa-user-plus"></i>เพิ่มลูกค้า
          </button>
        )}
      </div>

      {error && (
        <p
          className="text-sm mb-3 px-3 py-2 rounded-lg"
          style={{ background: '#FBEAEC', color: '#B23A48' }}
          role="alert"
        >
          <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
          {error}
        </p>
      )}

      {form && (
        <div className="card p-5 mb-4">
          <p className="text-sm font-semibold mb-3">
            {form.id ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้าใหม่'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                className="text-xs font-medium block mb-1"
                style={{ color: 'var(--ink-soft)' }}
                htmlFor="customer-name"
              >
                ชื่อลูกค้า *
              </label>
              <input
                id="customer-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="เช่น คุณ กิว"
                className="field w-full text-sm px-3 py-2"
              />
            </div>
            <div>
              <label
                className="text-xs font-medium block mb-1"
                style={{ color: 'var(--ink-soft)' }}
                htmlFor="customer-phone"
              >
                เบอร์โทร
              </label>
              <input
                id="customer-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="081-0000000"
                className="field w-full text-sm px-3 py-2"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setForm(null)}
              className="btn-outline flex-1 rounded-xl py-2.5 text-sm font-medium"
            >
              ยกเลิก
            </button>
            <button
              onClick={submit}
              disabled={pending}
              className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-semibold"
              style={{ opacity: pending ? 0.7 : 1 }}
            >
              {pending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      )}

      <div className="card p-5 sm:p-6">
        <div className="relative mb-4">
          <i
            className="fa-solid fa-magnifying-glass absolute left-3.5 top-3 text-xs"
            style={{ color: 'var(--ink-faint)' }}
          ></i>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ / เบอร์โทร / ทะเบียนรถ / รุ่นรถ"
            aria-label="ค้นหาลูกค้า"
            className="field w-full text-sm pl-9 pr-3.5 py-2.5"
          />
        </div>

        {visible.length === 0 && (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--ink-faint)' }}>
            {customers.length === 0 ? 'ยังไม่มีลูกค้าในทะเบียน' : 'ไม่พบลูกค้าที่ค้นหา'}
          </p>
        )}

        {visible.map((c) => (
          <div key={c.id} style={{ borderTop: '1px solid var(--line)' }}>
            <div className="flex items-center justify-between gap-3 py-3 flex-wrap">
              <button
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                className="text-left min-w-0 flex-1"
                aria-expanded={expanded === c.id}
              >
                <p className="text-sm font-semibold">
                  {c.name}
                  {c.phone ? (
                    <span className="font-normal" style={{ color: 'var(--ink-soft)' }}>
                      {' '}
                      &middot; {c.phone}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                  {c.ticketCount} ใบงาน &middot; ยอดรวม {fmt(c.totalSpent)}
                  {c.lastVisit ? ` · ล่าสุด ${fmtThaiDate(c.lastVisit)}` : ''}
                </p>
                {c.vehicles.length > 0 && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                    <i className="fa-solid fa-car mr-1"></i>
                    {c.vehicles
                      .map((v) => `${v.brand} ${v.model}${v.plate ? ` (${v.plate})` : ''}`.trim())
                      .join(', ')}
                  </p>
                )}
              </button>
              <div className="flex gap-2 flex-shrink-0">
                {canCreateTicket && (
                  <Link
                    href={`/tickets/new?customer=${c.id}`}
                    className="btn-primary text-xs px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-plus"></i>สร้างใบงาน
                  </Link>
                )}
                {canEdit && (
                  <>
                    <button
                      onClick={() => {
                        setError(null);
                        setForm({ id: c.id, name: c.name, phone: c.phone });
                      }}
                      className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
                      aria-label={`แก้ไข ${c.name}`}
                    >
                      <i className="fa-solid fa-pen"></i>
                    </button>
                    <button
                      onClick={() => remove(c)}
                      className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
                      style={{ color: '#B23A48' }}
                      aria-label={`ลบ ${c.name}`}
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </>
                )}
              </div>
            </div>
            {expanded === c.id && (
              <div className="pb-3">
                {c.tickets.length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                    ยังไม่มีใบงานของลูกค้ารายนี้
                  </p>
                )}
                {c.tickets.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="flex items-center justify-between gap-2 py-2 px-3 rounded-xl mb-1.5"
                    style={{ background: 'var(--paper)' }}
                  >
                    <span className="text-xs font-medium truncate">
                      #{t.id} &middot; {shopName(t.shop)} &middot; {fmtThaiDate(t.dropOff)}
                    </span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      <Badge status={t.status} statuses={statuses} />
                      <span className="text-xs font-semibold">{fmt(t.total)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
