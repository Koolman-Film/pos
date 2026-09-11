import { describe, it, expect } from 'vitest';

import { wholesaleRevenueLines, type WholesaleRevenueOrder } from '@/lib/domain/wholesaleRevenue';

/**
 * วันไหนที่ขายส่งนับเป็นยอดขาย (migration 0045, ข้อ 5-6 ของแผนขายส่ง).
 *
 * Wholesale delivers first and is paid weeks later, so the day the PO was
 * raised, the day the goods went out and the day the cheque cleared routinely
 * fall in three different months. Getting this wrong does not produce a wrong
 * total — it produces a right total in the wrong month, which is worse, because
 * nothing looks broken.
 */
const order = (over: Partial<WholesaleRevenueOrder> = {}): WholesaleRevenueOrder => ({
  id: 'WS-CM-0088',
  shop: 'cm',
  deliveredAt: '2026-03-10',
  items: [{ name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10, requestedPrice: 1200 }],
  returns: [],
  adjustments: [],
  ...over,
});

describe('wholesaleRevenueLines', () => {
  it('นับตามวันส่งของ ไม่ใช่วันเปิด PO', () => {
    const lines = wholesaleRevenueLines([order()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ on: '2026-03-10', kind: 'ขาย', amount: 12000 });
  });

  it('PO ที่ยังไม่ส่งของ ยังไม่เกิดรายได้', () => {
    // Not a zero and not a line dated today: nothing has been earned, so there
    // is nothing to place in any month.
    expect(wholesaleRevenueLines([order({ deliveredAt: null })])).toEqual([]);
    expect(wholesaleRevenueLines([order({ deliveredAt: '' })])).toEqual([]);
  });

  it('การคืนสินค้าลดยอดของเดือนที่คืน ไม่ใช่เดือนที่ขาย', () => {
    const lines = wholesaleRevenueLines([
      order({ returns: [{ item: 'ฟิล์ม 3M CRM (ม้วน)', qty: 2, date: '2026-05-04' }] }),
    ]);
    const ret = lines.find((l) => l.kind === 'คืนสินค้า')!;
    // Priced off the line it came back from, and dated May — reaching back into
    // March would change a month that has already been reported.
    expect(ret).toMatchObject({ on: '2026-05-04', amount: -2400 });
    expect(lines.reduce((n, l) => n + l.amount, 0)).toBe(9600);
  });

  it('ปรับราคาเป็นบรรทัดติดลบ ลงวันที่ของตัวเอง', () => {
    const lines = wholesaleRevenueLines([
      order({
        adjustments: [{ amount: 200, reason: 'ลูกค้าต่อรองหลังส่งของ', date: '2026-04-02' }],
      }),
    ]);
    // Positive on the PO screen means the bill went DOWN ("ใส่ตัวเลขบวกเพื่อลด
    // ยอดเรียกเก็บ"), so it subtracts here.
    expect(lines.find((l) => l.kind === 'ปรับราคา')).toMatchObject({
      on: '2026-04-02',
      amount: -200,
      item: 'ลูกค้าต่อรองหลังส่งของ',
    });
  });

  it('แถวเก่าที่ไม่มีวันที่ ใช้วันส่งของแทน ไม่ปล่อยให้ไม่มีวันที่', () => {
    // Rows written before 0045 carry no date of their own. Undated they would
    // fall out of every period filter and quietly vanish from the report.
    const lines = wholesaleRevenueLines([
      order({ returns: [{ item: 'ฟิล์ม 3M CRM (ม้วน)', qty: 1, date: null }] }),
    ]);
    expect(lines.find((l) => l.kind === 'คืนสินค้า')!.on).toBe('2026-03-10');
  });

  it('ข้ามรายการที่เป็นศูนย์ และสินค้าที่ไม่มีชื่อ', () => {
    const lines = wholesaleRevenueLines([
      order({
        items: [
          { name: '', qty: 5, requestedPrice: 100 },
          { name: 'ฟิล์ม FINNIX CT (ม้วน)', qty: 0, requestedPrice: 1500 },
        ],
        adjustments: [{ amount: 0, reason: '', date: '2026-04-02' }],
      }),
    ]);
    expect(lines).toEqual([]);
  });
});

describe('wholesaleRevenueLines — ปรับราคาที่รออนุมัติ', () => {
  it('ไม่ลดยอดขาย จนกว่าจะอนุมัติ', () => {
    // The bill and the takings have to move together: if an unapproved
    // reduction came off the revenue but not off the invoice, the two screens
    // would disagree about the same PO.
    const lines = wholesaleRevenueLines([
      order({
        adjustments: [
          { amount: 200, reason: 'ต่อรองหลังส่งของ', date: '2026-04-02', status: 'รออนุมัติ' },
        ],
      }),
    ]);
    expect(lines.find((l) => l.kind === 'ปรับราคา')).toBeUndefined();
    expect(lines.reduce((n, l) => n + l.amount, 0)).toBe(12000);
  });
});
