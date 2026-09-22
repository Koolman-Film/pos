/**
 * รายงานค่าใช้จ่าย — how the PDF and the Excel file are laid out
 * (ร้านขอ 22 ก.ย. 2569).
 *
 * "เรียงลำดับจากตัวกรองก่อน หากไม่ได้กรองให้เรียงตามนี้ 1. สาขา 2 จ่ายจาก
 * 3. วันที่ โดยแยกเป็นตารางพร้อมยอดรวมของตาราง และยอดรวมทั้งหมด"
 *
 * The report holds exactly what the filters above it leave on screen. Within
 * that: one section per สาขา, and inside it one table per จ่ายจาก, rows in date
 * order — because the question a report is checked against is "what came out
 * of this pot, and when", pot by pot. Every table carries its own total, every
 * branch its total, and the report its grand total.
 */

export type ReportExpense = {
  id: number;
  shop: string;
  source: string;
  amount: number;
  /** The day money left (จ่ายแล้ว), or the day it is due (รอจ่าย). */
  dateObj?: Date | string | null;
  dueObj?: Date | string | null;
};

export const NO_SOURCE = 'ยังไม่ระบุ';

export type SourceTable<E> = { source: string; items: E[]; total: number };
export type ShopSection<E> = { shopId: string; tables: SourceTable<E>[]; total: number };

const when = (e: ReportExpense) => {
  const d = e.dateObj ?? e.dueObj;
  return d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
};
const sum = (xs: { amount: number }[]) =>
  Math.round(xs.reduce((s, x) => s + Number(x.amount || 0), 0) * 100) / 100;

/**
 * @param shopOrder the branches in the order the app lists them
 * @param sourceOrder a branch's แหล่งเงิน in the order the money register lists
 *   them; a label that is not one of them (saved before 0064) follows, then
 *   ยังไม่ระบุ last
 */
export function groupExpenseReport<E extends ReportExpense>(
  expenses: E[],
  shopOrder: string[],
  sourceOrder: (shop: string) => string[],
): { sections: ShopSection<E>[]; total: number } {
  const shops = [
    ...shopOrder.filter((id) => expenses.some((e) => e.shop === id)),
    // A branch not in the list still gets its section rather than vanishing.
    ...[...new Set(expenses.map((e) => e.shop))].filter((id) => !shopOrder.includes(id)),
  ];

  const sections = shops.map((shopId) => {
    const mine = expenses.filter((e) => e.shop === shopId);
    const label = (e: E) => e.source?.trim() || NO_SOURCE;
    const known = sourceOrder(shopId);
    const present = [...new Set(mine.map(label))];
    const ordered = [
      ...known.filter((s) => present.includes(s)),
      ...present
        .filter((s) => !known.includes(s) && s !== NO_SOURCE)
        .sort((a, b) => a.localeCompare(b, 'th')),
      ...(present.includes(NO_SOURCE) ? [NO_SOURCE] : []),
    ];
    const tables = ordered.map((source) => {
      const items = mine
        .filter((e) => label(e) === source)
        .sort((a, b) => when(a) - when(b) || a.id - b.id);
      return { source, items, total: sum(items) };
    });
    return { shopId, tables, total: sum(mine) };
  });

  return { sections, total: sum(expenses) };
}
