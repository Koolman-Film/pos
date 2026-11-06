import { orderCollectible, orderPaid, orderReported, orderTotal } from '@/lib/domain/orders';

import { customerName } from './types';
import type { WsCustomer, WsOrder } from './types';

/**
 * รายงานสรุปการขายของขายส่ง — จบที่ยอดค้างชำระ (ร้านขอ 6 พ.ย. 2569).
 *
 * รายการ PO ตอบว่า "ใบนี้เป็นยังไง" ทีละใบ ส่วนคำถามที่รายงานนี้ตอบคือ "ลูกค้า
 * รายนี้ค้างเราเท่าไหร่" และ "เซลล์คนนี้ขายได้เท่าไหร่ เก็บเงินได้เท่าไหร่" ซึ่ง
 * เป็นคำถามที่ต้องนั่งรวมเองจากหน้ารายการทุกครั้ง
 *
 * แยกตามลูกค้า หรือตามพนักงานขาย — มิติเดียวกับที่ร้านใช้คุยกันจริง: ลูกค้าไว้
 * ตามหนี้ เซลล์ไว้ดูผลงานและคอมมิชชั่น
 *
 * ตัวเลขทุกตัวมาจาก `lib/domain/orders.ts` ตัวเดียวกับที่หน้ารายการ แดชบอร์ด
 * และใบแจ้งหนี้ใช้ ไฟล์นี้จึงไม่ได้คิดเลขเอง แค่จัดกลุ่มและรวม — รายงานที่คิด
 * เลขเองจะกลายเป็นตัวเลขชุดที่สามที่ไม่ตรงกับใครสักหน้า
 */

export type SalesReportGroupBy = 'customer' | 'sales';

/** ไม่ได้ระบุเซลล์ — ป้ายเดียว ไม่ใช่กลุ่มว่าง ๆ หลายกลุ่ม. */
export const NO_SALES_PERSON = 'ไม่ระบุพนักงานขาย';

export type SalesReportRow = {
  orderId: string;
  shop: string;
  /** วันที่เปิด PO — มิติเดียวกับที่ตัวกรองช่วงเวลาของหน้ารายการใช้. */
  openedOn: string;
  /** วันส่งของ ว่าง = ของยังไม่ออก. */
  deliveredAt: string;
  dueAt: string;
  status: string;
  /** ชื่อของอีกมิติหนึ่ง — จัดกลุ่มตามลูกค้าก็แสดงเซลล์ และกลับกัน. */
  counterpart: string;
  total: number;
  paid: number;
  /** เช็คที่รับไว้แล้วแต่ยังไม่ยืนยันเงินเข้า — ยังไม่ตัดหนี้. */
  reported: number;
  /** ค้างชำระทั้งบิล. */
  outstanding: number;
  /** ส่วนที่ของออกไปแล้วและยังไม่ได้เงิน — ยอดที่ทวงได้จริงวันนี้. */
  collectible: number;
  /** เลยกำหนดชำระแล้วและยังค้างอยู่. */
  overdue: boolean;
};

export type SalesReportTotals = {
  orders: number;
  total: number;
  paid: number;
  reported: number;
  outstanding: number;
  collectible: number;
  /** ส่วนของยอดค้างที่เลยกำหนดชำระแล้ว — ยอดที่ต้องตามก่อนเพื่อน. */
  overdueOutstanding: number;
};

export type SalesReportGroup = SalesReportTotals & {
  /** คีย์ที่ไม่ซ้ำในรายงานนี้ — id ของลูกค้า หรือชื่อเซลล์. */
  key: string;
  label: string;
  rows: SalesReportRow[];
};

export type SalesReport = SalesReportTotals & { groups: SalesReportGroup[] };

const round = (n: number) => Math.round(n * 100) / 100;

const sum = (rows: SalesReportRow[]): SalesReportTotals => ({
  orders: rows.length,
  total: round(rows.reduce((s, r) => s + r.total, 0)),
  paid: round(rows.reduce((s, r) => s + r.paid, 0)),
  reported: round(rows.reduce((s, r) => s + r.reported, 0)),
  outstanding: round(rows.reduce((s, r) => s + r.outstanding, 0)),
  collectible: round(rows.reduce((s, r) => s + r.collectible, 0)),
  overdueOutstanding: round(rows.reduce((s, r) => s + (r.overdue ? r.outstanding : 0), 0)),
});

/**
 * `today` ส่งเข้ามา ไม่ได้อ่านจากนาฬิกาเอง — ผู้เรียกปักเขตเวลาไว้ที่เดียว
 * (`todayValue()`, Asia/Bangkok) และเทสต์กำหนดวันได้โดยไม่ต้องหยุดเวลา
 */
export function buildSalesReport(
  orders: WsOrder[],
  {
    groupBy,
    customers,
    today,
  }: { groupBy: SalesReportGroupBy; customers: WsCustomer[]; today: string },
): SalesReport {
  const byKey = new Map<string, { label: string; rows: SalesReportRow[] }>();

  for (const o of orders) {
    const total = round(orderTotal(o));
    const paid = round(orderPaid(o));
    const outstanding = round(total - paid);
    const customer = customerName(o.customerId, customers);
    const sales = (o.salesBy ?? '').trim() || NO_SALES_PERSON;

    const row: SalesReportRow = {
      orderId: o.id,
      shop: o.shop,
      openedOn: (o.createdAt ?? '').slice(0, 10),
      deliveredAt: o.deliveredAt ?? '',
      dueAt: o.dueAt ?? '',
      status: o.status,
      counterpart: groupBy === 'customer' ? sales : customer,
      total,
      paid,
      reported: round(orderReported(o)),
      outstanding,
      collectible: round(orderCollectible(o)),
      /*
        ไม่มีกำหนดชำระ = ยังไม่เลยกำหนด.

        PO ที่ไม่เคยตกลงวันไว้ ไม่ได้แปลว่าสาย การนับมันเป็นหนี้ที่เลยกำหนดจะทำ
        ให้ยอดที่ต้องตามด่วนบวมด้วยใบที่ไม่มีใครผิดนัดเลยสักใบ
      */
      overdue: !!o.dueAt && o.dueAt < today && outstanding > 0.005,
    };

    const key = groupBy === 'customer' ? String(o.customerId ?? '') : sales;
    const label = groupBy === 'customer' ? customer : sales;
    const bucket = byKey.get(key) ?? { label, rows: [] };
    bucket.rows.push(row);
    byKey.set(key, bucket);
  }

  const groups: SalesReportGroup[] = [...byKey.entries()]
    .map(([key, g]) => ({ key, label: g.label, ...sum(g.rows), rows: sortRows(g.rows) }))
    /*
      ค้างเยอะสุดขึ้นก่อน แล้วค่อยยอดขาย.

      รายงานนี้ถูกเปิดเพื่อตามเงินเป็นหลัก คนที่ต้องโทรหาก่อนคือคนที่ค้างมากสุด
      ไม่ใช่คนที่ชื่อขึ้นต้นด้วย ก — ส่วนกลุ่มที่ไม่ค้างเลยเรียงตามยอดขาย ซึ่ง
      ตอบคำถามที่เหลือว่าใครซื้อเยอะ
    */
    .sort(
      (a, b) =>
        b.outstanding - a.outstanding || b.total - a.total || a.label.localeCompare(b.label, 'th'),
    );

  return { groups, ...sum(groups.flatMap((g) => g.rows)) };
}

/** ในกลุ่มหนึ่ง: ใบที่เลยกำหนดขึ้นก่อน แล้วเรียงตามวันที่เปิด PO. */
function sortRows(rows: SalesReportRow[]): SalesReportRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      a.openedOn.localeCompare(b.openedOn) ||
      a.orderId.localeCompare(b.orderId),
  );
}
