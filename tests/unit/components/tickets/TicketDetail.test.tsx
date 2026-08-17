import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// TicketDetail calls useRouter(); there is no app-router context under jsdom, so
// mock next/navigation. This is a test-environment concern only.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { TicketDetail } from '@/components/tickets/TicketDetail';
import { fmt } from '@/lib/domain/format';
import { itemNetPrice } from '@/lib/domain/tickets';
import type { OptionListName, Ticket } from '@/components/tickets/types';

const OPTION_LISTS: OptionListName[] = [
  'booking_channels',
  'service_types',
  'car_types',
  'car_brands',
  'time_slots',
  'film_positions',
  'wrap_positions',
  'extra_options',
  'slide_types',
  'technicians',
  'product_categories',
  'service_items',
  'payment_methods',
];

const statuses = [
  { key: 'จองแล้ว', short: 'จองแล้ว', bg: '#F1EDE7', text: '#6B5F55', dot: '#B5AAA1' },
  { key: 'กำลังติดตั้ง', short: 'กำลังติดตั้ง', bg: '#DEEEEC', text: '#286B62', dot: '#2F8F82' },
];

function options(overrides: Partial<Record<OptionListName, string[]>> = {}) {
  const o = Object.fromEntries(OPTION_LISTS.map((k) => [k, [] as string[]])) as Record<
    OptionListName,
    string[]
  >;
  o.product_categories = ['ฟิล์มกรองแสง', 'ฟิล์มกันรอย', 'งานบริการ'];
  o.film_positions = ['บานหน้า', 'คู่หน้า'];
  o.payment_methods = ['เงินสด', 'โอนเงิน'];
  return { ...o, ...overrides };
}

function baseProps(ticket: Ticket) {
  return {
    initialTicket: ticket,
    isNew: false,
    shops: [{ id: 'cm', name: 'FINNIX CM' }],
    statuses,
    canDo: () => true,
    currentUserName: 'ผู้ทดสอบ',
    initialOptions: options(),
    initialStock: [],
    initialCarModels: [],
    initialPriceMatrix: [],
    filmPriceMatrix: [],
    initialRetailCustomers: [],
    initialCorporateBuyers: [],
    shopInfo: {},
    saveAction: vi.fn(async () => ({ ok: true, id: 'JT-CM-00001' })),
    optionAction: vi.fn(async () => ({ ok: true })),
  };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'JT-CM-00214',
    shop: 'cm',
    customer: 'คุณ เอ',
    phone: '081',
    plate: '250 กก',
    carType: 'เก๋งเล็ก',
    brand: 'Toyota',
    model: 'Vios',
    color: 'ขาว',
    serviceType: '',
    status: 'จองแล้ว',
    bookingChannel: '',
    techByCategory: {},
    dropOffDateObj: new Date('2026-07-24T09:00:00'),
    pickupDateObj: new Date('2026-07-25T09:00:00'),
    extras: {},
    items: [],
    payments: [],
    notes: '',
    ...overrides,
  };
}

describe('TicketDetail', () => {
  it('(a) selecting a service category renders that item’s detail row', () => {
    const ticket = makeTicket({
      items: [{ category: '', booked: '', bookedPrice: 0, sold: '', soldPrice: 0 }],
    });
    const { container } = render(<TicketDetail {...baseProps(ticket)} />);

    // Find the item category <select> (the one offering product categories).
    const categorySelect = Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'ฟิล์มกรองแสง'),
    )!;
    expect(categorySelect).toBeTruthy();
    fireEvent.change(categorySelect, { target: { value: 'ฟิล์มกรองแสง' } });

    // The item's detail row (cheer-up compare + position picker) now shows.
    expect(screen.getByText(/สินค้าที่สนใจ/)).toBeInTheDocument();
    expect(screen.getByText(/ตำแหน่งติดตั้ง/)).toBeInTheDocument();
  });

  it('(b) the displayed ticket total equals the sum of itemNetPrice across items', () => {
    const items = [
      {
        category: 'ฟิล์มกรองแสง',
        booked: '',
        bookedPrice: 0,
        sold: 'FilmA',
        soldPrice: 5000,
        discountType: 'amount' as const,
        discountValue: 500,
      },
      { category: 'งานบริการ', booked: '', bookedPrice: 0, sold: 'ล้างรถ', soldPrice: 300 },
    ];
    const ticket = makeTicket({ items });
    const expectedTotal = items.reduce(
      (s, i) =>
        s +
        itemNetPrice({
          soldPrice: i.soldPrice,
          discountType: i.discountType,
          discountValue: i.discountValue,
        }),
      0,
    );
    render(<TicketDetail {...baseProps(ticket)} />);

    // The payments summary line shows "ยอดสุทธิ {total}" (scope to the leaf span).
    const summary = screen.getByText(
      (_, el) =>
        el?.tagName === 'SPAN' &&
        (el.textContent || '').startsWith(`ยอดสุทธิ ${fmt(expectedTotal)}`),
    );
    expect(summary).toBeInTheDocument();
    expect(fmt(expectedTotal)).toBe('4,800.00'); // (5000 - 500) + 300
  });

  it('(c) renders each payment and the outstanding figure equals ticketTotal - ticketPaid', () => {
    const items = [
      { category: 'ฟิล์มกรองแสง', booked: '', bookedPrice: 0, sold: 'FilmA', soldPrice: 4500 },
    ];
    const payments = [
      { type: 'มัดจำ', method: 'เงินสด', amount: 2000, date: '' },
      { type: 'ชำระส่วนที่เหลือ', method: 'โอนเงิน', amount: 500, date: '' },
    ];
    const ticket = makeTicket({ items, payments });
    const total = items.reduce((s, i) => s + itemNetPrice({ soldPrice: i.soldPrice }), 0);
    const paid = payments.reduce((s, p) => s + p.amount, 0);

    const { container } = render(<TicketDetail {...baseProps(ticket)} />);

    // Each payment row renders (amount inputs reflect each payment).
    const amountInputs = Array.from(container.querySelectorAll('input[type="number"]')).filter(
      (el) => (el as HTMLInputElement).value === '2000' || (el as HTMLInputElement).value === '500',
    );
    expect(amountInputs.length).toBeGreaterThanOrEqual(2);

    // Outstanding == total - paid.
    const outstanding = screen.getByText(
      (_, el) => (el?.textContent || '') === `คงเหลือ ${fmt(total - paid)}`,
    );
    expect(outstanding).toBeInTheDocument();
    expect(fmt(total - paid)).toBe('2,000.00');
  });
});

/**
 * A car's walk-around runs to dozens of photos, so the shop keeps them in a
 * drive and attaches the album instead of uploading. The link therefore has to
 * count as QC evidence everywhere an upload does.
 */
describe('TicketDetail — external QC album link', () => {
  const filmTicket = (over: Partial<Ticket> = {}) =>
    makeTicket({
      items: [
        { category: 'ฟิล์มกรองแสง', booked: '', bookedPrice: 0, sold: 'FilmA', soldPrice: 1 },
      ],
      ...over,
    });

  it('offers the confirmation form off a link alone, with no photos uploaded', () => {
    render(
      <TicketDetail
        {...baseProps(
          filmTicket({ qcPhotos: [], qcAlbumUrl: 'https://drive.google.com/drive/folders/abc' }),
        )}
      />,
    );
    expect(screen.getByText('แบบฟอร์มการยืนยันการติดตั้ง')).toBeInTheDocument();
  });

  it('does not treat an unopenable link as evidence', () => {
    // `javascript:` in an href the shop typed is how a link field becomes an
    // attack on whoever clicks it, so nothing but http(s) counts.
    render(
      <TicketDetail
        {...baseProps(filmTicket({ qcPhotos: [], qcAlbumUrl: 'javascript:alert(1)' }))}
      />,
    );
    expect(screen.queryByText('แบบฟอร์มการยืนยันการติดตั้ง')).not.toBeInTheDocument();
    expect(screen.getByText(/ต้องขึ้นต้นด้วย http/)).toBeInTheDocument();
  });

  it('keeps the open button off until the link is usable', () => {
    // Separate renders rather than a rerender: the form seeds its draft from
    // `initialTicket` once, so a changed prop does not reach the field.
    const half = render(
      <TicketDetail {...baseProps(filmTicket({ qcAlbumUrl: 'drive.google' }))} />,
    );
    expect(screen.queryByRole('link', { name: /เปิด/ })).not.toBeInTheDocument();
    half.unmount();

    render(
      <TicketDetail {...baseProps(filmTicket({ qcAlbumUrl: 'https://drive.google.com/x' }))} />,
    );
    expect(screen.getByRole('link', { name: /เปิด/ })).toHaveAttribute(
      'href',
      'https://drive.google.com/x',
    );
  });
});

/**
 * A closed ticket (ส่งมอบแล้ว + ชำระครบ) is frozen so its numbers cannot move
 * months after the money did. But the job does not end at delivery — the car
 * comes back to be serviced, and the customer may take ประกัน afterwards. Both
 * live in ข้อมูลเพิ่มเติม, so that block alone stays open.
 */
describe('TicketDetail — ใบงานที่ปิดงานแล้ว', () => {
  const closed = () =>
    makeTicket({
      locked: true,
      status: 'ส่งมอบแล้ว',
      extras: { Service: { checked: true } },
    });

  const props = () => ({
    ...baseProps(closed()),
    initialOptions: options({ extra_options: ['Service', 'ประกัน'] }),
    extrasAction: vi.fn(async () => ({ ok: true })),
  });

  it('freezes the rest of the ticket but not ข้อมูลเพิ่มเติม', () => {
    const { container } = render(<TicketDetail {...props()} />);

    expect(screen.getByText(/ใบงานนี้ปิดงานแล้ว/)).toBeInTheDocument();
    // The guard that greys out everything else is still in place...
    const guard = container.querySelector('[aria-disabled="true"]') as HTMLElement;
    expect(guard.style.pointerEvents).toBe('none');
    // ...and the ข้อมูลเพิ่มเติม block reaches back through it.
    expect(screen.getByText(/ส่วนนี้ยังแก้ไขได้แม้ใบงานปิดแล้ว/)).toBeInTheDocument();
  });

  it('saves ข้อมูลเพิ่มเติม on its own, without touching the frozen parts', async () => {
    const p = props();
    render(<TicketDetail {...p} />);

    // The ticket-wide save is gone; this one is not.
    expect(screen.queryByRole('button', { name: /^บันทึกใบงาน/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /บันทึกข้อมูลเพิ่มเติม/ }));

    await vi.waitFor(() =>
      expect(p.extrasAction).toHaveBeenCalledWith({
        ticketId: 'JT-CM-00214',
        extras: { Service: { checked: true } },
        insurance: false,
      }),
    );
  });

  it('sends the ประกัน tick so the closed ticket can still take one', async () => {
    const p = props();
    render(<TicketDetail {...p} />);

    // Unticked extras are folded away until the section is opened.
    fireEvent.click(screen.getByRole('button', { name: /^ข้อมูลเพิ่มเติม/ }));
    fireEvent.click(screen.getByLabelText('ประกัน'));
    fireEvent.click(screen.getByRole('button', { name: /บันทึกข้อมูลเพิ่มเติม/ }));

    await vi.waitFor(() =>
      expect(p.extrasAction).toHaveBeenCalledWith(expect.objectContaining({ insurance: true })),
    );
  });
});
