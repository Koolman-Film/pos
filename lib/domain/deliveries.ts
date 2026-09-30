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

/**
 * สิ่งที่ PO ใบหนึ่งทำกับชั้นวางไปแล้วจริง ๆ — บวกคือของออกไปจากคลัง.
 *
 * ใช้ตอนลบ PO (ต้องคืนเท่านี้) และตอนกู้คืน (ต้องเอาออกอีกเท่านี้) ก่อนหน้านี้
 * ทั้งสองทางคิดจาก "จำนวนที่สั่ง ลบ จำนวนที่คืน" ซึ่งผิดสองชั้นตั้งแต่ของออกจาก
 * คลังทีละรอบ (0077): PO ที่สั่ง 200 ส่งไป 80 จะคืนเข้าชั้น 200 คือเสกของที่
 * ร้านไม่มี และการคืนที่ลูกค้าแจ้งไว้แต่ยังไม่ได้ส่งของกลับมา ก็ถูกหักออกทั้งที่
 * ชั้นวางไม่เคยขยับ
 *
 * ตราประทับสองอันคือหลักฐานเดียวที่บอกว่าชั้นวางขยับจริง — รอบที่ตัดสต็อกแล้ว
 * และการคืนที่รับของกลับเข้ามาแล้ว อย่างอื่นเป็นแค่ความตั้งใจ
 *
 * `legacy` ใช้เฉพาะ PO ที่ตัดสต็อกไปก่อน 0077 แต่ไม่มีรอบส่งของเลย ซึ่ง
 * การ backfill น่าจะเก็บครบหมดแล้ว — แต่ถ้าหลุดมา การคืนศูนย์ชิ้นคือการกลืนของ
 * หายไปเงียบ ๆ ซึ่งแย่กว่าการเดาด้วยจำนวนที่สั่ง
 */
export function shelfEffect(
  rounds: { stockDeductedAt?: string | null; items: { name: string; qty: number }[] }[],
  returns: { name: string; qty: number }[],
  /**
   * PO ที่ตัดสต็อกไปก่อน 0077: `deducted` คือตราประทับเดิมบน `orders` และ
   * `items` คือจำนวนที่สั่ง ซึ่งสมัยนั้นออกจากคลังทั้งใบพร้อมกัน
   */
  legacy?: { deducted: boolean; items: { name: string; qty: number }[] },
): Record<string, number> {
  const effect: Record<string, number> = {};
  const add = (name: string, qty: number) => {
    if (!name) return;
    effect[name] = (effect[name] ?? 0) + qty;
  };

  const shipped = rounds.filter((r) => !!r.stockDeductedAt);
  if (shipped.length > 0) {
    for (const round of shipped) {
      for (const li of round.items) add(li.name, Number(li.qty) || 0);
    }
  } else if (legacy?.deducted) {
    for (const it of legacy.items) add(it.name, Number(it.qty) || 0);
  }

  for (const r of returns) add(r.name, -(Number(r.qty) || 0));

  // ศูนย์ไม่ใช่การเคลื่อนไหว และการส่งเข้าไปก็แค่เพิ่มแถวในทะเบียนสต็อกเปล่า ๆ
  for (const [name, qty] of Object.entries(effect)) if (qty === 0) delete effect[name];
  return effect;
}
