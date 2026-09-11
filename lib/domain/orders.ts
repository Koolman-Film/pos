// Ported behavior-for-behavior from reference/v0.4/finnix-film.html:331-337.
// Returns are priced off the first order item whose `name` matches `return.item`.

export type OrderItem = { name: string; qty: number; requestedPrice: number };
export type OrderReturn = { item: string; qty: number };
/**
 * สถานะการอนุมัติของรายการปรับราคา (migration 0050).
 *
 * A price adjustment gives away the same money a below-standard price does,
 * and that one has always needed ผู้บริหาร. This one is arguably the looser of
 * the two — it is written AFTER the goods have gone out and the invoice has
 * been raised, which is when the shop has least leverage.
 */
export const ADJUSTMENT_APPROVED = 'อนุมัติแล้ว';
export const ADJUSTMENT_PENDING = 'รออนุมัติ';
export const ADJUSTMENT_REJECTED = 'ปฏิเสธ';

export type OrderAdjustment = { amount: number; status?: string };

/**
 * A row with no status at all counts, for the same reason payments do: every
 * adjustment written before 0050 had already been subtracted from figures the
 * shop has read and reconciled, and the migration backfills them to
 * `อนุมัติแล้ว`. Defaulting the other way would silently re-open settled bills.
 */
export function isApprovedAdjustment(a: { status?: string }): boolean {
  return !a.status || a.status === ADJUSTMENT_APPROVED;
}
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
  // เฉพาะที่อนุมัติแล้ว: an adjustment waiting on ผู้บริหาร must not have
  // reduced the bill already, or the approval is decoration and the money is
  // gone before anybody agreed to it.
  const adjustmentsTotal = (o.adjustments || []).reduce(
    (s, a) => s + (isApprovedAdjustment(a) ? Number(a.amount || 0) : 0),
    0,
  );
  return itemsTotal - returnsTotal - adjustmentsTotal;
}

/**
 * PO ใบนี้มีอะไรรอผู้บริหารอนุมัติอยู่ไหม.
 *
 * Two different things reach the same person: a price offered below the
 * standard one (which holds the PO in `รออนุมัติราคา`), and a reduction
 * written after the goods went out (which does not, because by then the PO is
 * จัดส่งแล้ว and saying otherwise would be a lie about shipped goods).
 *
 * Lives here because the dashboard COUNTS these and the ขายส่ง list FILTERS to
 * them. A counter that said 3 next to a list that showed 5 would be worse than
 * having neither.
 */
export function needsPriceApproval(o: {
  status: string;
  items: { listPrice: number; requestedPrice: number }[];
  adjustments?: { status?: string }[];
}): boolean {
  const discountWaiting =
    o.status === 'รออนุมัติราคา' && o.items.some((i) => i.requestedPrice < i.listPrice);
  const adjustmentWaiting = (o.adjustments ?? []).some((a) => a.status === ADJUSTMENT_PENDING);
  return discountWaiting || adjustmentWaiting;
}

/** ยอดปรับราคาที่ยังรอผู้บริหารอนุมัติ — shown beside the bill, never inside it. */
export function orderPendingAdjustments(o: { adjustments?: OrderAdjustment[] }): number {
  return (o.adjustments || []).reduce(
    (s, a) => s + (a.status === ADJUSTMENT_PENDING ? Number(a.amount || 0) : 0),
    0,
  );
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
