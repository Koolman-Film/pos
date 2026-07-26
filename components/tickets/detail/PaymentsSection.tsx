'use client';

import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { fmt } from '@/lib/domain/format';

import type { Ticket, TicketPayment } from '../types';

/** การชำระเงิน. Ported from reference/v0.4/finnix-film.html:1861-1894. */
export function PaymentsSection({
  t,
  paymentMethods,
  setPaymentMethods,
  addPayment,
  updatePayment,
  total,
  paid,
}: {
  t: Ticket;
  paymentMethods: string[];
  setPaymentMethods: (v: string[]) => void;
  addPayment: () => void;
  updatePayment: (idx: number, key: keyof TicketPayment, val: unknown) => void;
  total: number;
  paid: number;
}) {
  return (
    <div className="pt-5 mb-5" style={{ borderTop: '1px solid var(--line)' }}>
      <p
        className="text-xs font-medium mb-3 flex items-center gap-1.5"
        style={{ color: 'var(--ink-soft)' }}
      >
        <i className="fa-solid fa-money-bill-wave"></i>การชำระเงิน
      </p>
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
              <ManagedDropdown
                value={p.method}
                onChange={(v) => updatePayment(idx, 'method', v)}
                options={paymentMethods}
                setOptions={setPaymentMethods}
                placeholder="เลือกวิธีชำระ..."
              />
            </div>
            <input
              type="number"
              placeholder="จำนวนเงิน"
              value={p.amount}
              onChange={(e) => updatePayment(idx, 'amount', e.target.value)}
              className="field text-xs px-2.5 py-1.5 w-24"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs flex items-center gap-1.5 flex-1 field px-2.5 py-1.5 cursor-pointer"
              style={{ color: 'var(--ink-soft)' }}
            >
              <i className="fa-solid fa-paperclip"></i>
              แนบสลิปโอนเงิน (เลือกได้หลายไฟล์)...
              <input
                type="file"
                accept="image/*,.pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length)
                    updatePayment(idx, 'attachments', [
                      ...(p.attachments || []),
                      ...files.map((f) => f.name),
                    ]);
                  e.target.value = '';
                }}
              />
            </label>
            {(p.attachments || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {p.attachments!.map((fn, fi) => (
                  <span
                    key={fi}
                    className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
                    style={{ background: 'var(--paper)', color: '#4C7A3E' }}
                  >
                    <i className="fa-solid fa-circle-check"></i>
                    {fn}
                    <i
                      className="fa-solid fa-xmark cursor-pointer"
                      style={{ color: '#B23A48' }}
                      onClick={() =>
                        updatePayment(
                          idx,
                          'attachments',
                          p.attachments!.filter((_, fi2) => fi2 !== fi),
                        )
                      }
                    ></i>
                  </span>
                ))}
              </div>
            )}
          </div>
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
