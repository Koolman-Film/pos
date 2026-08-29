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

function renderSheet(t: Ticket, printMode: PrintMode = 'sale', overrides = {}) {
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
      {...overrides}
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

  it('counts the ชนิดสินค้า and numbers them when there is more than one', () => {
    const t = makeTicket({
      items: [item(), item({ category: 'เครื่องเสียง', sold: 'ลำโพง JBL Stage', soldPrice: 4500 })],
    });
    renderSheet(t);

    // The strip says how many and what each came to...
    const strip = screen.getByText('งานนี้มี 2 ชนิดสินค้า').parentElement!;
    expect(within(strip).getByText('29,500.00')).toBeInTheDocument();
    expect(within(strip).getByText('4,500.00')).toBeInTheDocument();
    // ...and the numbers appear twice each: once in the strip, once on the block.
    expect(screen.getAllByText('1')).toHaveLength(2);
    expect(screen.getAllByText('2')).toHaveLength(2);
  });

  it('leaves the map off a single-category ticket', () => {
    renderSheet(makeTicket({ items: [item()] }));
    expect(screen.queryByText(/^งานนี้มี/)).not.toBeInTheDocument();
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
    // Two categories, so the total (+9,000) and each category row are distinct
    // figures and the assertions cannot land on the wrong element.
    const t = makeTicket({
      items: [
        item({ interested: 'TPU กันรอยเกรดมาตรฐาน', interestedPrice: 22000 }),
        item({
          category: 'เครื่องเสียง',
          sold: 'ลำโพง JBL Stage',
          soldPrice: 4500,
          interested: 'ลำโพงติดรถเดิม',
          interestedPrice: 3000,
        }),
      ],
    });
    renderSheet(t);

    // `print-gain` is what survives the @media print colour flattening — an
    // inline colour alone would print black (see app/globals.css).
    const total = screen.getByText('ส่วนต่างเชียร์ขาย (Cheer-up)').parentElement!;
    expect(total).toHaveClass('print-gain');
    expect(total).toHaveStyle({ color: '#2F7A4F' });
    expect(total).toHaveTextContent('+9,000.00');

    // The per-category rows under it are detail, not more highlights.
    for (const [figure, category] of [
      ['+7,500.00', 'ฟิล์มกันรอย'],
      ['+1,500.00', 'เครื่องเสียง'],
    ]) {
      const row = screen.getByText(figure).parentElement!;
      expect(row).toHaveTextContent(category);
      expect(row).not.toHaveClass('print-gain');
    }
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
  it('carries both dates on every category page, like the sale sheet', () => {
    const t = makeTicket({
      items: [item(), item({ category: 'เครื่องเสียง', sold: 'ลำโพง JBL Stage' })],
    });
    renderSheet(t, 'job');
    // Two installation pages; the ใบเช็ครถ has its own vehicle header.
    expect(screen.getAllByText(/วันที่รับงาน:/)).toHaveLength(2);
    expect(screen.getAllByText(/วันที่ส่งงาน:/)).toHaveLength(2);
  });

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

describe('เอกสารทางการเงิน', () => {
  const shopInfo = {
    cm: {
      companyName: 'บริษัท คูลมาน จำกัด',
      address: '4/9 ถนนมหิดล ตำบลป่าแดด อำเภอเมืองเชียงใหม่',
      phone: '098-262-5623',
      taxId: '0505561000000',
      paymentChannels: ['เงินสด', 'โอนเงิน', 'บัตรเครดิต'],
    },
  };

  const renderDoc = (over = {}) =>
    renderSheet(
      makeTicket({
        items: [item()],
        payments: [{ type: 'มัดจำ', method: 'โอนเงิน', amount: 3000, date: '2026-08-12' }],
      }),
      'doc',
      { shopInfo, docType: 'ใบกำกับภาษี/ใบเสร็จรับเงิน', showCompanyInfo: true, ...over },
    );

  it('puts the branch above the legal entity in the issuer block', () => {
    const { container } = renderDoc();
    const issuer = screen.getByText('ผู้ออกใบเสร็จรับเงิน :').parentElement!;
    const lines = Array.from(issuer.querySelectorAll('p')).map((p) => p.textContent);
    // The customer knows the shop by its branch; the นิติบุคคล line is there
    // because the tax id belongs to it.
    expect(lines[1]).toBe('FINNIX FILM เชียงใหม่');
    expect(lines[2]).toBe('บริษัท คูลมาน จำกัด');
    expect(container).toBeTruthy();
  });

  it('signs off with a line and a role, naming no company or branch', () => {
    renderDoc();
    expect(screen.getByText(/^ลงชื่อ/)).toBeInTheDocument();
    expect(screen.getByText(/ผู้รับเงิน ·/)).toBeInTheDocument();
    // The old sheet repeated the issuer here — "ผู้รับเงินในนาม บริษัท …" —
    // which said again what the header already says.
    expect(screen.queryByText(/ในนาม/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/บริษัท คูลมาน จำกัด/)).toHaveLength(1);
  });

  it('numbers the document from the ticket id, without doubling the shop code', () => {
    renderDoc();
    // t.id is JT-CM-00216, so INV-CM-00216 — not INV-CM-CM-00216.
    expect(screen.getByText('เลขที่เอกสาร: INV-CM-00216')).toBeInTheDocument();
    expect(screen.getByText(/^วันที่เอกสาร:/)).toBeInTheDocument();
  });

  it('lists only the channels the money actually arrived by', () => {
    renderDoc();
    const box = screen.getByText('ช่องทางการชำระเงิน').parentElement!;
    // A receipt records what happened; the shop's other two channels have no
    // business on it, and empty boxes beside them said nothing.
    expect(within(box).getByText('โอนเงิน')).toBeInTheDocument();
    expect(within(box).queryByText('เงินสด')).not.toBeInTheDocument();
    expect(within(box).queryByText('บัตรเครดิต')).not.toBeInTheDocument();
    expect(within(box).getAllByText('✓')).toHaveLength(1);
    expect(within(box).getByText(/ชำระมัดจำ 3,000.00 บาท \(โอนเงิน\)/)).toBeInTheDocument();
  });

  it('keeps a channel that has since been dropped from the shop settings', () => {
    // The receipt is a record of that day. Reading the channels off the payments
    // rather than จัดการสิทธิ์ means an old document still reads correctly.
    renderDoc({
      shopInfo: { cm: { ...shopInfo.cm, paymentChannels: ['เงินสด'] } },
    });
    const box = screen.getByText('ช่องทางการชำระเงิน').parentElement!;
    expect(within(box).getByText('โอนเงิน')).toBeInTheDocument();
  });
});

/**
 * The three car outlines the technician marks up. They were inline base64 in
 * the prototype (~520KB), so the port replaced them with dashed boxes reading
 * "แผนผังตัวรถ" and left a note to re-add them as assets — which meant the
 * printed ใบเช็ครถ had nowhere to record where a scratch actually was.
 */
describe('ใบเช็ครถ — แผนผังตัวรถ', () => {
  const diagrams = ['/wrap/wrap-interior.png', '/wrap/wrap-body.png', '/wrap/wrap-exterior.png'];

  it('prints all three diagrams, in the order the paper form has them', () => {
    renderSheet(makeTicket({ items: [item()] }), 'job');

    const srcs = screen
      .getAllByRole('img')
      .map((el) => el.getAttribute('src'))
      .filter((s) => s?.startsWith('/wrap/'));
    expect(srcs).toEqual(diagrams);
  });

  it('replaces the placeholder boxes rather than sitting beside them', () => {
    renderSheet(makeTicket({ items: [item()] }), 'job');
    expect(screen.queryByText(/^แผนผังตัวรถ \(/)).not.toBeInTheDocument();
  });

  it('spells out what the L/R/B/F on the drawings mean', () => {
    renderSheet(makeTicket({ items: [item()] }), 'job');
    // The letters are part of the artwork; only Thai readers of the sheet need
    // telling which is which.
    expect(screen.getByText(/L = ซ้าย/)).toBeInTheDocument();
    expect(screen.getByText(/B = หลัง/)).toBeInTheDocument();
  });

  it('keeps both part tables on the sheet alongside the drawings', () => {
    renderSheet(makeTicket({ items: [item()] }), 'job');
    expect(screen.getByText('ภายในตัวรถ')).toBeInTheDocument();
    expect(screen.getByText('ภายนอกตัวรถ')).toBeInTheDocument();
    expect(screen.getByText('Piano Black')).toBeInTheDocument();
    expect(screen.getByText('ล้อหลังขวา')).toBeInTheDocument();
  });

  it('leaves them off a ticket with no ฟิล์มกันรอย work', () => {
    renderSheet(
      makeTicket({ items: [item({ category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม 3M' })] }),
      'job',
    );
    expect(screen.queryByAltText(/แผนผัง/)).not.toBeInTheDocument();
  });
});

/**
 * ใบเซอร์วิส ลูกค้าหน้าร้าน. Two ways of working had to keep working: print a
 * blank sheet and fill it in at the car, or record the visit here and print it
 * filled. Both come off the same form so a filed stack reads consistently.
 */
describe('ใบเซอร์วิส', () => {
  const visit = {
    id: 1,
    visitNo: 2,
    plate: 'กก 999',
    receivedAt: '2026-08-20',
    receivedTime: '09:00',
    deliveredAt: '2026-08-20',
    deliveredTime: '16:30',
    salesBy: 'พนักงานขาย',
    qcBy: 'ช่างเอก',
    technicians: ['ช่างเอก'],
    filmProduct: 'TPU กันรอยเกรดพรีเมียม 195',
    customerWaits: true,
    overallOk: true,
    checks: { 'หน้าจอ 1': 'ปกติ', Sunroof: 'ผิดปกติ' },
    notes: 'ลูกค้าขอเร่ง',
    points: [{ seq: 1, position: 'กันชนหน้า', detail: 'ฟิล์มเผยอ', note: 'แก้แล้ว' }],
  };

  const renderService = (over = {}) =>
    renderSheet(makeTicket({ items: [item()] }), 'service', {
      technicianOptions: ['ช่างเอก', 'ช่างบอย'],
      ...over,
    });

  it('takes the customer and car straight from the ticket', () => {
    renderService({ serviceVisit: visit });
    expect(screen.getByText('ใบเซอร์วิส ลูกค้าหน้าร้าน')).toBeInTheDocument();
    expect(screen.getByText('คุณ ปรีชา')).toBeInTheDocument();
    expect(screen.getByText('กก 999')).toBeInTheDocument();
  });

  it('prints a recorded visit with its number, checks and points', () => {
    renderService({ serviceVisit: visit });
    expect(screen.getByText('2')).toBeInTheDocument(); // ครั้งที่
    expect(screen.getByText('ปกติ')).toBeInTheDocument();
    expect(screen.getByText('ผิดปกติ')).toBeInTheDocument();
    expect(screen.getByText('กันชนหน้า')).toBeInTheDocument();
    expect(screen.getByText('ฟิล์มเผยอ')).toBeInTheDocument();
  });

  it('prints a blank sheet when no visit is given', () => {
    renderService({ serviceVisit: null });
    // Still headed with the car, because that much is known either way.
    expect(screen.getByText('กก 999')).toBeInTheDocument();
    // ...and nothing a technician has to write at the car is pre-answered.
    expect(screen.queryByText('ฟิล์มเผยอ')).not.toBeInTheDocument();
    expect(screen.queryByText(/^ครั้งที่/)).not.toBeInTheDocument();
  });

  it('lists ทีมช่าง from the shop, not the names the paper form was printed with', () => {
    renderService({ serviceVisit: visit });
    // Scoped to the tick row: ช่างเอก is also this visit's QC person.
    const row = screen.getByText('ทีมช่าง :').parentElement!;
    expect(within(row).getByText('ช่างเอก')).toBeInTheDocument();
    expect(within(row).getByText('ช่างบอย')).toBeInTheDocument();
    // Every technician prints, ticked or not, and only the one who worked is
    // ticked — the same rule as the wrap sheet's Option row.
    expect(within(row).getAllByText('✓')).toHaveLength(1);
    // The paper form's own seven names are gone.
    expect(screen.queryByText('จอจอ')).not.toBeInTheDocument();
  });

  it('always prints all ten จุดพิเศษ rows so the sheet can be written on', () => {
    renderService({ serviceVisit: visit });
    for (const n of [1, 5, 10]) expect(screen.getByText(`${n}.`)).toBeInTheDocument();
  });

  it('names the film by its ชื่อสินค้า, which already states the thickness', () => {
    renderService({ serviceVisit: visit });
    // One SKU per thickness, so a separate ประเภท / ความหนา / รหัสสี row would
    // only ask for the same fact three times.
    expect(screen.getByText('ฟิล์มที่ใช้')).toBeInTheDocument();
    expect(screen.getByText('TPU กันรอยเกรดพรีเมียม 195')).toBeInTheDocument();
    expect(screen.queryByText('ความหนา')).not.toBeInTheDocument();
    expect(screen.queryByText('รหัสสี')).not.toBeInTheDocument();
  });

  it('carries the same car diagrams as the ใบเช็ครถ', () => {
    renderService({ serviceVisit: null });
    const srcs = screen
      .getAllByRole('img')
      .map((el) => el.getAttribute('src'))
      .filter((s) => s?.startsWith('/wrap/'));
    expect(srcs).toHaveLength(3);
  });
});

/**
 * ใบเคลมประกัน is the ใบเซอร์วิส form with the cover printed on it: the
 * technician does the same walk-around, and everyone can see what is left
 * before anything is promised. Two layouts would have been two forms to keep in
 * step, so what matters here is that it stays the same sheet.
 */
describe('ใบเคลมประกัน', () => {
  const pol = {
    id: 4,
    ticketId: 'JT-CM-00216',
    plate: 'กก 999',
    planName: 'ประกันฟิล์มกันรอย 1 ปี',
    price: 3000,
    bigPieces: 2,
    smallPieces: 20,
    terms: 'ไม่คุ้มครองอุบัติเหตุ',
    soldAt: '2026-08-01',
    startsAt: '2026-08-01',
    endsAt: '2027-08-01',
    notes: '',
    claims: [
      {
        id: 1,
        claimedAt: '2026-09-01',
        bigUsed: 1,
        smallUsed: 3,
        detail: 'กันชนหน้า',
        technician: 'ช่างเอก',
      },
    ],
  };

  const renderClaim = (over = {}) =>
    renderSheet(makeTicket({ items: [item()] }), 'claim', {
      insurancePolicy: pol,
      technicianOptions: ['ช่างเอก', 'ช่างบอย'],
      ...over,
    });

  it('carries the cover, what is used and what is left', () => {
    renderClaim({ insuranceClaim: pol.claims[0] });
    expect(screen.getByText('ใบเคลมประกันฟิล์มกันรอย')).toBeInTheDocument();
    expect(screen.getByText(/ประกันฟิล์มกันรอย 1 ปี/)).toBeInTheDocument();
    expect(screen.getByText(/ครอบคลุม 2 ชิ้นใหญ่, 20 ชิ้นเล็ก/)).toBeInTheDocument();
    // 2 − 1 and 20 − 3: the figure the shop has to honour.
    expect(screen.getByText(/1 ชิ้นใหญ่, 17 ชิ้นเล็ก/)).toBeInTheDocument();
  });

  it('is the same sheet as the ใบเซอร์วิส, boxes and all', () => {
    renderClaim({ insuranceClaim: null });
    // The walk-around tables and the ten numbered rows print blank, so the
    // sheet can be filled in at the car.
    expect(screen.getByText('Piano Black')).toBeInTheDocument();
    expect(screen.getByText('Sunroof')).toBeInTheDocument();
    for (const n of [1, 5, 10]) expect(screen.getByText(`${n}.`)).toBeInTheDocument();
    const srcs = screen
      .getAllByRole('img')
      .map((el) => el.getAttribute('src'))
      .filter((x) => x?.startsWith('/wrap/'));
    expect(srcs).toHaveLength(3);
  });

  it('leaves this-claim blank on a sheet printed before anything is recorded', () => {
    renderClaim({ insuranceClaim: null });
    // Scoped to its own field: "ใช้ไปแล้ว" above it legitimately carries the
    // running total of the claims already on the policy.
    const row = screen.getByText('เคลมครั้งนี้');
    expect(row.textContent?.replace('เคลมครั้งนี้', '').trim()).toBe('');
    expect(screen.getByText(/1 ชิ้นใหญ่, 3 ชิ้นเล็ก/)).toBeInTheDocument();
  });
});

/**
 * The financial documents are the ones a customer takes away, and some of those
 * customers do not read Thai. Every heading therefore carries its English —
 * under the Thai, smaller and greyer, so the Thai stays the label on a Thai
 * shop’s receipt.
 */
describe('เอกสารการเงิน — ภาษาอังกฤษกำกับ', () => {
  const renderDoc = (over = {}) =>
    renderSheet(makeTicket({ items: [item()] }), 'doc', {
      total: 29500,
      paid: 29500,
      payments: [{ type: 'ชำระส่วนที่เหลือ', method: 'เงินสด', amount: 29500, date: '2026-08-14' }],
      ...over,
    });

  it('names the document in both languages', () => {
    renderDoc();
    expect(screen.getByText('ใบเสร็จรับเงิน')).toBeInTheDocument();
    expect(screen.getByText('RECEIPT')).toBeInTheDocument();
  });

  it('translates the document name, not just the label', () => {
    renderDoc({ docType: 'ใบเสนอราคา' });
    expect(screen.getByText('QUOTATION')).toBeInTheDocument();
  });

  it('carries English on every heading a customer reads', () => {
    renderDoc();
    for (const en of [
      'No.',
      'Date',
      'Customer',
      'Issued by',
      'Qty',
      'Description',
      'Unit Price',
      'Amount',
      'Grand Total',
      'Payment Method',
      'Signature',
    ]) {
      expect(screen.getAllByText(new RegExp(en)).length).toBeGreaterThan(0);
    }
  });

  it('keeps the Thai as the heading and the English as the gloss', () => {
    renderDoc();
    // Same element, Thai first — not a second column and not a replacement.
    const total = screen.getByText('ยอดรวมสุทธิ').textContent ?? '';
    expect(total.startsWith('ยอดรวมสุทธิ')).toBe(true);
    expect(total).toContain('Grand Total');
  });
});

/**
 * ใบงานติดตั้ง — สินค้าที่ซ้ำกับบรรทัดบน.
 *
 * The position table repeats the film across several rows, so a repeat is
 * collapsed rather than printed five times. It used to collapse to a ditto mark:
 * on a sheet worked from at the car, a lone ″ reads as an empty cell or as
 * inches, and the technician fitting the wrong film is the cost of that guess.
 */

/**
 * The product column of ใบงานติดตั้ง.
 *
 * Read at the car by whoever is fitting the film, so both of these are about
 * one thing: the technician must not have to work anything out.
 */
describe('ใบงานติดตั้ง — คอลัมน์สินค้า', () => {
  /** The product cell of every row in the position table, as text. */
  function productCells(): string[] {
    return Array.from(document.body.querySelectorAll('table tbody tr')).map(
      (tr) => tr.children[1]?.textContent?.trim() ?? '',
    );
  }

  const twoFilms = makeTicket({
    items: [
      {
        ...item({ category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม FINNIX CT 40%' }),
        positions: [
          { position: 'บานหน้า', product: 'ฟิล์ม FINNIX CT 40%', price: 3000 },
          { position: 'คู่หน้า', product: 'ฟิล์ม FINNIX CT 40%', price: 3000 },
          { position: 'คู่หลัง', product: 'ฟิล์ม 3M CRM 60%', price: 2500 },
        ],
      },
    ],
  });

  it('says เหมือนกัน for a repeat rather than printing a ditto mark', () => {
    // A lone ″ on a sheet worked from at the car reads as an empty cell, or as
    // inches; the technician fitting the wrong film is the cost of that guess.
    renderSheet(twoFilms, 'job');
    const cells = productCells();
    expect(cells[0]).toContain('FINNIX CT 40%');
    expect(cells[1]).toBe('เหมือนกัน');
    expect(cells[2]).toContain('3M CRM 60%');
    expect(document.body.textContent).not.toContain('″');
  });

  it('marks the percentage, and only the percentage', () => {
    renderSheet(twoFilms, 'job');
    const marked = Array.from(document.body.querySelectorAll('span')).filter(
      (el) => el.style.background === 'rgb(255, 243, 163)',
    );
    // One per named row; the เหมือนกัน row has no name to mark.
    expect(marked.map((el) => el.textContent)).toEqual(['40%', '60%']);
  });

  it('leaves a product with no percentage alone', () => {
    renderSheet(
      makeTicket({
        items: [
          {
            ...item({ category: 'เครื่องเสียง', sold: 'ลำโพงคู่ JBL Stage' }),
            positions: [{ position: 'หน้า', product: 'ลำโพงคู่ JBL Stage', price: 4500 }],
          },
        ],
      }),
      'job',
    );
    expect(productCells()[0]).toBe('ลำโพงคู่ JBL Stage');
    const marked = Array.from(document.body.querySelectorAll('span')).filter(
      (el) => el.style.background === 'rgb(255, 243, 163)',
    );
    expect(marked).toHaveLength(0);
  });
});

/**
 * ตราประทับ "งานแก้" บนใบงานติดตั้ง.
 *
 * A car that comes back is not a new job. The tick sat in the extras list at the
 * bottom of the sheet, which is not where anybody looks before starting work.
 */
describe('ใบงานติดตั้ง — ตราประทับงานแก้', () => {
  const reworkTicket = makeTicket({
    items: [item({ category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม FINNIX CT 40%' })],
    extras: { แก้งาน: { checked: true, detail: 'ขันรูฟ มีรอยฟิล์มหัก' } },
  });

  it('stamps the sheet when แก้งาน is ticked', () => {
    renderSheet(reworkTicket, 'job');
    const stamp = document.body.querySelector('.print-stamp') as HTMLElement | null;
    expect(stamp).not.toBeNull();
    expect(stamp!.textContent).toBe('งานแก้');
    // The size and angle the shop asked for, so it reads as a rubber stamp.
    expect(stamp!.style.width).toBe('5cm');
    expect(stamp!.style.height).toBe('3cm');
    expect(stamp!.style.transform).toBe('rotate(-15deg)');
  });

  it('puts it under the QC boxes, at the end of the page', () => {
    renderSheet(reworkTicket, 'job');
    const page = document.body.querySelector('.print-page') as HTMLElement;
    const qc = Array.from(page.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('QC หลังติดตั้ง'),
    )!;
    const stamp = page.querySelector('.print-stamp') as HTMLElement;
    // DOCUMENT_POSITION_FOLLOWING: the stamp comes after the QC block.
    expect(qc.compareDocumentPosition(stamp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('prints what has to be redone under the stamp, in the same red', () => {
    renderSheet(reworkTicket, 'job');
    const marks = Array.from(document.body.querySelectorAll('.print-stamp'));
    const detail = marks.find((el) => el.textContent === 'ขันรูฟ มีรอยฟิล์มหัก') as HTMLElement;
    expect(detail).toBeTruthy();
    // Bigger than the 12px it used to sit at in the extras list.
    expect(Number.parseInt(detail.style.fontSize, 10)).toBeGreaterThanOrEqual(18);
  });

  it('no longer repeats it in the extras list on this sheet', () => {
    renderSheet(reworkTicket, 'job', { extraOptions: ['แก้งาน'] });
    expect(document.body.textContent).not.toContain('แก้งาน: ขันรูฟ');
  });

  it('leaves an ordinary job unstamped', () => {
    renderSheet(makeTicket({ items: [item({ category: 'ฟิล์มกรองแสง' })] }), 'job');
    expect(document.body.querySelector('.print-stamp')).toBeNull();
  });

  it('stamps every page, because the rework is about the car', () => {
    renderSheet(
      makeTicket({
        items: [
          item({ category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม FINNIX CT 40%' }),
          item({ category: 'เครื่องเสียง', sold: 'ลำโพงคู่ JBL Stage' }),
        ],
        extras: { แก้งาน: { checked: true } },
      }),
      'job',
    );
    expect(document.body.querySelectorAll('.print-stamp')).toHaveLength(2);
  });
});

/**
 * วันที่ของงานแก้.
 *
 * The car comes back on its own day and goes home on another, and neither is
 * the original job's. Writing them over the ticket's dates would lose when the
 * first fit happened — which is the thing a warranty argument turns on — so the
 * sheet carries the rework's dates and keeps the original underneath.
 */
describe('ใบงานติดตั้ง — วันที่ของงานแก้', () => {
  const withDates = makeTicket({
    items: [item({ category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม FINNIX CT 40%' })],
    dropOffDateObj: new Date('2026-08-12T09:00:00+07:00'),
    pickupDateObj: new Date('2026-08-14T17:00:00+07:00'),
    extras: {
      แก้งาน: {
        checked: true,
        detail: 'แก้บานหน้า มีเม็ดฝุ่นเยอะมาก',
        receivedAt: '2026-09-01',
        deliveredAt: '2026-09-02',
      },
    },
  });

  it('shows the rework’s dates in the header', () => {
    renderSheet(withDates, 'job');
    const head = document.body.textContent ?? '';
    // Labelled, so nobody reads them as the original job's dates.
    expect(head).toContain('วันที่รับงาน (งานแก้): 1 ก.ย. 2569');
    expect(head).toContain('วันที่ส่งงาน (งานแก้): 2 ก.ย. 2569');
  });

  it('keeps the original job’s dates on the sheet too', () => {
    renderSheet(withDates, 'job');
    expect(document.body.textContent).toContain('งานเดิม: รับ 12 ส.ค. 2569');
  });

  it('leaves the header alone when the rework has no dates yet', () => {
    renderSheet(
      makeTicket({
        items: [item({ category: 'ฟิล์มกรองแสง' })],
        dropOffDateObj: new Date('2026-08-12T09:00:00+07:00'),
        pickupDateObj: new Date('2026-08-14T17:00:00+07:00'),
        extras: { แก้งาน: { checked: true, detail: 'ยังไม่นัดวัน' } },
      }),
      'job',
    );
    const head = document.body.textContent ?? '';
    expect(head).toContain('วันที่รับงาน: 12 ส.ค. 2569');
    expect(head).not.toContain('งานเดิม:');
  });

  it('lets the note run the width of the sheet', () => {
    // It used to wrap inside the 5.7cm stamp column, which turned a sentence
    // into one word a line.
    renderSheet(withDates, 'job');
    const detail = Array.from(document.body.querySelectorAll('.print-stamp')).find(
      (el) => el.textContent === 'แก้บานหน้า มีเม็ดฝุ่นเยอะมาก',
    ) as HTMLElement;
    expect(detail.style.width).toBe('100%');
  });
});

/**
 * งานแก้ที่ระบุชนิดสินค้า, และวันที่ของเซอร์วิส.
 *
 * ใบงานติดตั้ง prints one page per ชนิดสินค้า. A rework on the film is not a
 * rework on the speakers, and stamping both pages sends a technician to redo
 * work nobody complained about.
 */
describe('ใบงานติดตั้ง — งานแก้แยกตามชนิดสินค้า', () => {
  const twoCategories = (extras: Record<string, unknown>) =>
    makeTicket({
      items: [
        item({ category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม FINNIX CT 40%' }),
        item({ category: 'เครื่องเสียง', sold: 'ลำโพงคู่ JBL Stage' }),
      ],
      extras: extras as Ticket['extras'],
    });

  it('stamps only the page of the product being redone', () => {
    renderSheet(
      twoCategories({
        แก้งาน: { checked: true, detail: 'ฟิล์มมีฝุ่น', category: 'ฟิล์มกรองแสง' },
      }),
      'job',
    );
    const pages = Array.from(document.body.querySelectorAll('.print-page'));
    const stamped = pages.filter((p) => p.querySelector('.print-stamp'));
    expect(stamped).toHaveLength(1);
    expect(stamped[0].textContent).toContain('ฟิล์มกรองแสง');
  });

  it('stamps every page when no product is named', () => {
    // An older ticket, or a rework that really is about the whole job.
    renderSheet(twoCategories({ แก้งาน: { checked: true, detail: 'ทำใหม่ทั้งคัน' } }), 'job');
    const pages = Array.from(document.body.querySelectorAll('.print-page'));
    expect(pages.filter((p) => p.querySelector('.print-stamp'))).toHaveLength(2);
  });
});

describe('ใบงานติดตั้ง — วันที่ของเซอร์วิส', () => {
  const serviced = makeTicket({
    items: [item({ category: 'ฟิล์มกันรอย', sold: 'TPU กันรอยเกรดพรีเมียม' })],
    dropOffDateObj: new Date('2026-08-12T09:00:00+07:00'),
    pickupDateObj: new Date('2026-08-14T17:00:00+07:00'),
    extras: { Service: { checked: true } },
    serviceVisits: [
      {
        visitNo: 2,
        plate: 'กก 999',
        receivedAt: '2026-09-10',
        receivedTime: '',
        deliveredAt: '2026-09-11',
        deliveredTime: '',
        salesBy: '',
        qcBy: '',
        technicians: [],
        filmProduct: '',
        customerWaits: null,
        overallOk: null,
        checks: {},
        notes: '',
        points: [],
      },
    ],
  });

  it('shows the latest visit’s dates, labelled as เซอร์วิส', () => {
    // Taken from the visit that was recorded rather than asking for the same
    // two dates a second time on the ticket.
    renderSheet(serviced, 'job');
    const head = document.body.textContent ?? '';
    expect(head).toContain('วันที่รับงาน (เซอร์วิส): 10 ก.ย. 2569');
    expect(head).toContain('วันที่ส่งงาน (เซอร์วิส): 11 ก.ย. 2569');
    expect(head).toContain('งานเดิม: รับ 12 ส.ค. 2569');
  });

  it('falls back to the job’s own dates before any visit is recorded', () => {
    renderSheet({ ...serviced, serviceVisits: [] }, 'job');
    expect(document.body.textContent).toContain('วันที่รับงาน: 12 ส.ค. 2569');
  });
});
