import { describe, it, expect } from 'vitest';

import { buildSalesReport, NO_SALES_PERSON } from '@/components/wholesale/salesReport';
import type { WsCustomer, WsOrder } from '@/components/wholesale/types';

/**
 * รายงานสรุปการขายของขายส่ง (ร้านขอ 6 พ.ย. 2569).
 *
 * หน้ารายการตอบทีละใบ รายงานนี้ตอบว่า "ลูกค้ารายนี้ค้างเราเท่าไหร่" และ
 * "เซลล์คนนี้ขายได้เท่าไหร่ เก็บเงินได้เท่าไหร่" ซึ่งเป็นตัวเลขที่ต้องนั่งรวม
 * เองจากหน้ารายการทุกครั้ง
 */
const TODAY = '2026-11-06';

const CUSTOMERS = [
  { id: 1, name: 'ร้านออโต้สไตล์' },
  { id: 2, name: 'ร้านดีคาร์แคร์' },
] as unknown as WsCustomer[];

const po = (over: Partial<WsOrder> & { id: string }): WsOrder =>
  ({
    shop: 'cm',
    customerId: 1,
    status: 'ค้างชำระ',
    createdAt: '2026-10-01T03:00:00Z',
    items: [{ name: 'ฟิล์ม', qty: 10, listPrice: 1000, requestedPrice: 1000, uid: 'u1' }],
    returns: [],
    adjustments: [],
    payments: [],
    ...over,
  }) as unknown as WsOrder;

const build = (orders: WsOrder[], groupBy: 'customer' | 'sales' = 'customer') =>
  buildSalesReport(orders, { groupBy, customers: CUSTOMERS, today: TODAY });

describe('buildSalesReport — ยอดรวมและยอดค้างชำระ', () => {
  it('ค้างชำระ = ยอดสุทธิ ลบที่รับเงินแล้วจริง', () => {
    const out = build([
      po({
        id: 'WS-CM-0001',
        payments: [{ amount: 4000, method: 'เงินสด', status: 'รับเงินแล้ว' }],
      } as Partial<WsOrder> & { id: string }),
    ]);
    expect(out.total).toBe(10000);
    expect(out.paid).toBe(4000);
    expect(out.outstanding).toBe(6000);
  });

  it('เช็คที่แจ้งแล้วแต่ยังไม่ยืนยัน ไม่ตัดหนี้ แต่แสดงแยกไว้', () => {
    /*
      ลูกค้าที่ยื่นเช็คมาแล้วอยู่คนละสถานะกับคนที่ยังไม่ส่งอะไรมาเลย — แต่หนี้
      ยังเท่าเดิมจนกว่าเช็คจะขึ้นเงิน การเอาไปหักออกจากยอดค้างคือการบอกว่าได้
      เงินแล้วทั้งที่ยังไม่ได้
    */
    const out = build([
      po({
        id: 'WS-CM-0002',
        payments: [{ amount: 10000, method: 'เช็ค', status: 'แจ้งแล้ว' }],
      } as Partial<WsOrder> & { id: string }),
    ]);
    expect(out.paid).toBe(0);
    expect(out.outstanding).toBe(10000);
    expect(out.reported).toBe(10000);
  });

  it('การคืนของและการปรับราคาที่อนุมัติแล้ว ลดยอดสุทธิ', () => {
    const out = build([
      po({
        id: 'WS-CM-0003',
        returns: [{ item: 'ฟิล์ม', qty: 2, reason: '', date: '2026-10-05' }],
        adjustments: [{ amount: 500, reason: 'ส่วนลด', date: '2026-10-06', status: 'อนุมัติแล้ว' }],
      } as unknown as Partial<WsOrder> & { id: string }),
    ]);
    // 10,000 − (2 × 1,000) − 500
    expect(out.total).toBe(7500);
    expect(out.outstanding).toBe(7500);
  });

  it('การปรับราคาที่ยังรออนุมัติ ยังไม่ลดยอด', () => {
    // ถ้าหักไปก่อน การอนุมัติก็เป็นแค่พิธี และเงินหายไปก่อนมีใครเห็นชอบ
    const out = build([
      po({
        id: 'WS-CM-0004',
        adjustments: [{ amount: 500, reason: 'ขอลด', date: '2026-10-06', status: 'รออนุมัติ' }],
      } as unknown as Partial<WsOrder> & { id: string }),
    ]);
    expect(out.total).toBe(10000);
  });
});

describe('buildSalesReport — เลยกำหนดชำระ', () => {
  it('เลยกำหนดและยังค้าง = นับเข้ายอดที่ต้องตาม', () => {
    const out = build([po({ id: 'WS-CM-0005', dueAt: '2026-10-31' })]);
    expect(out.groups[0].rows[0].overdue).toBe(true);
    expect(out.overdueOutstanding).toBe(10000);
  });

  it('เลยกำหนดแต่จ่ายครบแล้ว ไม่ใช่หนี้ที่ต้องตาม', () => {
    const out = build([
      po({
        id: 'WS-CM-0006',
        dueAt: '2026-10-31',
        payments: [{ amount: 10000, method: 'เงินสด', status: 'รับเงินแล้ว' }],
      } as Partial<WsOrder> & { id: string }),
    ]);
    expect(out.groups[0].rows[0].overdue).toBe(false);
    expect(out.overdueOutstanding).toBe(0);
  });

  it('ไม่มีกำหนดชำระ ไม่นับว่าเลยกำหนด', () => {
    /*
      PO ที่ไม่เคยตกลงวันไว้ ไม่ได้แปลว่าสาย การนับมันเป็นหนี้ที่เลยกำหนดจะทำให้
      ยอดที่ต้องตามด่วนบวมด้วยใบที่ไม่มีใครผิดนัดเลยสักใบ
    */
    const out = build([po({ id: 'WS-CM-0007', dueAt: '' })]);
    expect(out.groups[0].rows[0].overdue).toBe(false);
    expect(out.overdueOutstanding).toBe(0);
  });
});

describe('buildSalesReport — การจัดกลุ่ม', () => {
  const two = [
    po({ id: 'WS-CM-0010', customerId: 1, salesBy: 'โหน่ง' }),
    po({
      id: 'WS-CM-0011',
      customerId: 2,
      salesBy: 'เคน',
      payments: [{ amount: 10000, method: 'เงินสด', status: 'รับเงินแล้ว' }],
    } as Partial<WsOrder> & { id: string }),
  ];

  it('แยกตามลูกค้า และแสดงชื่อเซลล์เป็นคอลัมน์คู่', () => {
    const out = build(two, 'customer');
    expect(out.groups.map((g) => g.label)).toEqual(['ร้านออโต้สไตล์', 'ร้านดีคาร์แคร์']);
    expect(out.groups[0].rows[0].counterpart).toBe('โหน่ง');
  });

  it('แยกตามพนักงานขาย และแสดงชื่อลูกค้าเป็นคอลัมน์คู่', () => {
    const out = build(two, 'sales');
    expect(out.groups.map((g) => g.label)).toEqual(['โหน่ง', 'เคน']);
    expect(out.groups[0].rows[0].counterpart).toBe('ร้านออโต้สไตล์');
  });

  it('ยอดรวมทั้งรายงานเท่ากัน ไม่ว่าจะจัดกลุ่มแบบไหน', () => {
    // จัดกลุ่มคนละแบบแล้วได้ยอดรวมคนละตัว คือรายงานที่ไม่มีใครเชื่อได้
    const byCustomer = build(two, 'customer');
    const bySales = build(two, 'sales');
    expect(bySales.total).toBe(byCustomer.total);
    expect(bySales.outstanding).toBe(byCustomer.outstanding);
    expect(bySales.orders).toBe(byCustomer.orders);
  });

  it('ไม่ได้ระบุเซลล์ ไปรวมอยู่ป้ายเดียว ไม่ใช่กลุ่มว่างหลายกลุ่ม', () => {
    const out = build([po({ id: 'WS-CM-0012', salesBy: '' }), po({ id: 'WS-CM-0013' })], 'sales');
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].label).toBe(NO_SALES_PERSON);
    expect(out.groups[0].orders).toBe(2);
  });

  it('กลุ่มที่ค้างเยอะสุดขึ้นก่อน', () => {
    /*
      รายงานนี้ถูกเปิดเพื่อตามเงินเป็นหลัก คนที่ต้องโทรหาก่อนคือคนที่ค้างมากสุด
      ไม่ใช่คนที่ชื่อขึ้นต้นด้วย ก
    */
    const out = build(
      [
        po({ id: 'WS-CM-0020', customerId: 1 }),
        po({
          id: 'WS-CM-0021',
          customerId: 2,
          items: [{ name: 'ฟิล์ม', qty: 50, listPrice: 1000, requestedPrice: 1000, uid: 'u1' }],
        } as unknown as Partial<WsOrder> & { id: string }),
      ],
      'customer',
    );
    expect(out.groups[0].label).toBe('ร้านดีคาร์แคร์');
    expect(out.groups[0].outstanding).toBe(50000);
  });

  it('ในกลุ่ม ใบที่เลยกำหนดขึ้นก่อน', () => {
    const out = build([
      po({ id: 'WS-CM-0030', dueAt: '' }),
      po({ id: 'WS-CM-0031', dueAt: '2026-10-01' }),
    ]);
    expect(out.groups[0].rows.map((r) => r.orderId)).toEqual(['WS-CM-0031', 'WS-CM-0030']);
  });

  it('ไม่มี PO เลย ก็ได้รายงานเปล่าที่ยอดเป็นศูนย์', () => {
    const out = build([]);
    expect(out.groups).toEqual([]);
    expect(out.total).toBe(0);
    expect(out.outstanding).toBe(0);
  });
});
