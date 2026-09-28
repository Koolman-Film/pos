/**
 * ส่งไปแล้วเท่าไหร่ เหลือต้องส่งอีกเท่าไหร่ (migration 0077).
 *
 * PO ใบเดียวส่งหลายรอบได้ — ลูกค้าสั่ง 200 ม้วน รับไปก่อน 80 ที่เหลือรออีกสอง
 * สัปดาห์ (ร้านแจ้ง 28 ก.ย. 2569). Once that is possible, "delivered" stops
 * being a yes/no on the PO and becomes a quantity per line, and three places
 * need the same answer: the form that offers what to send next, the list that
 * shows how far along a PO is, and the database guard that refuses to send
 * more than was ordered.
 *
 * This is the app-side copy of the rule `order_delivered_qty` implements in
 * SQL. It is deliberately a plain function over plain data so a test can state
 * a case in one line — but the database, not this, is what actually holds the
 * line: the form can be out of date, and a stale form must not be able to
 * over-deliver.
 */

export type DeliveredLine = { itemUid: string; qty: number };
export type DeliveryRound = { items: DeliveredLine[] };
export type OrderedLine = { uid?: string; name: string; qty: number };

/** ส่งไปแล้วกี่ชิ้น ต่อ uid ของรายการ. */
export function deliveredByItem(rounds: DeliveryRound[]): Record<string, number> {
  const sent: Record<string, number> = {};
  for (const round of rounds) {
    for (const line of round.items ?? []) {
      const uid = line.itemUid || '';
      if (!uid) continue;
      sent[uid] = (sent[uid] ?? 0) + (Number(line.qty) || 0);
    }
  }
  return sent;
}

export type DeliveryProgress = {
  uid: string;
  name: string;
  ordered: number;
  sent: number;
  /** ไม่ติดลบ: ส่งเกินที่สั่งเป็นข้อมูลที่ผิด ไม่ใช่ของที่ต้องส่งเพิ่ม. */
  remaining: number;
};

/** ทีละรายการ: สั่งเท่าไหร่ ส่งไปแล้วเท่าไหร่ เหลือเท่าไหร่. */
export function deliveryProgress(
  items: OrderedLine[],
  rounds: DeliveryRound[],
): DeliveryProgress[] {
  const sent = deliveredByItem(rounds);
  return items.map((it) => {
    const uid = it.uid || '';
    const ordered = Number(it.qty) || 0;
    const already = sent[uid] ?? 0;
    return {
      uid,
      name: it.name,
      ordered,
      sent: already,
      remaining: Math.max(0, ordered - already),
    };
  });
}

/** ยังมีของค้างส่งอยู่ไหม. PO ที่ไม่มีรายการสินค้าเลย ไม่นับว่าค้างส่ง. */
export function hasUndelivered(items: OrderedLine[], rounds: DeliveryRound[]): boolean {
  return deliveryProgress(items, rounds).some((p) => p.remaining > 0);
}

/**
 * ส่งครบแล้วหรือยัง — คู่กับ `order_fully_delivered` ในฐานข้อมูล.
 *
 * PO ที่ยังไม่มีรายการสินค้า ยังไม่นับว่าส่งครบ: ใบเปล่าที่ระบบบอกว่า "ส่งครบ"
 * คือคำตอบที่ถูกตามตรรกะและผิดตามความจริง
 */
export function fullyDelivered(items: OrderedLine[], rounds: DeliveryRound[]): boolean {
  return items.length > 0 && !hasUndelivered(items, rounds);
}

/** มูลค่าของที่ส่งออกไปแล้ว — ยอดที่ลูกค้าเป็นหนี้จริง ณ ตอนนี้. */
export function deliveredValue(
  items: (OrderedLine & { requestedPrice: number })[],
  rounds: DeliveryRound[],
): number {
  const sent = deliveredByItem(rounds);
  return items.reduce(
    (sum, it) => sum + (sent[it.uid || ''] ?? 0) * (Number(it.requestedPrice) || 0),
    0,
  );
}
