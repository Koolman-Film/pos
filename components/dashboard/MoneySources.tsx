'use client';

import { fmt, shortShopName } from '@/lib/domain/format';

import type { MoneyOverview } from './moneyFlow';

/**
 * เงินอยู่ที่ไหนบ้าง — สาขา แล้วแหล่งเงิน แล้วจำนวน.
 *
 * Rendered inside the card that used to show เงินสดย่อยคงเหลือ alone. The shape
 * the shop asked for is a list, not a chart: they read these to the baht, and
 * the register exists so the figures can be reconciled against the real drawer
 * and the real bank statement.
 *
 * Every number here is a balance (see `moneyFlow.ts`), so the branch total is a
 * real figure and may be shown — which was not true of the movement version this
 * replaced, where adding the rows up would have counted banked cash twice.
 */
const KIND_ICON: Record<string, string> = {
  bank: 'fa-building-columns',
  cash: 'fa-money-bill-wave',
  petty: 'fa-wallet',
  credit: 'fa-credit-card',
};

export function MoneySources({ data }: { data: MoneyOverview }) {
  const { branches } = data;
  if (branches.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--primary)', opacity: 0.7 }}>
        ยังไม่ได้ตั้งค่าแหล่งเงินของสาขา
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/*
        เงินทั้งหมด first, because it is the question the card is opened with.
        Filtered to one branch it repeats that branch’s total, and the
        repetition costs less than a headline figure that does not move when
        the filter does.
      */}
      <div
        className="flex items-baseline justify-between gap-2 pb-2"
        style={{ color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,.45)' }}
      >
        <span className="text-xs" style={{ opacity: 0.85 }}>
          เงินทั้งหมด
        </span>
        <span className="text-lg font-extrabold">{fmt(data.total)}</span>
      </div>
      {/*
        ยอดนี้ยังไม่ครบ.

        A movement whose แหล่งเงิน label no account claims lands in no balance
        at all — the expense saves and the list shows it, but the money is
        missing from every figure above. A total that is quietly short is the
        worst thing this card can show, so it says so rather than being read
        as correct. The fix lives on /money, which is why the line points
        there instead of trying to explain itself here.
      */}
      {data.hasUnmatched && (
        <p
          className="text-xs px-2 py-1.5 rounded-lg"
          style={{ color: '#8A5A12', background: 'rgba(255,255,255,.55)' }}
        >
          <i className="fa-solid fa-link-slash mr-1.5"></i>
          มีรายการที่ยังไม่ได้ผูกกับแหล่งเงิน ยอดข้างบนจึงยังไม่ครบ — ดูและแก้ได้ที่
          การจัดการเงิน/บัญชี
        </p>
      )}
      {branches.map((b, i) => (
        /*
          Each branch is a block with a rule above it and its own tinted
          heading. Five branches of four accounts is twenty near-identical rows,
          and with only whitespace between them the eye loses which total belongs
          to which shop — the rule is what makes the grouping readable at a
          glance rather than something to be counted out.
        */
        <div
          key={b.shop}
          style={
            i === 0 ? undefined : { borderTop: '1px solid rgba(255,255,255,.5)', paddingTop: 10 }
          }
        >
          <div
            className="flex items-baseline justify-between gap-2 mb-1.5 px-2 py-1 rounded-lg"
            style={{ color: 'var(--primary)', background: 'rgba(255,255,255,.55)' }}
          >
            <p className="text-xs font-bold">{shortShopName(b.name)}</p>
            <p className="text-xs font-bold">{fmt(b.total)}</p>
          </div>
          <div className="flex flex-col gap-1">
            {b.accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-baseline justify-between gap-2 text-xs"
                style={{ color: 'var(--primary)' }}
              >
                <span className="min-w-0" style={{ opacity: 0.85 }}>
                  <i
                    className={`fa-solid ${KIND_ICON[a.kind] ?? 'fa-sack-dollar'} mr-1.5`}
                    style={{ opacity: 0.7 }}
                  ></i>
                  {a.name}
                  {/* The account number is what makes a bank row identifiable at
                      a glance when a branch keeps two accounts at one bank. */}
                  {a.accountNo && <span style={{ opacity: 0.6 }}> · {a.accountNo}</span>}
                </span>
                <span className="font-semibold flex-shrink-0">{fmt(a.balance)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
