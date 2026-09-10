import { PAYMENT_REPORTED } from '@/lib/domain/orders';

import type { WsOrder } from './types';

/**
 * เงินที่แจ้งแล้วแต่ยังไม่ยืนยัน — ส่วนใหญ่คือเช็คลงวันที่ล่วงหน้า.
 *
 * Wholesale is paid mostly by post-dated cheque, so the shop is always holding
 * paper that is not yet money. Once the date on the face of each cheque is
 * recorded (migration 0048) two questions become answerable, and both of them
 * matter more than the totals they are made of:
 *
 *   - เดือนหน้าจะมีเงินเข้าเท่าไหร่ — what is coming, and when.
 *   - ใบไหนเลยกำหนดแล้วยังไม่ยืนยัน — which cheque somebody has to chase.
 *
 * The second is the reason this exists. A cheque that came due last week and
 * was never confirmed is either money nobody banked or a cheque that bounced
 * without anyone recording it; either way it is invisible in every other view,
 * because a payment that is not counted simply leaves the customer looking
 * like a slow payer.
 */
export type PendingCheque = {
  orderId: string;
  shop: string;
  customerId: number | null;
  amount: number;
  method: string;
  chequeNo: string;
  chequeBank: string;
  /**
   * วันที่ที่คาดว่าเงินจะเข้า — the date on the cheque, or the date the payment
   * was taken in when there is no cheque behind it (cash a sale has reported
   * but nobody has counted yet).
   */
  due: string;
  /** เลยกำหนดแล้วแต่ยังไม่ยืนยัน — the row that needs chasing. */
  overdue: boolean;
};

export type PendingChequeSummary = {
  rows: PendingCheque[];
  total: number;
  overdueTotal: number;
};

/**
 * `today` is passed in rather than read from the clock so the caller pins the
 * timezone once (`todayValue()`, Asia/Bangkok) instead of this module guessing.
 * Both dates are `YYYY-MM-DD`, which compares correctly as a string.
 */
export function pendingCheques(orders: WsOrder[], today: string): PendingChequeSummary {
  const rows: PendingCheque[] = [];
  for (const o of orders) {
    for (const p of o.payments) {
      if (p.status !== PAYMENT_REPORTED) continue;
      const amount = Number(p.amount || 0);
      if (amount <= 0) continue;
      const due = p.chequeDate || p.date || '';
      rows.push({
        orderId: o.id,
        shop: o.shop,
        customerId: o.customerId,
        amount,
        method: p.method,
        chequeNo: p.chequeNo ?? '',
        chequeBank: p.chequeBank ?? '',
        due,
        // A row with no date at all is not overdue — it is undated, and calling
        // it late would send somebody chasing a cheque that may not be due yet.
        overdue: !!due && due < today,
      });
    }
  }
  // Earliest first, which puts everything overdue at the top on its own. Undated
  // rows sort last: they carry no claim about when the money is expected.
  rows.sort((a, b) => (a.due || '9999-12-31').localeCompare(b.due || '9999-12-31'));
  return {
    rows,
    total: rows.reduce((n, r) => n + r.amount, 0),
    overdueTotal: rows.reduce((n, r) => n + (r.overdue ? r.amount : 0), 0),
  };
}
