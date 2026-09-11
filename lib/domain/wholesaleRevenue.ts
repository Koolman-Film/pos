/**
 * รายได้จากการขายส่ง — วันไหนนับเป็นยอดขาย และเท่าไหร่.
 *
 * Wholesale earns its money on a different day from retail, and the difference
 * is not a detail: the shop delivers first and is paid weeks later, so the day
 * the PO was raised, the day the goods went out and the day the cheque cleared
 * routinely fall in three different months. Only one of them is when the sale
 * happened, and that is **วันส่งของ** (`orders.delivered_at`, migration 0045).
 *
 * A PO with no delivery date has earned nothing yet and produces no lines at
 * all — not a zero, not a line dated today.
 *
 * การคืนสินค้าและการปรับราคาเป็นบรรทัดของตัวเอง ติดลบ ลงวันที่ของมันเอง. A March
 * sale returned in May must reduce May: reaching back to change a month that
 * has already been reported and reconciled is how a report loses its readers.
 *
 * This lives in `lib/domain` rather than in either screen because BOTH the
 * รายได้ module and the dashboard count wholesale takings, and the one thing
 * that must never happen is two screens on the same system quoting different
 * numbers for the same month.
 */

import { isApprovedAdjustment } from './orders';

export type WholesaleRevenueOrder = {
  id: string;
  shop: string;
  /** `orders.delivered_at`, `YYYY-MM-DD`. Empty or null = not delivered yet. */
  deliveredAt: string | null;
  items: { name: string; qty: number; requestedPrice: number }[];
  returns: { item: string; qty: number; date: string | null }[];
  adjustments: {
    amount: number;
    reason: string;
    date: string | null;
    /** เฉพาะ `อนุมัติแล้ว` ที่ลดยอดขาย (migration 0050). */
    status?: string;
  }[];
};

/** ขาย = the goods going out; the other two reduce it, later and separately. */
export type WholesaleLineKind = 'ขาย' | 'คืนสินค้า' | 'ปรับราคา';

export type WholesaleRevenueLine = {
  orderId: string;
  shop: string;
  /** วันที่ที่บรรทัดนี้เป็นของ — `YYYY-MM-DD`. */
  on: string;
  kind: WholesaleLineKind;
  /** ชื่อสินค้า, or the reason on a price adjustment. */
  item: string;
  /** Negative on คืนสินค้า and ปรับราคา, so a plain sum is the net takings. */
  amount: number;
};

export function wholesaleRevenueLines(orders: WholesaleRevenueOrder[]): WholesaleRevenueLine[] {
  const lines: WholesaleRevenueLine[] = [];

  for (const o of orders) {
    const deliveredAt = (o.deliveredAt ?? '').slice(0, 10);
    if (!deliveredAt) continue;
    const base = { orderId: o.id, shop: o.shop };

    for (const it of o.items) {
      if (!it.name) continue;
      const amount = Number(it.qty || 0) * Number(it.requestedPrice || 0);
      if (!amount) continue;
      lines.push({ ...base, on: deliveredAt, kind: 'ขาย', item: it.name, amount });
    }

    // Priced off the line it came back from, exactly as `orderTotal` does — a
    // return is a reversal of a specific sale, not a fresh valuation.
    const priceOf = (name: string) =>
      Number(o.items.find((i) => i.name === name)?.requestedPrice || 0);
    for (const r of o.returns) {
      const amount = Number(r.qty || 0) * priceOf(r.item);
      if (!amount) continue;
      lines.push({
        ...base,
        // Falls back to the delivery date only when the row predates the column
        // (migration 0045); nothing is ever left undated.
        on: (r.date || deliveredAt).slice(0, 10),
        kind: 'คืนสินค้า',
        item: r.item,
        amount: -amount,
      });
    }

    for (const a of o.adjustments) {
      // An adjustment still waiting on ผู้บริหาร has not reduced the bill, so
      // it has not reduced the takings either — the two must not disagree.
      if (!isApprovedAdjustment(a)) continue;
      const amount = Number(a.amount || 0);
      if (!amount) continue;
      lines.push({
        ...base,
        on: (a.date || deliveredAt).slice(0, 10),
        kind: 'ปรับราคา',
        item: a.reason || 'ปรับราคาหลังส่งของ',
        // A positive adjustment means the bill went DOWN, which is how the PO
        // screen words it ("ใส่ตัวเลขบวกเพื่อลดยอดเรียกเก็บ"), so it subtracts.
        amount: -amount,
      });
    }
  }

  return lines;
}
