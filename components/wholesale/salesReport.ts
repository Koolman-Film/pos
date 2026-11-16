import {
  isReceived,
  orderCollectible,
  orderPaid,
  orderReported,
  orderTotal,
  PAYMENT_BOUNCED,
  PAYMENT_RECEIVED,
  PAYMENT_REPORTED,
} from '@/lib/domain/orders';

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

/** หนึ่งบรรทัดสินค้าใน PO — ชื่อกับจำนวน เท่าที่รายงานต้องบอก. */
export type SalesReportItem = {
  name: string;
  qty: number;
};

/**
 * หนึ่งครั้งที่ลูกค้าจ่ายเงินมา (ร้านขอ 7 พ.ย. 2569).
 *
 * รายงานเดิมบอกแค่ยอดรวมที่ชำระแล้ว ซึ่งตอบไม่ได้ว่าจ่ายมาเมื่อไหร่ จ่ายมาทาง
 * ไหน และที่สำคัญที่สุดคือ "จ่ายมาแล้วแต่ยังรอยืนยันเงินเข้า" — ลูกค้าที่ยื่น
 * เช็คเต็มจำนวนมาแล้ว อยู่คนละสถานะกับลูกค้าที่ยังไม่ส่งอะไรมาเลย แต่ทั้งคู่
 * โผล่ในรายงานเป็นยอดค้างก้อนเดียวกัน แล้วก็โดนตามเหมือนกัน
 */
export type SalesReportPayment = {
  /** วันที่รับชำระ. */
  paidAt: string;
  /** แหล่งเงินที่เงินเข้า — หรือ `chequeRef` เมื่อเป็นเช็ค. */
  method: string;
  /** เลขที่เช็ค ว่าง = ไม่ใช่เช็ค หรือยังไม่ได้กรอก. */
  chequeNo: string;
  chequeBank: string;
  /**
   * วันที่หน้าเช็ค — วันที่คาดว่าเงินจะเข้า.
   *
   * คนละวันกับ `paidAt` ซึ่งเป็นวันที่รับกระดาษไว้ ขายส่งรับเช็คลงวันที่
   * ล่วงหน้าเป็นปกติ สองวันนี้จึงห่างกันเป็นเดือน รายงานที่บอกแต่วันรับ จึง
   * บอกไม่ได้ว่าเงินก้อนนี้จะเข้าเมื่อไหร่ (ร้านแจ้ง 16 พ.ย. 2569)
   */
  chequeDate: string;
  amount: number;
  /** รับเงินแล้ว / แจ้งแล้ว / เด้ง. */
  status: string;
  /** นับเป็นเงินที่เก็บได้แล้วหรือยัง — คำถามเดียวที่รายงานต้องตอบให้ชัด. */
  settled: boolean;
};

export type SalesReportRow = {
  orderId: string;
  shop: string;
  /** สินค้าที่สั่ง — "การสั่งซื้อ" ตอบไม่ได้ว่าขายอะไรถ้าไม่มีอันนี้. */
  items: SalesReportItem[];
  /** การชำระเงินทีละครั้ง เรียงตามวันที่. */
  payments: SalesReportPayment[];
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
  /** ค้างชำระทั้งบิล — รวมส่วนที่แจ้งมาแล้วแต่ยังไม่ยืนยัน. */
  outstanding: number;
  /**
   * ค้างชำระสุทธิ — หักส่วนที่ลูกค้าจ่ายมาแล้วและรอยืนยันออก.
   *
   * ยอดที่ยังไม่มีใครส่งอะไรมาเลย คือยอดที่ต้องโทรไปทวงจริง ๆ ส่วนที่รอยืนยัน
   * ต้องไปตามคนในร้านให้กดยืนยัน ไม่ใช่ไปตามลูกค้า — งานคนละอย่าง
   */
  netOutstanding: number;
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
  /** ค้างชำระหลังหักส่วนที่รอยืนยันเงินเข้า. */
  netOutstanding: number;
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

/**
 * คำในช่องสถานะ — ตอบว่า "เงินเข้าแล้วหรือยัง" ไม่ใช่สะกดชื่อสถานะดิบออกมา.
 *
 * ร้านขอช่องสถานะไว้เพื่อแยกเงินที่เก็บได้แล้ว ออกจากเงินที่ยังรอ คำว่า
 * "แจ้งแล้ว" ตอบคำถามนั้นไม่ตรง เพราะมันบอกว่าใครทำอะไรไป ไม่ได้บอกว่าเงินถึง
 * ร้านหรือยัง
 */
/** หนึ่งการชำระ เท่าที่กฎเรื่องเช็คต้องรู้. */
type ChequeFields = {
  isCheque?: boolean;
  chequeNo?: string;
  chequeBank?: string;
  chequeDate?: string;
};

/**
 * มีเช็คอยู่เบื้องหลังไหม — ดูที่ข้อมูล ไม่ใช่ที่ธง.
 *
 * `isCheque` เพิ่งมีตอน 0064 แถวที่กรอกก่อนหน้านั้นมีเลขเช็คครบแต่ธงเป็นเท็จ
 * และคนกรอกก็เผลอปลดธงทิ้งได้ตลอด ถ้าถามแต่ธง เลขเช็คที่พิมพ์ไว้แล้วจะหาย
 * จากรายงานเงียบ ๆ ทั้งที่กระดาษอยู่ในลิ้นชักจริง ๆ — ใบเสร็จในหน้า PO ถาม
 * แบบนี้อยู่แล้ว ตรงนี้จึงถามแบบเดียวกัน
 */
export function hasCheque(p: ChequeFields): boolean {
  return !!(p.isCheque || p.chequeNo || p.chequeBank || p.chequeDate);
}

/**
 * ชื่อเรียกเช็คใบหนึ่ง — ข้อความเดียว ใช้ทุกที่ที่พูดถึงเช็คใบนี้.
 *
 * หัวข้อ "เช็ค/เงินที่แจ้งแล้ว" กับตารางในรายงานเคยเขียนกันคนละแบบ อันบนบอก
 * เลขเช็ค อันล่างบอกแค่คำว่าเช็คกับชื่อบัญชี คนอ่านเลยเทียบสองที่นี้ไม่ได้
 * ว่าพูดถึงใบเดียวกันหรือเปล่า (ร้านแจ้ง 16 พ.ย. 2569) ฟังก์ชันเดียวจึงเป็น
 * วิธีเดียวที่รับประกันว่ามันจะไม่ค่อย ๆ เพี้ยนออกจากกันอีก
 *
 * ไม่มีวันที่อยู่ในนี้ เพราะวันที่หน้าเช็คไปอยู่ในคอลัมน์วันที่ ซึ่งเป็นที่ของ
 * มัน — ยัดสามอย่างลงช่อง "วิธีการชำระ" แล้วมันจะตกบรรทัดบนกระดาษ
 */
export function chequeRef(p: ChequeFields): string {
  const no = (p.chequeNo ?? '').trim();
  const bank = (p.chequeBank ?? '').trim();
  return `เช็ค${no ? ' ' + no : ''}${bank ? ' ' + bank : ''}`;
}

export function paymentStatusText(p: { status: string }): string {
  if (p.status === PAYMENT_BOUNCED) return 'เช็คเด้ง';
  if (p.status === PAYMENT_REPORTED) return 'รอยืนยันเงินเข้า';
  return 'ชำระแล้ว';
}

/**
 * คลาสสีของสถานะการชำระ — ชุดเดียวกันทั้งบนจอและบนกระดาษ.
 *
 * ร้านขอให้กระดาษมีสีเหมือนหน้าเว็บ (7 พ.ย. 2569) ซึ่งจะเป็นจริงได้ก็ต่อเมื่อ
 * ทั้งสองที่ตัดสินสีจากฟังก์ชันเดียวกัน ไม่ใช่ต่างคนต่างเขียน if แล้วค่อย ๆ
 * เพี้ยนออกจากกัน
 */
export function payInk(p: { status: string; settled: boolean }): string {
  if (p.status === PAYMENT_BOUNCED) return 'ink-due';
  return p.settled ? 'ink-paid' : 'ink-wait';
}

const round = (n: number) => Math.round(n * 100) / 100;

const sum = (rows: SalesReportRow[]): SalesReportTotals => ({
  orders: rows.length,
  total: round(rows.reduce((s, r) => s + r.total, 0)),
  paid: round(rows.reduce((s, r) => s + r.paid, 0)),
  reported: round(rows.reduce((s, r) => s + r.reported, 0)),
  outstanding: round(rows.reduce((s, r) => s + r.outstanding, 0)),
  netOutstanding: round(rows.reduce((s, r) => s + r.netOutstanding, 0)),
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
    const reported = round(orderReported(o));
    const customer = customerName(o.customerId, customers);
    const sales = (o.salesBy ?? '').trim() || NO_SALES_PERSON;

    const row: SalesReportRow = {
      orderId: o.id,
      shop: o.shop,
      items: o.items
        .filter((it) => (it.name ?? '').trim())
        .map((it) => ({ name: it.name, qty: Number(it.qty) || 0 })),
      payments: [...o.payments]
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map((p) => ({
          paidAt: p.date || '',
          /*
            เช็คบอกว่าเป็นเช็ค ไม่ใช่บอกชื่อบัญชีปลายทาง.

            `method` คือแหล่งเงินที่เงินจะไปเข้า ซึ่งสำหรับเช็คแปลว่าบัญชีที่
            จะเอาไปขึ้น — อ่านแล้วเหมือนเงินเข้าแล้ว ทั้งที่กระดาษยังอยู่ในลิ้นชัก
          */
          method: hasCheque(p) ? chequeRef(p) : p.method || '—',
          chequeNo: (p.chequeNo ?? '').trim(),
          chequeBank: (p.chequeBank ?? '').trim(),
          chequeDate: p.chequeDate ?? '',
          amount: Number(p.amount) || 0,
          status: p.status || PAYMENT_RECEIVED,
          settled: isReceived(p),
        })),
      openedOn: (o.createdAt ?? '').slice(0, 10),
      deliveredAt: o.deliveredAt ?? '',
      dueAt: o.dueAt ?? '',
      status: o.status,
      counterpart: groupBy === 'customer' ? sales : customer,
      total,
      paid,
      reported,
      outstanding,
      netOutstanding: round(outstanding - reported),
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
