import { describe, it, expect } from 'vitest';

import type { SaleLine } from '@/app/(app)/revenue/data';
import { groupRevenueReport, UNPAID_SOURCE } from '@/components/revenue/revenueReport';

/**
 * รายงานรายได้ (ร้านขอ 22 ก.ย. 2569): สาขา → แหล่งเงิน → วันที่, and a
 * document's money counted once however many product lines it has.
 */

const base: SaleLine = {
  ticketId: 'JT-CM-00001',
  shop: 'cm',
  soldAt: '2026-09-05',
  customer: 'คุณ เอ',
  plate: '',
  category: 'ฟิล์มกรองแสง',
  product: 'ฟิล์ม',
  amount: 1000,
  cost: 0,
  held: false,
  taxInvoiceNo: '',
  finnixDocNo: '',
  paidIntoFinnix: 0,
  documents: [],
  channel: 'ปลีก',
};
const l = (over: Partial<SaleLine>): SaleLine => ({ ...base, ...over });

describe('groupRevenueReport', () => {
  const pay = { methods: 'เงินสดหน้าร้าน', status: 'ค้างชำระ', paid: 1500, due: 500 };

  it('counts a ticket’s paid and owed once, on the first of its lines in date order', () => {
    const r = groupRevenueReport(
      [
        l({ product: 'ลำโพง', amount: 1000, payment: pay }),
        l({ product: 'ฟิล์ม', amount: 1000, payment: pay }),
      ],
      ['cm'],
    );
    const rows = r.sections[0].tables[0].rows;
    expect(rows.map((x) => x.paid)).toEqual([1500, 0]);
    expect(r).toMatchObject({ amount: 2000, paid: 1500, due: 500 });
  });

  it('files a job nothing has been paid on under ยังไม่ชำระ, after the sources', () => {
    const r = groupRevenueReport(
      [l({ ticketId: 'JT-2' }), l({ ticketId: 'JT-1', payment: pay })],
      ['cm'],
    );
    expect(r.sections[0].tables.map((t) => t.source)).toEqual(['เงินสดหน้าร้าน', UNPAID_SOURCE]);
  });

  it('keeps branches in the app’s order', () => {
    const r = groupRevenueReport(
      [l({ shop: 'lp' }), l({ shop: 'cm', ticketId: 'JT-9' })],
      ['cm', 'lp'],
    );
    expect(r.sections.map((s) => s.shopId)).toEqual(['cm', 'lp']);
  });
});
