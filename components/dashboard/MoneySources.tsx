'use client';

import { fmt } from '@/lib/domain/format';

import type { BranchMoney } from './moneyFlow';

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

export function MoneySources({ branches }: { branches: BranchMoney[] }) {
  if (branches.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--primary)', opacity: 0.7 }}>
        ยังไม่ได้ตั้งค่าแหล่งเงินของสาขา
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {branches.map((b) => (
        <div key={b.shop}>
          <div
            className="flex items-baseline justify-between gap-2 mb-1"
            style={{ color: 'var(--primary)' }}
          >
            <p className="text-xs font-semibold" style={{ opacity: 0.9 }}>
              {b.name}
            </p>
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
