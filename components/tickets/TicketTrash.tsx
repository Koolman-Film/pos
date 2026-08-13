'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { fmt, fmtThaiDate } from '@/lib/domain/format';
import { ticketTotal } from '@/lib/domain/tickets';

import type { Shop, TicketListRow } from './types';

/**
 * ถังขยะใบงาน — the other half of the soft delete (migration 0013).
 *
 * Its own route rather than a mode of `TicketList`: the bin needs different
 * columns (who deleted it, when), a different action, and it is seen by a small
 * set of roles. Only a caller holding `list.restore` ever reaches this page; the
 * page itself re-checks, and the database trigger checks again.
 */
export function TicketTrash({
  tickets,
  shops,
  restoreAction,
}: {
  tickets: TicketListRow[];
  shops: Shop[];
  restoreAction: (ticketId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? id;

  function restore(t: TicketListRow) {
    if (!window.confirm(`กู้คืนใบงาน #${t.id} ของ ${t.customer || 'ลูกค้า'}?`)) return;
    setError(null);
    setBusyId(t.id);
    startTransition(async () => {
      const res = await restoreAction(t.id);
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
          <h1 className="text-xl font-bold">ถังขยะใบงาน</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
            ใบงานที่ถูกลบ ยังไม่ถูกทำลาย กู้คืนกลับไปที่รายการได้
          </p>
        </div>
        <Link
          href="/tickets"
          className="btn-outline text-sm px-4 py-2 rounded-xl font-medium flex items-center gap-2"
        >
          <i className="fa-solid fa-arrow-left"></i>กลับไปรายการใบงาน
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
        {tickets.length === 0 && (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--ink-faint)' }}>
            ถังขยะว่าง — ยังไม่มีใบงานที่ถูกลบ
          </p>
        )}
        {tickets.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-3 py-3 flex-wrap"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                #{t.id} &middot; {t.customer}
                {t.plate ? ` (${t.plate})` : ''}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                {shopName(t.shop)} &middot; รับงาน {fmtThaiDate(t.dropOffDateObj)} &middot; ยอด{' '}
                {fmt(ticketTotal(t))}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                ลบเมื่อ {fmtThaiDate(t.deletedAt)}
                {t.deletedByName ? ` โดย ${t.deletedByName}` : ''}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Link
                href={`/tickets/${t.id}`}
                className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
              >
                ดูใบงาน
              </Link>
              <button
                onClick={() => restore(t)}
                disabled={pending && busyId === t.id}
                className="btn-primary text-xs px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5"
                style={{ opacity: pending && busyId === t.id ? 0.7 : 1 }}
              >
                <i
                  className={`fa-solid ${
                    pending && busyId === t.id ? 'fa-spinner fa-spin' : 'fa-rotate-left'
                  }`}
                ></i>
                กู้คืน
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
