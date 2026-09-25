'use client';

import { ThaiDateInput } from '@/components/ui/ThaiDateInput';
import { fmt } from '@/lib/domain/format';
import { itemNetPrice } from '@/lib/domain/tickets';
import { LEGACY_METHOD_SUFFIX, type PayAccount } from '@/lib/domain/payAccount';
import { matchFinnixMoney } from '@/lib/domain/finnixMatch';

import { AttachmentField } from './AttachmentField';

import type { Ticket, TicketPayment } from '../types';

/** การชำระเงิน. Ported from reference/v0.4/finnix-film.html:1861-1894. */
export function PaymentsSection({
  t,
  shop,
  paymentMethods,
  payAccounts = [],
  attachmentUrlAction,
  addPayment,
  removePayment,
  updatePayment,
  setRevenueKind,
  total,
  paid,
}: {
  t: Ticket;
  /** Bucket folder for uploads — the ticket's shop. */
  shop: string;
  /** Mints a signed URL so a stored slip can be previewed. */
  attachmentUrlAction?: (path: string) => Promise<{ url?: string; error?: string }>;
  /** The branch's แหล่งเงิน by name — the payment lands in the account picked (0064). */
  paymentMethods: string[];
  /** The branch's แหล่งเงิน, each saying whose money it holds (0069). */
  payAccounts?: PayAccount[];
  addPayment: () => void;
  /** Drops the row entirely — see `removePayment` in TicketDetail for why. */
  removePayment?: (idx: number) => void;
  updatePayment: (idx: number, key: keyof TicketPayment, val: unknown) => void;
  /** Sets every line to รายได้ / รับแทน at once (0031, per-line since 0068). */
  setRevenueKind: (kind: 'รายได้' | 'รับแทน') => void;
  total: number;
  paid: number;
}) {
  /*
    เงินก้อนนี้เป็นของใคร — สรุปจากรายการสินค้า (0068).

    0031 asked this once for the whole job. One job sells several ชนิดสินค้า and
    only some may belong to another branch (ร้านแจ้ง 25 ก.ย. 2569), so the answer
    lives on each line now and this block reports what the lines add up to. The
    two buttons stay because a wholly-held job is still the common case and
    ticking five lines for it would be a step backwards — they set every line.
  */
  const priced = (t.items ?? []).filter((i) => Number(i.soldPrice || 0) > 0);
  const moneyOf = (i: (typeof priced)[number]) =>
    itemNetPrice({
      soldPrice: Number(i.soldPrice || 0),
      discountType: i.discountType ?? undefined,
      discountValue: i.discountValue != null ? Number(i.discountValue) : undefined,
    });
  const heldTotal = priced
    .filter((i) => i.revenueKind === 'รับแทน')
    .reduce((n, i) => n + moneyOf(i), 0);
  const ownTotal = priced
    .filter((i) => i.revenueKind !== 'รับแทน')
    .reduce((n, i) => n + moneyOf(i), 0);
  const ticketHeld = t.revenueKind === 'รับแทน';
  // Nothing priced yet: the job's own answer is all there is, and it is what
  // the lines will inherit.
  const allHeld = priced.length > 0 ? ownTotal === 0 : ticketHeld;
  const allOwn = priced.length > 0 ? heldTotal === 0 : !ticketHeld;
  const mixed = !allHeld && !allOwn;
  const held = allHeld;

  // เทียบสิ่งที่ขาย กับบัญชีที่เงินเข้าจริง (0069).
  const match = matchFinnixMoney({
    items: t.items ?? [],
    payments: (t.payments ?? []).map((p) => ({ amount: p.amount, method: p.method })),
    accounts: payAccounts,
    shop: t.shop,
    ticketCreatedAt: t.createdAt,
  });

  // The heading lives in the FormSection wrapper — see detail/FormSection.tsx.
  return (
    <div>
      {/*
        Shown here, at the top of the money, because it is what decides what
        every figure downstream means. Set per line in ส่วนที่ 2; these two
        buttons answer for all of them at once.
      */}
      <div
        className="rounded-xl p-3 mb-3"
        style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}
      >
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--ink-soft)' }}>
          เงินจากใบงานนี้
        </p>
        <div className="flex gap-2">
          {(
            [
              ['รายได้', 'รายได้ของสาขา', 'fa-store'],
              ['รับแทน', 'รายได้ Finnix', 'fa-hand-holding-dollar'],
            ] as const
          ).map(([kind, label, icon]) => {
            // Neither is "on" while the lines disagree — pressing one then
            // means "make the whole job this", which is what it does.
            const on = !mixed && held === (kind === 'รับแทน');
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setRevenueKind(kind)}
                aria-pressed={on}
                className={`text-xs px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5 flex-1 justify-center ${
                  on ? 'btn-primary' : 'btn-outline'
                }`}
              >
                <i className={`fa-solid ${icon}`}></i>
                {label}
              </button>
            );
          })}
        </div>
        <p
          className="text-xs mt-2"
          style={{ color: mixed || held ? '#8A5A12' : 'var(--ink-faint)' }}
        >
          {mixed ? (
            <>
              <i className="fa-solid fa-layer-group mr-1"></i>
              ใบงานนี้แยกกัน — รายได้สาขา {fmt(ownTotal)} · รายได้ Finnix {fmt(heldTotal)}{' '}
              (ตั้งได้ทีละ รายการในหัวข้อ 2 · เงินที่รับมาจะถูกแบ่งตามสัดส่วนนี้)
            </>
          ) : held ? (
            'ยอดนี้ไม่นับเป็นยอดขายของสาขา แต่จะขึ้นเป็น รายได้ Finnix ในรายงานรายได้'
          ) : (
            'นับรวมเป็นยอดขายของสาขาตามปกติ'
          )}
        </p>
      </div>
      {/*
        จับคู่รายได้ Finnix กับบัญชีที่รับเงินจริง (0069).

        Shown only when the job has Finnix money on it and the customer has
        finished paying: before that the two sides cannot agree, and saying so
        on every deposit would be noise nobody reads.
      */}
      {match.inScope && match.soldFinnix > 0 && match.settled && match.owedToFinnix !== 0 && (
        <div
          className="rounded-xl p-3 mb-3 text-xs"
          style={{ background: '#FBF1DA', color: '#8A5A12' }}
        >
          <p className="font-semibold">
            <i className="fa-solid fa-right-left mr-1.5"></i>
            เงินเข้าบัญชีไม่ตรงกับที่ขาย
          </p>
          <p className="mt-1">
            ขายจริง — สาขา {fmt(match.soldOwn)} · Finnix {fmt(match.soldFinnix)}
            <br />
            เงินเข้า — บัญชีสาขา {fmt(match.paidOwn)} · บัญชี Finnix {fmt(match.paidFinnix)}
            {match.paidUnknown > 0 ? ` · ยังไม่รู้บัญชี ${fmt(match.paidUnknown)}` : ''}
          </p>
          <p className="mt-1 font-semibold">
            {match.owedToFinnix > 0
              ? `ต้องโอนคืน Finnix อีก ${fmt(match.owedToFinnix)}`
              : `Finnix รับไว้เกิน ${fmt(-match.owedToFinnix)} — ต้องโอนกลับสาขา`}
          </p>
          <p className="mt-1" style={{ color: 'var(--ink-faint)' }}>
            ยอดขายของสาขายึดตามสินค้าที่ขาย ไม่ขยับตามบัญชีที่เงินเข้า
          </p>
        </div>
      )}
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
                The branch's แหล่งเงิน (0064) — the account the money goes into,
                managed in การจัดการเงิน/บัญชี; Book งาน is not the place to
                invent new ones. A method saved before, or on an account since
                closed, stays selectable so an old ticket still reads correctly.
              */}
              <select
                value={p.method}
                aria-label={`วิธีชำระเงินรายการที่ ${idx + 1}`}
                onChange={(e) => updatePayment(idx, 'method', e.target.value)}
                className="field w-full text-xs px-2.5 py-1.5"
              >
                <option value="" disabled>
                  เลือกแหล่งเงินที่เงินเข้า...
                </option>
                {(p.method && !paymentMethods.includes(p.method)
                  ? [p.method, ...paymentMethods]
                  : paymentMethods
                ).map((m) => (
                  <option key={m} value={m}>
                    {paymentMethods.includes(m) ? m : m + LEGACY_METHOD_SUFFIX}
                  </option>
                ))}
              </select>
              {paymentMethods.length === 0 && (
                <p className="text-xs mt-1" style={{ color: '#B23A48' }}>
                  สาขานี้ยังไม่มีแหล่งเงินให้เลือก — เพิ่มได้ที่ การจัดการเงิน/บัญชี
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
            วันที่รับเงิน. ยอดขาย and สมุดบัญชีแหล่งเงิน both count money on this
            day, and until migration 0060 the row had no date field: whatever
            day the payment was typed in became the day the money arrived. A
            transfer that came in on Friday evening and was entered on Monday
            landed on Monday, in the wrong month at a month end, and there was
            no way to correct it from anywhere in the app.
          */}
          <div className="mb-2">
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              วันที่รับเงิน
            </label>
            <ThaiDateInput
              value={p.date || ''}
              ariaLabel={`วันที่รับเงินรายการที่ ${idx + 1}`}
              onChange={(v) => updatePayment(idx, 'date', v)}
              className="field text-xs px-2.5 py-1.5 w-full"
            />
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
