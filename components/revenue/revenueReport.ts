import type { SaleLine } from '@/app/(app)/revenue/data';

/**
 * รายงานรายได้ — how the PDF and the Excel file are laid out
 * (ร้านขอ 22 ก.ย. 2569).
 *
 * The filters above the report (สาขา, ชนิดสินค้า, ช่องทาง, ช่วงเวลา) decide
 * which lines are in it. Within that: one section per สาขา, one table per
 * แหล่งเงิน the money came in by, rows in date order, and a total on every
 * table, every branch and the whole report — the same shape as รายงานค่าใช้จ่าย,
 * so the two can be read side by side against the money register.
 *
 * A job paid through two sources ("เงินสดหน้าร้าน, โอน กสิกร") is its own table
 * rather than being split: its lines are one sale and belong together. A job
 * nothing has been paid on yet is ยังไม่ชำระ, last.
 *
 * Paid and owed are the DOCUMENT's; they are counted once per ใบงาน/PO — on
 * the first of its lines the report prints — so no total counts one job's
 * money once per product on it.
 */

export const UNPAID_SOURCE = 'ยังไม่ชำระ';

export type ReportRow = { line: SaleLine; paid: number; due: number };
export type RevenueTable = {
  source: string;
  rows: ReportRow[];
  amount: number;
  paid: number;
  due: number;
};
export type RevenueSection = {
  shopId: string;
  tables: RevenueTable[];
  amount: number;
  paid: number;
  due: number;
};

const round = (n: number) => Math.round(n * 100) / 100;
const totals = (rows: ReportRow[]) => ({
  amount: round(rows.reduce((s, r) => s + r.line.amount, 0)),
  paid: round(rows.reduce((s, r) => s + r.paid, 0)),
  due: round(rows.reduce((s, r) => s + r.due, 0)),
});

export const sourceOf = (l: SaleLine) => l.payment?.methods?.trim() || UNPAID_SOURCE;

export function groupRevenueReport(
  lines: SaleLine[],
  shopOrder: string[],
): { sections: RevenueSection[]; amount: number; paid: number; due: number } {
  // Date order first, so "the first line of a document" is the one printed first.
  const ordered = lines
    .map((line, i) => ({ line, i }))
    .sort(
      (a, b) =>
        a.line.soldAt.localeCompare(b.line.soldAt) ||
        a.line.ticketId.localeCompare(b.line.ticketId) ||
        a.i - b.i,
    )
    .map((x) => x.line);

  const counted = new Set<string>();
  const rows: ReportRow[] = ordered.map((line) => {
    const key = `${line.channel}|${line.ticketId}`;
    const first = !counted.has(key);
    counted.add(key);
    return {
      line,
      paid: first ? (line.payment?.paid ?? 0) : 0,
      due: first ? (line.payment?.due ?? 0) : 0,
    };
  });

  const shops = [
    ...shopOrder.filter((id) => rows.some((r) => r.line.shop === id)),
    ...[...new Set(rows.map((r) => r.line.shop))].filter((id) => !shopOrder.includes(id)),
  ];

  const sections = shops.map((shopId) => {
    const mine = rows.filter((r) => r.line.shop === shopId);
    const sources = [...new Set(mine.map((r) => sourceOf(r.line)))].sort((a, b) =>
      a === UNPAID_SOURCE ? 1 : b === UNPAID_SOURCE ? -1 : a.localeCompare(b, 'th'),
    );
    const tables = sources.map((source) => {
      const tableRows = mine.filter((r) => sourceOf(r.line) === source);
      return { source, rows: tableRows, ...totals(tableRows) };
    });
    return { shopId, tables, ...totals(mine) };
  });

  return { sections, ...totals(rows) };
}
