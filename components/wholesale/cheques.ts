import { summarisePendingCheques } from '@/lib/domain/cheques';
import { PAYMENT_REPORTED } from '@/lib/domain/orders';

import type { WsOrder } from './types';

/**
 * เงินที่แจ้งแล้วแต่ยังไม่ยืนยัน ของ PO ที่หน้าจอถืออยู่ — ส่วนใหญ่คือเช็ค
 * ลงวันที่ล่วงหน้า
 *
 * กฎว่าใบไหนเลยกำหนด และเรียงอย่างไร อยู่ที่ `lib/domain/cheques.ts` ที่เดียว
 * เพราะหน้า การจัดการเงิน/บัญชี ถามคำถามเดียวกันนี้จากตารางดิบ ไม่ได้ถามจาก
 * `WsOrder` ที่หน้ารายการ PO ถืออยู่ ไฟล์นี้จึงเหลือหน้าที่เดียว: แปลงรูป
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
  const rows = [];
  for (const o of orders) {
    for (const p of o.payments) {
      if (p.status !== PAYMENT_REPORTED) continue;
      const amount = Number(p.amount || 0);
      if (amount <= 0) continue;
      rows.push({
        orderId: o.id,
        shop: o.shop,
        customerId: o.customerId,
        amount,
        method: p.method,
        chequeNo: p.chequeNo ?? '',
        chequeBank: p.chequeBank ?? '',
        due: p.chequeDate || p.date || '',
      });
    }
  }
  const out = summarisePendingCheques(rows, today);
  return { rows: out.rows, total: out.total, overdueTotal: out.overdueTotal };
}
