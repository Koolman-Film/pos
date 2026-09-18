/**
 * รายการในเอกสารการเงิน — หนึ่งแถวต่อหนึ่งชนิดสินค้า (ร้านขอ 18 ก.ย. 2569).
 *
 * A ticket prices each product separately, and a customer who bought two kinds
 * of ฟิล์มกรองแสง used to read three rows and add them up themselves to see what
 * the film cost. The document now answers by ชนิดสินค้า: one row, one amount.
 *
 * The products and the panes they cover stay inside the row — that is what the
 * customer checks the car against — but they carry no money of their own. The
 * split between two films is the shop's working, not the price the customer
 * agreed, and printing it invites an argument about a number nobody quoted.
 */

export type DocLine = {
  category: string;
  product: string;
  /** ตำแหน่งที่ติดตั้ง, already joined: "คู่หน้า, คู่หลัง". */
  detail: string;
  amount: number;
};

export type DocGroup = {
  category: string;
  products: { product: string; detail: string }[];
  amount: number;
};

/** Groups by ชนิดสินค้า, keeping the order the ticket put them in. */
export function groupDocLines(lines: DocLine[]): DocGroup[] {
  const groups: DocGroup[] = [];
  const byCategory = new Map<string, DocGroup>();

  for (const l of lines) {
    const category = (l.category ?? '').trim();
    let group = byCategory.get(category);
    if (!group) {
      group = { category, products: [], amount: 0 };
      byCategory.set(category, group);
      groups.push(group);
    }
    group.amount = Math.round((group.amount + Number(l.amount || 0)) * 100) / 100;
    const product = (l.product ?? '').trim();
    const detail = (l.detail ?? '').trim();
    if (!product && !detail) continue;
    // The same product listed twice for the same panes is one line to read.
    if (group.products.some((p) => p.product === product && p.detail === detail)) continue;
    group.products.push({ product, detail });
  }

  return groups;
}
