import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PaymentsSection } from '@/components/tickets/detail/PaymentsSection';
import type { Ticket, TicketPayment } from '@/components/tickets/types';

/**
 * วันที่รับเงิน (ร้านแจ้ง 19 ก.ย. 2569).
 *
 * "หากมีการแก้ไขการรับเงินแบบข้ามวัน จะทำให้จำนวนเงินผิดไปจากเดิมทันที เนื่องจาก
 * จะถูกบันทึกเป็นวันที่ปัจจุบันเท่านั้น" — the row carried a date all along, in
 * the database, but the form had no field for it: whichever day somebody typed
 * the payment in became the day the money arrived. A transfer that came in on
 * Friday evening and was entered on Monday landed on Monday, and at a month end
 * in the wrong month. ยอดขาย and สมุดบัญชีแหล่งเงิน both count money on that
 * day, so nothing downstream could be right either.
 */

const ticket = (payments: TicketPayment[]) =>
  ({ shop: 'cm', revenueKind: 'รายได้', payments }) as unknown as Ticket;

function renderSection(payments: TicketPayment[]) {
  const updatePayment = vi.fn();
  render(
    <PaymentsSection
      t={ticket(payments)}
      shop="cm"
      paymentMethods={['เงินสด', 'โอน']}
      addPayment={vi.fn()}
      updatePayment={updatePayment}
      setRevenueKind={vi.fn()}
      total={6500}
      paid={6500}
    />,
  );
  return { updatePayment };
}

const row = (over: Partial<TicketPayment> = {}): TicketPayment => ({
  type: 'ชำระเต็มจำนวน',
  method: 'เงินสด',
  amount: 6500,
  date: '2026-07-26',
  uid: 'pONE',
  attachments: [],
  ...over,
});

const dateField = (n = 1) => screen.getByLabelText(`วันที่รับเงินรายการที่ ${n}`);

describe('PaymentsSection — วันที่รับเงิน', () => {
  it('shows the day the money actually came in', () => {
    renderSection([row()]);
    expect(dateField()).toHaveValue('2026-07-26');
    // The Thai caption is what stops 07/26 being read as a different month.
    expect(screen.getByText('26 ก.ค. 2569')).toBeInTheDocument();
  });

  it('lets the counter move it to the day the transfer arrived', () => {
    const { updatePayment } = renderSection([row()]);
    fireEvent.change(dateField(), { target: { value: '2026-07-24' } });
    expect(updatePayment).toHaveBeenLastCalledWith(0, 'date', '2026-07-24');
  });

  it('gives every row its own date, not one for the ticket', () => {
    renderSection([row(), row({ uid: 'pTWO', type: 'มัดจำ', date: '2026-06-01' })]);
    expect(dateField(1)).toHaveValue('2026-07-26');
    expect(dateField(2)).toHaveValue('2026-06-01');
  });
});
