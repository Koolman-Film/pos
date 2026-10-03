import { describe, it, expect } from 'vitest';

import {
  buildWholesaleOverview,
  type OverviewOrder,
} from '@/components/dashboard/buildWholesaleOverview';
import { buildTrend } from '@/components/dashboard/receivables';
import type { WholesaleRevenueLine } from '@/lib/domain/wholesaleRevenue';

/**
 * ขายส่งบนแดชบอร์ด.
 *
 * A wholesale-only branch used to open onto a dashboard built entirely from
 * tickets. These pin the card that fixes it, and that its numbers are the ones
 * the rest of the system already agrees on.
 */

const TODAY = '2026-09-15';

const po = (over: Partial<OverviewOrder>): OverviewOrder => ({
  id: 'WS-NT-0001',
  shop: 'north',
  customerId: 1,
  status: 'จัดส่งแล้ว',
  deliveredAt: '2026-09-05',
  createdAt: '2026-09-01T03:00:00Z',
  dueAt: '',
  salesBy: 'โหน่ง',
  items: [{ name: 'ฟิล์ม', qty: 10, requestedPrice: 1000 }],
  returns: [],
  adjustments: [],
  payments: [],
  ...over,
});

const line = (orderId: string, amount: number): WholesaleRevenueLine => ({
  orderId,
  shop: 'north',
  on: '2026-09-05',
  kind: 'ขาย',
  item: 'ฟิล์ม',
  amount,
});

const customers = [
  { id: 1, name: 'ร้านออโต้สไตล์' },
  { id: 2, name: 'ร้านดีคาร์แคร์' },
];

const build = (orders: OverviewOrder[], revenueLines: WholesaleRevenueLine[] = []) =>
  buildWholesaleOverview({ orders, customers, revenueLines, today: TODAY });

describe('buildWholesaleOverview', () => {
  it('shows nothing for a branch with no POs', () => {
    expect(build([])).toBeNull();
  });

  it('counts the POs in each open step, and leaves closed ones out of "open"', () => {
    const d = build([
      po({ id: 'A', status: 'รออนุมัติราคา', deliveredAt: null }),
      po({ id: 'B', status: 'รอจัดส่ง', deliveredAt: null }),
      po({ id: 'C', status: 'รอจัดส่ง', deliveredAt: null }),
      po({ id: 'D', status: 'ปิดงานแล้ว' }),
    ])!;
    expect(d.openCount).toBe(3);
    expect(d.statusCounts).toEqual([
      { status: 'รออนุมัติราคา', count: 1 },
      { status: 'รอจัดส่ง', count: 2 },
      // ส่งแล้วแต่ยังไม่ครบ ก็ยังเป็นงานที่ต้องตาม (0081)
      { status: 'จัดส่งแล้วบางส่วน', count: 0 },
      { status: 'จัดส่งแล้ว', count: 0 },
      { status: 'ค้างชำระ', count: 0 },
    ]);
  });

  it('treats the final step as closed whatever the shop has renamed it to', () => {
    // Production renamed ปิดงานแล้ว to เสร็จสิ้น in the status settings.
    const d = build([
      po({ id: 'OPEN', dueAt: '2026-09-10' }),
      po({ id: 'DONE', status: 'เสร็จสิ้น', dueAt: '2026-09-10' }),
    ])!;
    expect(d.openCount).toBe(1);
    expect(d.owing).toEqual({ count: 1, amount: 10000 });
    expect(d.overdue).toEqual({ count: 1, amount: 10000 });
  });

  it('owes only for goods that have gone out and are not paid for', () => {
    const d = build([
      po({ id: 'SENT' }),
      po({ id: 'NOT-SENT', status: 'รอจัดส่ง', deliveredAt: null }),
      po({ id: 'PAID', payments: [{ amount: 10000, status: 'รับเงินแล้ว' }] }),
    ])!;
    expect(d.owing).toEqual({ count: 1, amount: 10000 });
  });

  it('uses the same overdue and due-soon rules as the alerts', () => {
    const d = build([
      po({ id: 'LATE', dueAt: '2026-09-10' }),
      po({ id: 'SOON', dueAt: '2026-09-17' }),
      po({ id: 'LATER', dueAt: '2026-09-25' }),
    ])!;
    expect(d.overdue).toEqual({ count: 1, amount: 10000 });
    expect(d.dueSoon).toEqual({ count: 1, amount: 10000 });
  });

  it('adds up the period sales, and credits each rep with their own', () => {
    const d = build(
      [
        po({ id: 'A', salesBy: 'โหน่ง' }),
        po({ id: 'B', salesBy: 'เคน' }),
        po({ id: 'C', salesBy: 'เคน' }),
      ],
      [line('A', 5000), line('B', 23000), line('C', 2000)],
    )!;
    expect(d.sales).toBe(30000);
    expect(d.byRep.map((r) => [r.name, r.sales])).toEqual([
      ['เคน', 25000],
      ['โหน่ง', 5000],
    ]);
    expect(d.byRep[0]).toMatchObject({ openCount: 2, owing: 20000 });
  });

  it('lists the newest POs first with customer and total', () => {
    const d = build([
      po({ id: 'OLD', createdAt: '2026-08-01T00:00:00Z' }),
      po({ id: 'NEW', customerId: 2, createdAt: '2026-09-14T00:00:00Z' }),
    ])!;
    expect(d.recent[0]).toMatchObject({ id: 'NEW', customer: 'ร้านดีคาร์แคร์', total: 10000 });
    expect(d.recent.map((r) => r.id)).toEqual(['NEW', 'OLD']);
  });
});

describe('buildTrend — ขายส่งอยู่ในเส้นรายได้', () => {
  it('puts wholesale revenue in its month on the year view', () => {
    const t = buildTrend([], [], 'all', 'year', '2569', '', '', [
      { shop: 'north', on: '2026-09-05', amount: 23000 },
    ]);
    expect(t.revenue[8]).toBe(23000);
  });

  it('respects the branch on screen', () => {
    const t = buildTrend([], [], 'cm', 'year', '2569', '', '', [
      { shop: 'north', on: '2026-09-05', amount: 23000 },
    ]);
    expect(t.revenue[8]).toBe(0);
  });
});

/**
 * ค้างรับ ตามวันที่ส่งของที่กรอกเอง (ร้านขอ 24 ก.ย. 2569).
 *
 * The shop drags a PO straight to ค้างชำระ without issuing a ใบส่งของ, which
 * used to leave `deliveredAt` null — so the money was owed on screen, counted
 * in ลูกหนี้, and missing from this card and from รายงานรายได้ both. The form
 * carries วันที่ส่งของ of its own now, and filling it in is what puts the PO
 * back into ค้างรับ.
 */
describe('buildWholesaleOverview — ค้างรับ ตามวันที่ส่งของ', () => {
  const unpaid = { id: 'WS-NT-0010', status: 'ค้างชำระ', payments: [] };

  it('leaves a ค้างชำระ PO out of ค้างรับ while no delivery date is written', () => {
    const d = build([po({ ...unpaid, deliveredAt: null })])!;
    expect(d.owing).toEqual({ count: 0, amount: 0 });
    // The status chip still counts it, which is the mismatch the shop saw.
    expect(d.statusCounts.find((s) => s.status === 'ค้างชำระ')?.count).toBe(1);
  });

  it('counts it the moment the delivery date is filled in', () => {
    const d = build([po({ ...unpaid, deliveredAt: '2026-09-20' })])!;
    expect(d.owing).toEqual({ count: 1, amount: 10000 });
  });

  it('gives the sales rep their own ค้างรับ back with it', () => {
    // โหน่ง showed 0.00 against four unpaid POs, for this one reason.
    const d = build([
      po({ ...unpaid, deliveredAt: '2026-09-20', salesBy: 'โหน่ง' }),
      po({
        id: 'WS-NT-0011',
        status: 'ค้างชำระ',
        payments: [],
        deliveredAt: null,
        salesBy: 'โหน่ง',
      }),
    ])!;
    expect(d.byRep.find((r) => r.name === 'โหน่ง')?.owing).toBe(10000);
  });

  it('does not count a PO that has been closed, dated or not', () => {
    // ปิดงานแล้ว is not owed however the date reads.
    const d = build([po({ ...unpaid, status: 'ปิดงานแล้ว', deliveredAt: '2026-09-20' })])!;
    expect(d.owing).toEqual({ count: 0, amount: 0 });
  });
});

/**
 * ค้างรับ = มูลค่าของที่ส่งไปแล้ว หักเงินที่รับมาแล้ว (ร้านยืนยัน 28 ก.ย. 2569).
 *
 * ตั้งแต่ PO ส่งของได้หลายรอบ (0077) การนับยอดทั้งใบเป็น "เงินที่รอรับ" ทำให้
 * ตัวเลขลูกหนี้บวมกว่าความจริงทุกครั้งที่แบ่งส่ง — ของที่ยังไม่ได้ส่งอยู่บนชั้น
 * ของร้าน ไม่ใช่หนี้ของลูกค้า
 */
describe('buildWholesaleOverview — ค้างรับคิดจากของที่ส่งแล้ว', () => {
  const bigPo = (over: Partial<OverviewOrder> = {}): OverviewOrder =>
    po({
      items: [
        { name: 'ฟิล์ม', qty: 200, requestedPrice: 1200, uid: 'u1' },
        { name: 'ลำโพง', qty: 10, requestedPrice: 450, uid: 'u2' },
      ],
      ...over,
    });

  const round = (lines: [string, number][]) => ({
    items: lines.map(([itemUid, qty]) => ({ itemUid, qty })),
  });

  it('ส่งไป 80 จาก 200 ค้างรับเท่าของที่ส่ง ไม่ใช่ทั้งใบ', () => {
    const d = build([bigPo({ deliveries: [round([['u1', 80]])] })])!;
    // 80 × 1200 = 96,000 — ไม่ใช่ 240,000 + 4,500 ของทั้งใบ
    expect(d.owing).toEqual({ count: 1, amount: 96000 });
  });

  it('ของที่ส่งไปแล้ว เก็บเงินครบ ก็ไม่ค้างรับ แม้ยังส่งไม่หมด', () => {
    const d = build([
      bigPo({
        deliveries: [round([['u1', 80]])],
        payments: [{ amount: 96000, status: 'รับเงินแล้ว' }],
      }),
    ])!;
    expect(d.owing).toEqual({ count: 0, amount: 0 });
  });

  it('รับเงินล่วงหน้ามากกว่าของที่ส่ง ไม่กลายเป็นค้างรับติดลบ', () => {
    const d = build([
      bigPo({
        deliveries: [round([['u1', 80]])],
        payments: [{ amount: 150000, status: 'รับเงินแล้ว' }],
      }),
    ])!;
    expect(d.owing).toEqual({ count: 0, amount: 0 });
  });

  it('การคืนของหักออกจากค้างรับด้วย', () => {
    const d = build([
      bigPo({
        deliveries: [round([['u1', 80]])],
        returns: [{ item: 'ฟิล์ม', qty: 10 }],
      }),
    ])!;
    // ส่งไป 96,000 คืนมา 10 ม้วน = 12,000
    expect(d.owing).toEqual({ count: 1, amount: 84000 });
  });

  it('ส่งครบทั้งใบ ค้างรับเท่ายอดทั้งใบเหมือนเดิม', () => {
    const d = build([
      bigPo({
        deliveries: [
          round([
            ['u1', 200],
            ['u2', 10],
          ]),
        ],
      }),
    ])!;
    expect(d.owing).toEqual({ count: 1, amount: 200 * 1200 + 10 * 450 });
  });

  it('PO ที่ไม่ได้โหลดรอบส่งของมาด้วย ยังนับทั้งใบ ไม่หล่นเป็นศูนย์', () => {
    // ผู้เรียกที่ไม่ได้ select รอบมา ต้องไม่ทำให้ยอดลูกหนี้หายไปเงียบ ๆ
    const d = build([bigPo()])!;
    expect(d.owing).toEqual({ count: 1, amount: 200 * 1200 + 10 * 450 });
  });

  it('ยอดต่อพนักงานขาย ใช้กติกาเดียวกัน', () => {
    const d = build([bigPo({ deliveries: [round([['u1', 80]])], salesBy: 'โหน่ง' })])!;
    expect(d.byRep[0]).toMatchObject({ name: 'โหน่ง', owing: 96000 });
  });
});

/**
 * ยอดที่เลยกำหนด นับเฉพาะงวดนั้น (0078).
 *
 * PO ที่ค้างเฉพาะงวดแรก ไม่ได้เลยกำหนดทั้งใบ — การ์ดที่บอกยอดทั้งใบทำให้คนอ่าน
 * ไปทวงผิดจำนวน
 */
describe('buildWholesaleOverview — ยอดเลยกำหนดตามงวด', () => {
  const scheduled = po({
    dueAt: '2026-10-01',
    installments: [
      { uid: 'i1', seq: 1, dueAt: '2026-09-01', amount: 3000 },
      { uid: 'i2', seq: 2, dueAt: '2026-10-01', amount: 7000 },
    ],
  });

  it('ค้างงวดแรก ยอดที่เลยกำหนดคือ 3,000 ไม่ใช่ 10,000', () => {
    const d = build([scheduled])!;
    expect(d.overdue).toEqual({ count: 1, amount: 3000 });
  });

  it('ใกล้ถึงกำหนด ก็นับเฉพาะงวดที่ใกล้ถึง', () => {
    const d = buildWholesaleOverview({
      orders: [scheduled],
      customers,
      revenueLines: [],
      today: '2026-09-29',
    })!;
    expect(d.dueSoon).toEqual({ count: 1, amount: 7000 });
  });

  it('PO ที่ไม่ได้แบ่งงวด ยังบอกยอดค้างทั้งก้อนเหมือนเดิม', () => {
    const d = build([po({ dueAt: '2026-09-01' })])!;
    expect(d.overdue).toEqual({ count: 1, amount: 10000 });
  });
});
