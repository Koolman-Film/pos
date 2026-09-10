import { describe, it, expect } from 'vitest';

import { pendingCheques } from '@/components/wholesale/cheques';
import type { WsOrder } from '@/components/wholesale/types';

/**
 * เช็คที่รอยืนยัน (migration 0048).
 *
 * The list exists for one row in particular: a cheque that came due last week
 * and was never confirmed. That is either money nobody banked or a cheque that
 * bounced unrecorded, and in every other view it is invisible — the customer
 * simply looks like a slow payer.
 */
const order = (id: string, payments: WsOrder['payments']) =>
  ({
    id,
    shop: 'north',
    customerId: 1,
    status: 'ค้างชำระ',
    items: [],
    returns: [],
    adjustments: [],
    payments,
  }) as unknown as WsOrder;

const cheque = (amount: number, chequeDate: string, status = 'แจ้งแล้ว') => ({
  amount,
  method: 'เช็คธนาคารกสิกร',
  date: '2026-09-01',
  status,
  chequeNo: '0012345',
  chequeBank: 'KBANK',
  chequeDate,
  attachments: [],
});

describe('pendingCheques', () => {
  it('เรียงตามวันที่หน้าเช็ค และทำเครื่องหมายใบที่เลยกำหนด', () => {
    const res = pendingCheques(
      [
        order('WS-N-0001', [cheque(30000, '2026-10-15')]),
        order('WS-N-0002', [cheque(20000, '2026-09-01')]),
      ],
      '2026-09-10',
    );
    expect(res.rows.map((r) => r.orderId)).toEqual(['WS-N-0002', 'WS-N-0001']);
    expect(res.rows[0].overdue).toBe(true);
    expect(res.rows[1].overdue).toBe(false);
    expect(res.total).toBe(50000);
    // The figure that means somebody has to pick up the phone.
    expect(res.overdueTotal).toBe(20000);
  });

  it('ไม่นับรายการที่ยืนยันแล้วหรือเด้งแล้ว', () => {
    const res = pendingCheques(
      [
        order('WS-N-0003', [
          cheque(10000, '2026-09-01', 'รับเงินแล้ว'),
          cheque(9000, '2026-09-02', 'เด้ง'),
          cheque(500, '2026-09-03'),
        ]),
      ],
      '2026-09-10',
    );
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBe(500);
  });

  it('รายการที่ไม่มีวันที่ ไม่ถือว่าเลยกำหนด และอยู่ท้ายรายการ', () => {
    // Undated is not late: it makes no claim about when the money is due, and
    // marking it overdue sends somebody chasing a cheque that may not be.
    const undated = { ...cheque(1000, ''), date: '', chequeDate: '' };
    const res = pendingCheques(
      [order('WS-N-0004', [undated]), order('WS-N-0005', [cheque(2000, '2026-09-01')])],
      '2026-09-10',
    );
    expect(res.rows.map((r) => r.orderId)).toEqual(['WS-N-0005', 'WS-N-0004']);
    expect(res.rows[1].overdue).toBe(false);
  });

  it('ใช้วันที่รับชำระเมื่อไม่ใช่เช็ค', () => {
    // Cash a sale has reported but nobody has counted yet is on the same list:
    // it is money the shop is told it has and has not confirmed.
    const cash = {
      amount: 800,
      method: 'เงินสด',
      date: '2026-09-05',
      status: 'แจ้งแล้ว',
      attachments: [],
    };
    const res = pendingCheques([order('WS-N-0006', [cash])], '2026-09-10');
    expect(res.rows[0].due).toBe('2026-09-05');
    expect(res.rows[0].overdue).toBe(true);
  });
});
