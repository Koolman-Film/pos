/**
 * จำนวนสินค้าที่ใช้จริง — which rows still want a number, and whether
 * ข้อมูลของช่าง is still open on a ticket that has already closed.
 *
 * THE PROBLEM (ร้านขอ 23 ก.ย. 2569). A ticket locks itself once the car has
 * been handed over and the money is all in (migration 0017), and the lock
 * greyed out ข้อมูลของช่าง with everything else. But the technician often
 * writes their part down afterwards — the car left on Friday, the customer paid
 * at the counter, and the numbers for what was actually used off the roll get
 * entered on Monday. By then the section was read-only, so the shop had to ask
 * an admin to reopen a finished job to record materials that had already left
 * the shelf.
 *
 * THE RULE. While any product row is still blank, the technician block stays
 * open — there is unfinished work in it. Once every row has a number it closes
 * with the rest of the ticket, and ticking แก้งาน opens it again, because a
 * rework consumes more material and that has to come off stock too.
 *
 * WHY HERE. The lock itself is the database's (migration 0066 lets a locked
 * ticket accept technician fields and nothing else — never a price, a payment
 * or the flag). What is left to fill in is a question about the ROWS on screen,
 * and those are derived from positions and sold products in TypeScript. Both
 * the form and this rule read them through `qtyProducts`, so the box a
 * technician sees and the row this counts are the same row by construction.
 */

/** หมวดที่ไม่ได้ตัดสต็อก — labour, with no product to count. */
export const NO_QTY_CATEGORY = 'งานบริการ';

/** ข้อมูลเพิ่มเติม ที่บอกว่างานนี้กลับมาแก้ */
export const REWORK_EXTRA = 'แก้งาน';

export type QtyPosition = { product?: string };
export type QtyItem = {
  category: string;
  sold?: string;
  positions?: QtyPosition[];
  actualQtyMap?: Record<string, number | string>;
};

/**
 * The products one ticket item wants a quantity for.
 *
 * A film item keeps its products in `positions` and its `sold` is a summary
 * line ("บานหน้า: …, คู่หน้า: …"), not a product — so the rows come from the
 * positions, one per DISTINCT product. Anything else has the one product it
 * sold. An empty list means there is nothing to count: an item nobody filled
 * in, or งานบริการ, which is labour.
 */
export function qtyProducts(i: QtyItem): string[] {
  if (i.category === NO_QTY_CATEGORY) return [];
  const fromPositions = (i.positions ?? []).map((p) => p.product).filter(Boolean) as string[];
  if (fromPositions.length > 0) return [...new Set(fromPositions)];
  return i.sold ? [i.sold] : [];
}

/**
 * Has this product's usage been written down?
 *
 * Zero counts as blank, not as "used none of it": `serializeTicket` drops zero
 * and non-numeric entries rather than storing them, so a row holding 0 and a
 * row holding nothing reach the database the same way.
 */
export function hasActualQty(i: QtyItem, product: string): boolean {
  const n = Number(i.actualQtyMap?.[product]);
  return Number.isFinite(n) && n !== 0;
}

/** จำนวนแถวที่ยังไม่ได้กรอก across the whole ticket. */
export function missingQtyCount(items: QtyItem[]): number {
  return items.reduce(
    (n, i) => n + qtyProducts(i).filter((product) => !hasActualQty(i, product)).length,
    0,
  );
}

/**
 * Every row that wants a number has one.
 *
 * A ticket with nothing to count (all งานบริการ, or nothing filled in) is
 * complete — there is no technician work outstanding on it.
 */
export function actualQtyComplete(items: QtyItem[]): boolean {
  return missingQtyCount(items) === 0;
}

export function reworkTicked(extras: Record<string, unknown> | null | undefined): boolean {
  const entry = extras?.[REWORK_EXTRA];
  return !!entry && typeof entry === 'object' && (entry as { checked?: unknown }).checked === true;
}

/**
 * ข้อมูลของช่าง ยังแก้ได้อยู่ไหม บนใบงานที่ล็อกแล้ว.
 *
 * Call it only when the ticket IS locked; an open ticket is editable anyway.
 */
export function techOpenWhileLocked(t: {
  items: QtyItem[];
  extras?: Record<string, unknown> | null;
}): boolean {
  return reworkTicked(t.extras) || !actualQtyComplete(t.items);
}
