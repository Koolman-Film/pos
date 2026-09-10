// Ported behavior-for-behavior from reference/v0.4/finnix-film.html:331-337.
// Returns are priced off the first order item whose `name` matches `return.item`.

export type OrderItem = { name: string; qty: number; requestedPrice: number };
export type OrderReturn = { item: string; qty: number };
export type OrderAdjustment = { amount: number };
/**
 * สถานะการรับเงิน (migration 0048).
 *
 * `แจ้งแล้ว` is a payment somebody REPORTED — most often a post-dated cheque
 * sitting in the drawer. It is not money, and nothing that counts money may
 * count it. `เด้ง` is a cheque that failed; the debt it appeared to settle
 * comes back on its own precisely because these functions ignore it.
 */
export const PAYMENT_RECEIVED = 'รับเงินแล้ว';
export const PAYMENT_REPORTED = 'แจ้งแล้ว';
export const PAYMENT_BOUNCED = 'เด้ง';

export type OrderPayment = { amount: number; status?: string };

/**
 * A payment with no status at all is money.
 *
 * Every payment recorded before 0048 existed was treated as received the
 * moment it was typed, and the migration backfills them to `รับเงินแล้ว` for
 * that reason. Retail (`ticket_payments`) has no cheque lifecycle and never
 * sets the field. Defaulting the other way would silently re-open every
 * settled debt in the shop.
 */
export function isReceived(p: { status?: string }): boolean {
  return !p.status || p.status === PAYMENT_RECEIVED;
}
export type OrderForTotals = {
  items: OrderItem[];
  returns: OrderReturn[];
  adjustments: OrderAdjustment[];
};

export function orderTotal(o: OrderForTotals): number {
  const itemsTotal = o.items.reduce((s, i) => s + i.qty * i.requestedPrice, 0);
  const returnsTotal = o.returns.reduce((s, r) => {
    const it = o.items.find((i) => i.name === r.item);
    return s + (it ? r.qty * it.requestedPrice : 0);
  }, 0);
  const adjustmentsTotal = (o.adjustments || []).reduce((s, a) => s + Number(a.amount || 0), 0);
  return itemsTotal - returnsTotal - adjustmentsTotal;
}

/** ยอดที่รับเงินแล้วจริง — what clears the debt. */
export function orderPaid(o: { payments: OrderPayment[] }): number {
  return o.payments.reduce((s, p) => s + (isReceived(p) ? Number(p.amount || 0) : 0), 0);
}

/**
 * ยอดที่แจ้งแล้วแต่ยังไม่ยืนยัน — shown beside the balance, never inside it.
 *
 * The shop needs to see it: a customer who has handed over a cheque for the
 * full amount is in a different position from one who has sent nothing, even
 * though both still owe the money.
 */
export function orderReported(o: { payments: OrderPayment[] }): number {
  return o.payments.reduce(
    (s, p) => s + (p.status === PAYMENT_REPORTED ? Number(p.amount || 0) : 0),
    0,
  );
}
