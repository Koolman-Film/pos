import { describe, it, expect } from 'vitest';

import { summarizePayments } from '@/lib/domain/docPayment';

/** รายงานรายได้: การชำระเงินของเอกสารหนึ่งใบ (ร้านขอ 22 ก.ย. 2569). */
describe('summarizePayments', () => {
  it('reads a fully paid job, naming every method once', () => {
    expect(
      summarizePayments(6400, [
        { amount: 2000, method: 'เงินสดหน้าร้าน' },
        { amount: 4400, method: 'โอน กสิกร' },
        { amount: 0, method: 'โอน TTB' },
      ]),
    ).toEqual({ methods: 'เงินสดหน้าร้าน, โอน กสิกร', status: 'ชำระครบ', paid: 6400, due: 0 });
  });

  it('says what is still owed', () => {
    expect(summarizePayments(21900, [{ amount: 3000, method: 'เงินสด' }])).toMatchObject({
      status: 'ค้างชำระ',
      paid: 3000,
      due: 18900,
    });
  });

  it('says nothing has been paid, rather than showing an empty method', () => {
    expect(summarizePayments(4500, [])).toEqual({
      methods: '',
      status: 'ยังไม่ชำระ',
      paid: 0,
      due: 4500,
    });
  });

  it('never owes a negative amount when more came in than the lines add up to', () => {
    // A ticket's payments can include a ประกัน premium, which is not a line.
    expect(summarizePayments(3500, [{ amount: 6000, method: 'โอน' }])).toMatchObject({
      status: 'ชำระครบ',
      due: 0,
    });
  });
});
