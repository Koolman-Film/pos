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

/**
 * เตือนเมื่อรับเงินแล้วแต่ยังไม่แนบหลักฐาน (ร้านขอ 9 ต.ค. 2569).
 *
 * "ป้องกันการลืม" — ช่องแนบไฟล์มีมาตั้งแต่ 0018 แต่ไม่เคยมีอะไรบอกว่าแถวไหน
 * ยังว่าง คนกรอกยอดแล้วตั้งใจจะแนบทีหลังจึงลืมได้ฟรี ๆ
 */
describe('PaymentsSection — หลักฐานการรับเงิน', () => {
  it('แถวที่รับเงินแล้วไม่มีไฟล์ ขึ้นคำเตือนที่แถวนั้น', () => {
    renderSection([row({ attachments: [] })]);
    expect(screen.getByText('ยังไม่ได้แนบหลักฐานการรับเงิน')).toBeInTheDocument();
  });

  it('แนบแล้วคำเตือนหายไป', () => {
    renderSection([row({ attachments: ['cm/slip.jpg'] })]);
    expect(screen.queryByText('ยังไม่ได้แนบหลักฐานการรับเงิน')).toBeNull();
  });

  it('แถวเปล่าไม่เตือน', () => {
    // คำเตือนที่ขึ้นก่อนจะมีอะไรให้ลืม คือคำเตือนที่ติดอยู่ตลอดจนไม่มีใครอ่าน
    renderSection([row({ amount: 0, attachments: [] })]);
    expect(screen.queryByText('ยังไม่ได้แนบหลักฐานการรับเงิน')).toBeNull();
  });

  it('สรุปจำนวนแถวที่ยังขาดไว้ใต้ตาราง', () => {
    renderSection([
      row({ uid: 'a', attachments: [] }),
      row({ uid: 'b', attachments: ['cm/slip.jpg'] }),
      row({ uid: 'c', attachments: [] }),
    ]);
    expect(
      screen.getByText(/มีการรับเงิน 2 รายการที่ยังไม่ได้แนบหลักฐานการรับเงิน/),
    ).toBeInTheDocument();
  });

  it('แนบครบทุกแถว ไม่มีบรรทัดสรุป', () => {
    renderSection([row({ attachments: ['cm/slip.jpg'] })]);
    expect(screen.queryByText(/ยังไม่ได้แนบหลักฐานการรับเงิน/)).toBeNull();
  });
});

/**
 * รับเงินเกินยอด (ร้านแจ้ง 9 ต.ค. 2569).
 *
 * "ปัจจุบันแสดงแค่ชำระครบ และไม่ได้มีการแจ้งจำนวนเงินที่เกินมาเลย" — งาน 6,400
 * ที่รับเงินมา 34,400 ขึ้นว่า "ชำระครบแล้ว" เหมือนใบที่รับมาพอดี พิมพ์ผิดหนึ่ง
 * หลักจึงกลายเป็นสิ่งที่หน้าจอรับรองว่าถูกต้อง
 */
describe('PaymentsSection — รับเงินเกินยอด', () => {
  function renderWith(total: number, paid: number) {
    render(
      <PaymentsSection
        t={ticket([row({ amount: paid, attachments: ['cm/slip.jpg'] })])}
        shop="cm"
        paymentMethods={['เงินสด']}
        addPayment={vi.fn()}
        updatePayment={vi.fn()}
        total={total}
        paid={paid}
      />,
    );
  }

  it('บอกจำนวนที่เกิน แทนที่จะบอกว่าครบ', () => {
    renderWith(6400, 34400);
    expect(screen.getByText('รับเงินเกิน 28,000.00')).toBeInTheDocument();
    expect(screen.queryByText('ชำระครบแล้ว')).toBeNull();
  });

  it('ขึ้นแถบเตือนพร้อมบอกว่าต้องทำอะไรต่อ', () => {
    renderWith(6400, 34400);
    expect(screen.getByRole('alert')).toHaveTextContent('รับเงินมาเกินยอดสุทธิ 28,000.00');
  });

  it('รับมาพอดียังเป็นชำระครบแล้วเหมือนเดิม', () => {
    renderWith(6400, 6400);
    expect(screen.getByText('ชำระครบแล้ว')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ยังขาดอยู่ก็ยังบอกยอดคงเหลือเหมือนเดิม', () => {
    renderWith(6400, 4000);
    expect(screen.getByText('คงเหลือ 2,400.00')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * รายได้ Finnix เทียบกับเงินที่เข้าบัญชี Finnix (ร้านขอ 14 ต.ค. 2569).
 *
 * "รายได้ finnix 5,000 · การรับเงินแหล่งรับเงินเป็นบัญชีที่ผูกกับ finnix แล้ว
 * 2,000 · ให้คำนวณเป็นเหลือที่ต้องจ่ายคืน finnix อยู่ 3,000"
 */
describe('PaymentsSection — เหลือต้องจ่ายคืน Finnix', () => {
  const accounts = [
    { id: 1, shop: 'cm', name: 'เงินสด', kind: 'cash', accountNo: '' },
    {
      id: 2,
      shop: 'cm',
      name: 'โอน Finnix',
      kind: 'bank',
      accountNo: '',
      owner: 'Finnix' as const,
    },
  ];

  const withFinnix = (payments: TicketPayment[]) =>
    ({
      shop: 'cm',
      revenueKind: 'รายได้',
      // ขายรวม 10,000 โดย 5,000 เป็นของ Finnix
      items: [
        { soldPrice: 6000, finnixAmount: 1500 },
        { soldPrice: 4000, finnixAmount: 3500 },
      ],
      payments,
    }) as unknown as Ticket;

  function renderWith(payments: TicketPayment[]) {
    render(
      <PaymentsSection
        t={withFinnix(payments)}
        shop="cm"
        paymentMethods={['เงินสด', 'โอน Finnix']}
        payAccounts={accounts}
        addPayment={vi.fn()}
        updatePayment={vi.fn()}
        total={10000}
        paid={payments.reduce((n, p) => n + Number(p.amount || 0), 0)}
      />,
    );
  }

  it('หักเงินที่เข้าบัญชีของ Finnix แล้ว เหลือยอดที่ต้องคืน', () => {
    renderWith([
      row({ uid: 'a', method: 'โอน Finnix', amount: 2000 }),
      row({ uid: 'b', method: 'เงินสด', amount: 3000 }),
    ]);
    const panel = screen.getByLabelText('สรุปรายได้ Finnix ของใบงานนี้');
    expect(panel).toHaveTextContent('5,000.00');
    expect(panel).toHaveTextContent('2,000.00');
    expect(panel).toHaveTextContent('เหลือต้องจ่ายคืน Finnix');
    expect(panel).toHaveTextContent('3,000.00');
  });

  it('เงินสดล้วน = ยังไม่ได้คืนสักบาท', () => {
    renderWith([row({ method: 'เงินสด', amount: 10000 })]);
    const panel = screen.getByLabelText('สรุปรายได้ Finnix ของใบงานนี้');
    expect(panel).toHaveTextContent('เหลือต้องจ่ายคืน Finnix');
    expect(panel).toHaveTextContent('5,000.00');
  });

  it('เข้าบัญชี Finnix เกินยอดที่ขาย บอกตรง ๆ ไม่ซ่อน', () => {
    // เข้าบัญชี Finnix มากกว่าที่ขายเป็นของเขา แปลว่ามีอะไรผิด
    renderWith([row({ method: 'โอน Finnix', amount: 6000 })]);
    expect(screen.getByLabelText('สรุปรายได้ Finnix ของใบงานนี้')).toHaveTextContent(
      'เข้าบัญชี Finnix เกินยอดที่ขาย',
    );
  });

  it('ใบงานที่ไม่มีรายได้ Finnix เลย ไม่มีกล่องนี้', () => {
    render(
      <PaymentsSection
        t={ticket([row({ amount: 6500 })])}
        shop="cm"
        paymentMethods={['เงินสด']}
        payAccounts={accounts}
        addPayment={vi.fn()}
        updatePayment={vi.fn()}
        total={6500}
        paid={6500}
      />,
    );
    expect(screen.queryByLabelText('สรุปรายได้ Finnix ของใบงานนี้')).toBeNull();
  });
});
