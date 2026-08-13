'use client';

import { fmt } from '@/lib/domain/format';

import { AttachmentField } from './AttachmentField';

import type { Ticket, TicketPayment } from '../types';

/** การชำระเงิน. Ported from reference/v0.4/finnix-film.html:1861-1894. */
export function PaymentsSection({
  t,
  shop,
  paymentMethods,
  attachmentUrlAction,
  addPayment,
  removePayment,
  updatePayment,
  total,
  paid,
}: {
  t: Ticket;
  /** Bucket folder for uploads — the ticket's shop. */
  shop: string;
  /** Mints a signed URL so a stored slip can be previewed. */
  attachmentUrlAction?: (path: string) => Promise<{ url?: string; error?: string }>;
  /** The shop's ช่องทางการชำระเงิน from จัดการสิทธิ์ (falls back to the global list). */
  paymentMethods: string[];
  addPayment: () => void;
  /** Drops the row entirely — see `removePayment` in TicketDetail for why. */
  removePayment?: (idx: number) => void;
  updatePayment: (idx: number, key: keyof TicketPayment, val: unknown) => void;
  total: number;
  paid: number;
}) {
  // The heading lives in the FormSection wrapper — see detail/FormSection.tsx.
  return (
    <div>
      {t.payments.map((p, idx) => (
        <div
          key={idx}
          className="rounded-xl p-2.5 mb-2.5"
          style={{ border: '1px solid var(--line)' }}
        >
          <div className="flex gap-2 mb-2">
            <select
              value={p.type}
              aria-label="ประเภทการชำระเงิน"
              onChange={(e) => updatePayment(idx, 'type', e.target.value)}
              className="field text-xs px-2.5 py-1.5"
            >
              <option>มัดจำ</option>
              <option>ชำระส่วนที่เหลือ</option>
              <option>ชำระเต็มจำนวน</option>
            </select>
            <div className="flex-1">
              {/*
                A plain select, not a ManagedDropdown: the channels are set per
                shop in จัดการสิทธิ์ → ข้อมูลนิติบุคคลของสาขา, and Book งาน is not
                the place to invent new ones. A method already saved on this
                payment stays selectable even if it has since been removed from
                the shop's list, so an old ticket still reads correctly.
              */}
              <select
                value={p.method}
                aria-label={`วิธีชำระเงินรายการที่ ${idx + 1}`}
                onChange={(e) => updatePayment(idx, 'method', e.target.value)}
                className="field w-full text-xs px-2.5 py-1.5"
              >
                <option value="" disabled>
                  เลือกวิธีชำระ...
                </option>
                {(p.method && !paymentMethods.includes(p.method)
                  ? [p.method, ...paymentMethods]
                  : paymentMethods
                ).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {paymentMethods.length === 0 && (
                <p className="text-xs mt-1" style={{ color: '#B23A48' }}>
                  ยังไม่ได้ตั้งช่องทางการชำระเงินของสาขานี้ — ตั้งได้ที่ จัดการสิทธิ์ &rarr;
                  ข้อมูลนิติบุคคลของสาขา
                </p>
              )}
            </div>
            <input
              type="number"
              placeholder="จำนวนเงิน"
              value={p.amount}
              onChange={(e) => updatePayment(idx, 'amount', e.target.value)}
              className="field text-xs px-2.5 py-1.5 w-24"
            />
            {removePayment && (
              <button
                onClick={() => {
                  // Only confirm once there is something to lose; an empty row
                  // added by mistake should go away on the first click.
                  const hasData = Number(p.amount || 0) > 0 || (p.attachments?.length ?? 0) > 0;
                  if (hasData && !window.confirm('ลบรายการรับเงินนี้ออกจากใบงาน?')) return;
                  removePayment(idx);
                }}
                aria-label={`ลบรายการรับเงินที่ ${idx + 1}`}
                title="ลบรายการรับเงินนี้"
                className="text-xs px-2 rounded-lg"
                style={{ color: '#B23A48' }}
              >
                <i className="fa-solid fa-trash"></i>
              </button>
            )}
          </div>
          {/*
            The slip is the shop's proof the transfer arrived, so it is a real
            file now (migration 0018) rather than a filename that the save threw
            away — `ticket_payments` had no column for it at all.
          */}
          <AttachmentField
            label="แนบสลิปโอนเงิน (เลือกได้หลายไฟล์)..."
            paths={p.attachments ?? []}
            onChange={(next) => updatePayment(idx, 'attachments', next)}
            folder={shop}
            urlAction={attachmentUrlAction}
          />
        </div>
      ))}
      <button
        onClick={addPayment}
        className="btn-outline w-full text-sm rounded-2xl py-2.5 flex items-center justify-center gap-2 font-medium"
      >
        <i className="fa-solid fa-plus"></i>เพิ่มรายการรับเงิน
      </button>
      <div
        className="flex justify-between text-sm mt-4 pt-3"
        style={{ borderTop: '1px solid var(--line)' }}
      >
        <span style={{ color: 'var(--ink-soft)' }}>
          ยอดสุทธิ {fmt(total)} &middot; ชำระแล้ว {fmt(paid)}
        </span>
        <span
          className="font-semibold"
          style={{ color: total - paid <= 0 ? '#4C7A3E' : '#B23A48' }}
        >
          {total - paid <= 0 ? 'ชำระครบแล้ว' : `คงเหลือ ${fmt(total - paid)}`}
        </span>
      </div>
    </div>
  );
}
