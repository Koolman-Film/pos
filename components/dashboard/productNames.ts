/**
 * ชื่อสินค้าที่ขึ้นบนแดชบอร์ด — ของที่ขายจริง หรือของที่ลูกค้าสนใจไว้ก่อน.
 *
 * A booking is taken before anything is decided: the counter writes down what
 * the customer is interested in, and สินค้าที่ขาย stays empty until the car is in
 * and the price is agreed. The card read only สินค้าที่ขาย, so a job booked for
 * next week showed its category and nothing else — the one thing the person
 * reading the card wants to know is what the car is coming in for.
 *
 * A line that is still only an interest is marked, because the card is
 * photographed and passed around: "ฟิล์ม 3M CRM 60% (สนใจ)" is a different
 * promise from the same name without it.
 *
 * `booked` is the old baseline column, kept so tickets from before สินค้าที่สนใจ
 * replaced it still read (ticket_items.booked); it means the same thing here.
 */

export type ProductItem = {
  sold?: string | null;
  interested?: string | null;
  booked?: string | null;
};

export const INTEREST_SUFFIX = ' (สนใจ)';

export function productLabels(items: ProductItem[]): string[] {
  const labels: string[] = [];
  for (const i of items) {
    const sold = (i.sold ?? '').trim();
    if (sold) {
      labels.push(sold);
      continue;
    }
    const wanted = (i.interested ?? '').trim() || (i.booked ?? '').trim();
    if (wanted) labels.push(wanted + INTEREST_SUFFIX);
  }
  return [...new Set(labels)];
}
