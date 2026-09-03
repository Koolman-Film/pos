'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { fmt, fmtThaiDate } from '@/lib/domain/format';
import { orderTotal } from '@/lib/domain/orders';

import { customerName, shopName, type Shop, type WsCustomer, type WsDeletedOrder } from './types';

/**
 * ถังขยะ PO — the other half of the soft delete (migration 0040).
 *
 * Its own route rather than a mode of `WholesaleList`: the bin needs different
 * columns (who deleted it, when), a different action, and it is seen by a small
 * set of roles. Only a caller holding `wholesale.restore` ever reaches this
 * page; the page itself re-checks, and the database trigger checks again.
 *
 * Restoring puts the goods back through stock, so the confirmation says so — a
 * PO restored months later moves today's count, and somebody has to expect that.
 */
export function WholesaleTrash({
  orders,
  customers = [],
  shops = [],
  restoreAction,
}: {
  orders: WsDeletedOrder[];
  customers?: WsCustomer[];
  shops?: Shop[];
  restoreAction: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function restore(o: WsDeletedOrder) {
    if (
      !window.confirm(
        `กู้คืน ${o.id} ของ ${customerName(o.customerId, customers) || 'ลูกค้า'}?` +
          '\n\nPO จะกลับไปแสดงในรายการและถูกนับในยอดขายอีกครั้ง ' +
          'สินค้าในรายการจะถูกตัดออกจากสต็อกอีกครั้งด้วย',
      )
    ) {
      return;
    }
    setError(null);
    setBusyId(o.id);
    startTransition(async () => {
      const res = await restoreAction(o.id);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error || 'กู้คืนไม่สำเร็จ');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">ถังขยะ PO ขายส่ง</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
            PO ที่ถูกลบ ยังไม่ถูกทำลาย เลขที่ PO ยังถูกจองไว้ กู้คืนกลับไปที่รายการได้
          </p>
        </div>
        <Link
          href="/wholesale"
          className="btn-outline text-sm px-4 py-2 rounded-xl font-medium flex items-center gap-2"
        >
          <i className="fa-solid fa-arrow-left"></i>กลับไปรายการขายส่ง
        </Link>
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

      <div className="card p-5 sm:p-6">
        {orders.length === 0 && (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--ink-faint)' }}>
            ถังขยะว่าง — ยังไม่มี PO ที่ถูกลบ
          </p>
        )}
        {orders.map((o) => (
          <div
            key={o.id}
            className="flex items-center justify-between gap-3 py-3 flex-wrap"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {o.id} &middot; {customerName(o.customerId, customers)}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                {shopName(o.shop, shops)} &middot; {o.items.length} รายการ &middot; ยอด{' '}
                {fmt(orderTotal(o))}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                ลบเมื่อ {fmtThaiDate(o.deletedAt)}
                {o.deletedByName ? ` โดย ${o.deletedByName}` : ''}
              </p>
            </div>
            <button
              onClick={() => restore(o)}
              disabled={pending && busyId === o.id}
              className="btn-primary text-xs px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5 flex-shrink-0"
              style={{ opacity: pending && busyId === o.id ? 0.7 : 1 }}
            >
              <i
                className={`fa-solid ${
                  pending && busyId === o.id ? 'fa-spinner fa-spin' : 'fa-rotate-left'
                }`}
              ></i>
              กู้คืน
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
