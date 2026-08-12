import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { PrintJobSheet, type PrintMode } from '@/components/tickets/PrintJobSheet';
import type { Ticket } from '@/components/tickets/types';

/**
 * These sheets are the only part of the app that leaves the building: the
 * technician works off the printed ใบงานติดตั้ง and the customer keeps the
 * ใบงานขาย. A wrong line here is not a display glitch, it is a car with the
 * wrong film on it or a dispute the shop cannot answer.
 *
 * The component portals into document.body, so queries go through `screen`
 * rather than the render container.
 */

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'JT-CM-00216',
    shop: 'cm',
    customer: 'คุณ ปรีชา',
    phone: '084-567-8901',
    plate: 'กก 999',
    carType: 'เก๋งใหญ่',
    brand: 'Honda',
    model: 'jazz',
    color: 'ขาว',
    serviceType: '',
    status: 'จองแล้ว',
    bookingChannel: 'Walk-in',
    techByCategory: {},
    dropOffDateObj: new Date('2026-08-12T09:00:00'),
    pickupDateObj: new Date('2026-08-14T17:00:00'),
    extras: {},
    items: [],
    payments: [],
    notes: '',
    ...overrides,
  };
}

const item = (over: Partial<Ticket['items'][number]> = {}) => ({
  category: 'ฟิล์มกันรอย',
  booked: '',
  bookedPrice: 0,
  sold: 'TPU กันรอยเกรดพรีเมียม',
  soldPrice: 29500,
  positions: [],
  ...over,
});

function renderSheet(t: Ticket, printMode: PrintMode = 'sale') {
  return render(
    <PrintJobSheet
      t={t}
      printMode={printMode}
      currentUserName="แอดมินระบบ"
      shopName={() => 'FINNIX FILM เชียงใหม่'}
      shopInfo={{}}
      stock={[]}
      extraOptions={[]}
      total={29500}
      paid={10000}
      docType="ใบเสร็จรับเงิน"
      buyerName=""
      buyerTaxId=""
      buyerAddress=""
      showCompanyInfo={false}
      showDisclaimer={false}
    />,
  );
}

describe('ใบงานขาย', () => {
  it('prints the day the car was received alongside the delivery date', () => {
    renderSheet(makeTicket({ items: [item()] }));
    // Both dates, so the sheet says how long the shop held the car.
    expect(screen.getByText(/วันที่รับงาน:/)).toBeInTheDocument();
    expect(screen.getByText(/วันที่ส่งงาน:/)).toBeInTheDocument();
  });

  it('itemises each receipt with what it was and how it arrived', () => {
    const t = makeTicket({
      items: [item()],
      payments: [
        { type: 'มัดจำ', method: 'โอนเงิน', amount: 3000, date: '2026-08-12' },
        { type: 'ชำระส่วนที่เหลือ', method: 'เงินสด', amount: 10000, date: '2026-08-14' },
      ],
    });
    renderSheet(t);
    // "มัดจำ" gains the verb; "ชำระส่วนที่เหลือ" already has one.
    expect(screen.getByText(/ชำระมัดจำ \(โอนเงิน\)/)).toBeInTheDocument();
    expect(screen.getByText(/ชำระส่วนที่เหลือ \(เงินสด\)/)).toBeInTheDocument();
  });

  it('leaves an empty payment row off the sheet', () => {
    const t = makeTicket({
      items: [item()],
      payments: [
        { type: 'มัดจำ', method: 'เงินสด', amount: 5000, date: '2026-08-12' },
        { type: 'มัดจำ', method: 'โอนเงิน', amount: 0, date: '' },
      ],
    });
    renderSheet(t);
    expect(screen.getByText(/ชำระมัดจำ \(เงินสด\)/)).toBeInTheDocument();
    expect(screen.queryByText(/ชำระมัดจำ \(โอนเงิน\)/)).not.toBeInTheDocument();
  });

  it('greens the cheer-up TOTAL and leaves its breakdown in ink', () => {
    const t = makeTicket({
      items: [item({ interested: 'TPU กันรอยเกรดมาตรฐาน', interestedPrice: 22000 })],
    });
    renderSheet(t);

    // `print-gain` is what survives the @media print colour flattening — an
    // inline colour alone would print black (see app/globals.css).
    const total = screen.getByText('ส่วนต่างเชียร์ขาย (Cheer-up)').parentElement!;
    expect(total).toHaveClass('print-gain');
    expect(total).toHaveStyle({ color: '#2F7A4F' });

    // The per-category row under it is detail, not a second highlight.
    const categoryRow = screen.getByText('ฟิล์มกันรอย', { selector: 'span' }).parentElement!;
    expect(categoryRow).not.toHaveClass('print-gain');
  });

  it('collects every category note under the ticket-wide one', () => {
    const t = makeTicket({
      items: [item(), item({ category: 'เครื่องเสียง', sold: 'ลำโพง JBL Stage' })],
      notes: 'เกสๆๆๆ',
      notesByCategory: { ฟิล์มกันรอย: 'เว้นขอบกันชนหน้า', เครื่องเสียง: 'เก็บลำโพงเดิมไว้ในรถ' },
    });
    renderSheet(t);
    expect(screen.getByText('เกสๆๆๆ')).toBeInTheDocument();
    expect(screen.getByText(/เว้นขอบกันชนหน้า/)).toBeInTheDocument();
    expect(screen.getByText(/เก็บลำโพงเดิมไว้ในรถ/)).toBeInTheDocument();
  });
});

describe('ใบงานติดตั้ง', () => {
  it('gives each category page only its own note', () => {
    const t = makeTicket({
      items: [item(), item({ category: 'เครื่องเสียง', sold: 'ลำโพง JBL Stage' })],
      notes: 'ลูกค้ารอรับรถ',
      notesByCategory: { ฟิล์มกันรอย: 'เว้นขอบกันชนหน้า', เครื่องเสียง: 'เก็บลำโพงเดิมไว้ในรถ' },
    });
    renderSheet(t, 'job');

    // Two pages, so the ticket-wide note appears on both...
    expect(screen.getAllByText('ลูกค้ารอรับรถ')).toHaveLength(2);
    // ...but each category note exactly once, on its own page.
    expect(screen.getAllByText('เว้นขอบกันชนหน้า')).toHaveLength(1);
    expect(screen.getAllByText('เก็บลำโพงเดิมไว้ในรถ')).toHaveLength(1);
  });

  it('ticks the Option / รายการแถม boxes chosen on the ticket', () => {
    const t = makeTicket({
      items: [item()],
      wrapOptions: ['แถม หน้าจอ', 'แกะ โลโก้'],
    });
    renderSheet(t, 'job');

    // The row appears on the installation page and again on the ใบเช็ครถ, and
    // every box prints whether ticked or not — the sheet is still a paper form.
    const rows = screen.getAllByText('Option / รายการแถม :');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0].parentElement!;
    expect(within(row).getByText('แถม หน้าจอ')).toBeInTheDocument();
    expect(within(row).getByText('แกะ มือจับประตู')).toBeInTheDocument();
    expect(within(row).getAllByText('✓')).toHaveLength(2);
  });

  it('leaves the tick row off a ticket with no ฟิล์มกันรอย work', () => {
    const t = makeTicket({ items: [item({ category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม 3M 60%' })] });
    renderSheet(t, 'job');
    expect(screen.queryByText('Option / รายการแถม :')).not.toBeInTheDocument();
  });
});

describe('ใบเช็ครถ (ฟิล์มกันรอย)', () => {
  it('lists all four door trims and spells Piano Black correctly', () => {
    renderSheet(makeTicket({ items: [item()] }), 'job');

    expect(screen.getByText('Piano Black')).toBeInTheDocument();
    expect(screen.queryByText('Pino Black')).not.toBeInTheDocument();
    for (const part of [
      'กาบประตูหน้าซ้าย',
      'กาบประตูหน้าขวา',
      'กาบประตูหลังซ้าย',
      'กาบประตูหลังขวา',
    ]) {
      expect(screen.getAllByText(part)).toHaveLength(1);
    }
  });
});
