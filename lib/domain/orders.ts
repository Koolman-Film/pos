// Ported behavior-for-behavior from reference/v0.4/finnix-film.html:331-337.

import { deliveredValue, type DeliveryRound } from './deliveries';

export type OrderItem = {
  name: string;
  qty: number;
  requestedPrice: number;
  /** คีย์ประจำรายการ (migration 0077) — รอบส่งของชี้มาที่คีย์นี้. */
  uid?: string;
};
export type OrderReturn = {
  item: string;
  qty: number;
  /**
   * บรรทัดของ `items` ที่ของชิ้นนี้ถูกคืนกลับมา (migration 0080).
   *
   * เดิมคิดราคาของที่คืนจาก "บรรทัดแรกที่ชื่อตรงกัน" ซึ่งคืนเงินผิดราคาเสมอเมื่อ
   * PO ใบเดียวมีสินค้าชื่อเดียวกันสองบรรทัดคนละราคา — ขายล็อตเก่า 900 ล็อตใหม่
   * 700 เป็นเรื่องปกติของงานขายส่ง
   *
   * ว่างได้: ของที่คืนอาจเป็นสินค้าที่ลูกค้าซื้อจาก PO ใบอื่น ซึ่งไม่มีบรรทัดใน
   * ใบนี้ให้ชี้ถึงตั้งแต่แรก และของที่บันทึกไว้ก่อน 0080 ก็ยังอ้างด้วยชื่อได้
   */
  itemUid?: string;
};

/**
 * ราคาต่อหน่วยที่ของคืนชิ้นนี้ถูกขายไป.
 *
 * บรรทัดที่ระบุไว้ก่อน แล้วค่อยตกกลับไปที่ชื่อ — การคืนเป็นการกลับรายการขายที่
 * เจาะจง ไม่ใช่การตีราคาใหม่
 */
export function returnUnitPrice(o: { items: OrderItem[] }, r: OrderReturn): number {
  const byUid = r.itemUid ? o.items.find((i) => i.uid && i.uid === r.itemUid) : undefined;
  return Number((byUid ?? o.items.find((i) => i.name === r.item))?.requestedPrice || 0);
}

/**
 * The steps a PO is still moving through. Anything else is the closing step.
 *
 * Listed rather than naming the closing step, because the shop names that one
 * itself: production calls it เสร็จสิ้น, the seed ปิดงานแล้ว. The open steps are
 * the workflow the code drives, so they are fixed.
 *
 * `จัดส่งแล้วบางส่วน` (migration 0081) อยู่ในนี้ด้วย: ของยังออกไม่ครบและเงินยัง
 * ไม่จบ มันจึงเป็นงานที่ยังต้องตามเหมือนขั้นอื่น
 *
 * `ตัดหนี้สูญ` ไม่อยู่ในนี้ และเป็นเรื่องตั้งใจ — หนี้ที่ตัดทิ้งแล้วไม่ควรนั่งอยู่
 * ในยอดค้างรับให้คนไล่ตามต่อ นั่นคือความหมายทั้งหมดของการตัดมันทิ้ง
 */
export const WS_OPEN_STATUSES = [
  'รออนุมัติราคา',
  'รอจัดส่ง',
  'จัดส่งแล้วบางส่วน',
  'จัดส่งแล้ว',
  'ค้างชำระ',
] as const;

export function isOpenOrderStatus(status: string): boolean {
  return (WS_OPEN_STATUSES as readonly string[]).includes(status);
}

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
  const returnsTotal = o.returns.reduce((s, r) => s + r.qty * returnUnitPrice(o, r), 0);
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

/*
  วันที่เปิด PO (ร้านขอ 21 ก.ย. 2569) — today by default, changeable.

  The PO's date is `orders.created_at`: the list's period filter, the invoice
  reference date and the dashboard's order all read it. It used to be only
  ever "the moment somebody pressed save", so a PO agreed on the phone on
  Friday and typed in on Monday was a Monday PO, in the wrong week and at a
  month end in the wrong month — with no way to say otherwise.

  The form deals in shop days (`YYYY-MM-DD`, Bangkok); the column is an
  instant. So:
    - a day that is the one already stored changes nothing, and the stored
      instant (with its real time of day) is kept;
    - a new PO dated today is left to the database's own now();
    - any other day becomes noon of that day in Bangkok — the middle of the
      shop day, so no time-zone slip can carry it into the day before or after.
  The PO NUMBER is not touched either way: it was issued when the PO was
  saved, and document numbers never change.
*/
const SHOP_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The `created_at` to write, or `null` to leave the column as it is. */
export function poOpenedAt(
  openedOn: string | undefined,
  stored: { day: string } | null,
  today: string,
): string | null {
  if (!openedOn || !SHOP_DAY.test(openedOn)) return null;
  if (stored ? openedOn === stored.day : openedOn === today) return null;
  return `${openedOn}T12:00:00+07:00`;
}

export type OrderForCollectible = OrderForTotals & {
  /** รอบส่งของ (migration 0077). ไม่มี = ผู้เรียกที่ไม่ได้โหลดรอบมาด้วย. */
  deliveries?: DeliveryRound[];
  payments: { amount: number; status?: string }[];
};

/**
 * ยอดที่เรียกเก็บได้จริงตอนนี้ — มูลค่าของที่ส่งไปแล้ว หักเงินที่รับมาแล้ว
 * (ร้านยืนยัน 28 ก.ย. 2569).
 *
 * ตั้งแต่ PO ส่งของได้หลายรอบ (0077) "ค้างรับ" ที่นับยอดทั้งใบกลายเป็นคำตอบที่
 * ผิด: ลูกค้าสั่ง 200 ม้วน รับไปแล้ว 80 — ของอีก 120 ม้วนยังอยู่บนชั้นของร้าน
 * และยังเรียกเก็บเงินไม่ได้ การนับมันเป็นเงินที่รอรับ ทำให้ยอดลูกหนี้บวมกว่า
 * ความจริงทุกครั้งที่มีการแบ่งส่ง
 *
 * อยู่ที่นี่ ไม่ใช่ในไฟล์ของการ์ดใบใดใบหนึ่ง เพราะทั้งการ์ดค้างรับของขายส่ง
 * รายชื่อลูกหนี้ และตารางเทียบสาขา ต่างก็ตอบคำถามเดียวกัน — และสองหน้าจอที่
 * ตอบคำถามเดียวกันด้วยตัวเลขคนละตัว คือสิ่งที่ทำให้คนเลิกเชื่อทั้งคู่
 *
 * การคืนของและการปรับราคาที่อนุมัติแล้ว หักออกด้วย เพราะเป็นส่วนลดของทั้งบิล
 * ไม่ได้ผูกกับรอบใดรอบหนึ่ง แล้วกันไม่ให้ติดลบ: รับเงินล่วงหน้ามากกว่าของที่ส่ง
 * ไม่ใช่หนี้ที่ติดลบ
 *
 * ไม่มีรอบส่งของมาด้วย = ยอดทั้งใบเหมือนเดิม เพื่อไม่ให้ตัวเลขที่เคยถูกอยู่แล้ว
 * หล่นเป็นศูนย์เงียบ ๆ ที่ผู้เรียกที่ยังไม่ได้อัปเดต
 */
export function orderCollectible(o: OrderForCollectible): number {
  const rounds = o.deliveries ?? [];
  const itemsTotal = o.items.reduce(
    (s, i) => s + Number(i.qty || 0) * Number(i.requestedPrice || 0),
    0,
  );
  const shipped = rounds.length > 0 ? deliveredValue(o.items, rounds) : itemsTotal;
  // itemsTotal - orderTotal = ส่วนที่การคืนของและการปรับราคาหักไปจากบิล
  const reductions = itemsTotal - orderTotal(o);
  return Math.max(0, shipped - reductions - orderPaid(o));
}
