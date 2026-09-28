import { describe, it, expect } from 'vitest';

import {
  buildTrend,
  computePayables,
  computeReceivables,
  type TrendExpense,
  type TrendTicket,
} from '@/components/dashboard/receivables';

describe('computeReceivables', () => {
  it('includes an unpaid ticket and an unpaid wholesale order, sorted by amount descending', () => {
    const tickets = [
      {
        id: 'JT-1',
        shop: 'cm',
        customer: 'A',
        plate: '1กก',
        items: [{ soldPrice: 1000 }],
        payments: [],
      },
    ];
    const orders = [
      {
        id: 'WS-1',
        shop: 'cm',
        customerId: 1,
        items: [{ name: 'X', qty: 1, requestedPrice: 5000 }],
        returns: [],
        adjustments: [],
        payments: [],
      },
    ];
    const customers = [{ id: 1, name: 'ร้านทดสอบ' }];
    const result = computeReceivables(tickets, orders, customers, 'all');
    expect(result.map((r) => r.source)).toEqual(['ขายส่ง', 'ใบงานติดตั้ง']); // 5000 > 1000, descending
    expect(result[0].amount).toBe(5000);
  });

  /*
    ลูกหนี้ขายส่ง คิดจากของที่ส่งไปแล้ว (0077).

    กติกาเดียวกับการ์ด ค้างรับ ของโมดูลขายส่ง — ของที่ยังไม่ได้ส่งอยู่บนชั้นของ
    ร้าน ไม่ใช่หนี้ของลูกค้า และสองหน้าจอที่ตอบคำถามเดียวกันด้วยตัวเลขคนละตัว
    คือสิ่งที่ทำให้คนเลิกเชื่อทั้งคู่
  */
  it('นับเฉพาะของที่ส่งไปแล้ว เมื่อ PO แบ่งส่งหลายรอบ', () => {
    const orders = [
      {
        id: 'WS-1',
        shop: 'cm',
        customerId: 1,
        items: [{ name: 'ฟิล์ม', qty: 200, requestedPrice: 1200, uid: 'u1' }],
        returns: [],
        adjustments: [],
        payments: [],
        deliveries: [{ items: [{ itemUid: 'u1', qty: 80 }] }],
      },
    ];
    const result = computeReceivables([], orders, [{ id: 1, name: 'ร้านทดสอบ' }], 'all');
    expect(result[0].amount).toBe(96000);
  });

  it('ส่งแล้วเก็บเงินครบ ไม่อยู่ในลูกหนี้ แม้ยังส่งไม่หมด', () => {
    const orders = [
      {
        id: 'WS-1',
        shop: 'cm',
        customerId: 1,
        items: [{ name: 'ฟิล์ม', qty: 200, requestedPrice: 1200, uid: 'u1' }],
        returns: [],
        adjustments: [],
        payments: [{ amount: 96000 }],
        deliveries: [{ items: [{ itemUid: 'u1', qty: 80 }] }],
      },
    ];
    expect(computeReceivables([], orders, [], 'all')).toHaveLength(0);
  });

  it('PO ที่ไม่ได้โหลดรอบส่งของมาด้วย ยังนับทั้งใบ', () => {
    // ผู้เรียกที่ยังไม่ได้อัปเดต ต้องไม่ทำให้ยอดลูกหนี้หายไปเงียบ ๆ
    const orders = [
      {
        id: 'WS-1',
        shop: 'cm',
        customerId: 1,
        items: [{ name: 'ฟิล์ม', qty: 200, requestedPrice: 1200, uid: 'u1' }],
        returns: [],
        adjustments: [],
        payments: [],
      },
    ];
    expect(computeReceivables([], orders, [], 'all')[0].amount).toBe(240000);
  });

  it('excludes a fully-paid ticket', () => {
    const tickets = [
      {
        id: 'JT-1',
        shop: 'cm',
        customer: 'A',
        plate: '1กก',
        items: [{ soldPrice: 1000 }],
        payments: [{ amount: 1000 }],
      },
    ];
    expect(computeReceivables(tickets, [], [], 'all')).toHaveLength(0);
  });
});

describe('computePayables', () => {
  it('only includes expenses with status รอจ่าย, filtered by shop', () => {
    const expenses = [
      {
        id: 1,
        shop: 'cm',
        desc: 'A',
        category: 'ค่าเช่า',
        amount: 1000,
        status: 'รอจ่าย',
        due: '25 ก.ค.',
      },
      {
        id: 2,
        shop: 'lp',
        desc: 'B',
        category: 'ค่าเช่า',
        amount: 2000,
        status: 'รอจ่าย',
        due: '25 ก.ค.',
      },
      {
        id: 3,
        shop: 'cm',
        desc: 'C',
        category: 'ค่าเช่า',
        amount: 500,
        status: 'จ่ายแล้ว',
        due: '',
      },
    ];
    expect(computePayables(expenses, 'cm')).toEqual([
      { id: 1, name: 'A', amount: 1000, source: 'ค่าเช่า', due: '25 ก.ค.' },
    ]);
  });
});

describe('buildTrend', () => {
  it('produces a 7-point daily series for the default (today) period with profit = revenue − expense', () => {
    const today = new Date();
    const tickets: TrendTicket[] = [
      { shop: 'cm', dropOff: today, items: [{ soldPrice: 3000 }], payments: [] },
    ];
    const expenses: TrendExpense[] = [
      { shop: 'cm', amount: 1000, status: 'จ่ายแล้ว', paidAt: today },
      { shop: 'cm', amount: 999, status: 'รอจ่าย', paidAt: today }, // unpaid → excluded
    ];
    const trend = buildTrend(tickets, expenses, 'all', 'today', '', '', '');

    expect(trend.labels).toHaveLength(7);
    expect(trend.revenue).toHaveLength(7);
    expect(trend.expense).toHaveLength(7);
    // Today is the last bucket.
    expect(trend.revenue[6]).toBe(3000);
    expect(trend.expense[6]).toBe(1000); // the รอจ่าย expense is not counted
    trend.profit.forEach((p, i) => expect(p).toBe(trend.revenue[i] - trend.expense[i]));
  });

  it('scopes to the selected shop', () => {
    const today = new Date();
    const tickets: TrendTicket[] = [
      { shop: 'cm', dropOff: today, items: [{ soldPrice: 3000 }], payments: [] },
      { shop: 'lp', dropOff: today, items: [{ soldPrice: 5000 }], payments: [] },
    ];
    const trend = buildTrend(tickets, [], 'lp', 'today', '', '', '');
    expect(trend.revenue[6]).toBe(5000);
  });
});
