import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// TicketDetail calls useRouter(); there is no app-router context under jsdom, so
// mock next/navigation. This is a test-environment concern only.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { TicketDetail } from '@/components/tickets/TicketDetail';
import { fmt } from '@/lib/domain/format';
import { itemNetPrice } from '@/lib/domain/tickets';
import type { OptionListName, Ticket, TicketSavePayload } from '@/components/tickets/types';

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
    // เชียงใหม่ is the VAT-registered branch (migration 0035); the tickets in
    // these tests live there, so the tax invoice is available unless something
    // else takes it away.
    shopInfo: { cm: { vatRegistered: true } },
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
    dropOffDateObj: new Date('2026-07-24T09:00:00+07:00'),
    pickupDateObj: new Date('2026-07-25T09:00:00+07:00'),
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
    // Typed, so `mock.calls[0][0]` is the policy payload and not `never`.
    // Typed through its argument, so `mock.calls[0][0]` is the policy payload
    // rather than `never`.
    insuranceAction: vi.fn(
      async (input: { ticketId: string; policy: Record<string, unknown> }) => ({
        ok: true,
        id: 1,
        ticketId: input.ticketId,
      }),
    ),
    insuranceDeleteAction: vi.fn(async () => ({ ok: true })),
    insurancePlans: [
      {
        id: 1,
        name: 'ประกันฟิล์มกันรอย 1 ปี',
        price: 3000,
        bigPieces: 2,
        smallPieces: 20,
        months: 12,
        terms: '',
        active: true,
      },
    ],
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
      }),
    );
  });

  it('takes a ประกัน sale on a closed ticket without touching its total', async () => {
    const p = props();
    render(<TicketDetail {...p} />);

    // Every extra is listed without opening anything, ticked or not.
    fireEvent.click(screen.getByLabelText('ประกัน'));

    // Ticking it opens the policy form — it does NOT add a line to
    // สินค้า/การติดตั้ง any more, which is what used to move a closed
    // ticket's revenue.
    fireEvent.click(screen.getByRole('button', { name: /บันทึกประกันฉบับใหม่/ }));
    expect(screen.getByLabelText('ราคาประกัน')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^บันทึกประกัน$/ }));
    await vi.waitFor(() => expect(p.insuranceAction).toHaveBeenCalled());
    const sent = p.insuranceAction.mock.calls[0][0];
    expect(sent.ticketId).toBe('JT-CM-00214');
    // Its own sale date, which is what keeps the money off the old job.
    expect(sent.policy.soldAt).toBeTruthy();
  });
});

/**
 * ราคาฟิล์มของสาขา (migration 0029).
 *
 * The same product legitimately sells for different money at different
 * branches. The matrix holds a ราคากลาง and, optionally, a price for one
 * branch; a ticket has to quote its OWN branch's price and fall back to the
 * ราคากลาง only when that branch has not set one.
 */
describe('TicketDetail — ราคาฟิล์มแยกตามสาขา', () => {
  const PRODUCT = 'ฟิล์ม 3M CRM 60%';
  const matrix = [
    {
      category: 'ฟิล์มกรองแสง',
      product: PRODUCT,
      position: 'บานหน้า',
      carType: 'เก๋งเล็ก',
      price: 2500,
      shop: '',
    },
    {
      category: 'ฟิล์มกรองแสง',
      product: PRODUCT,
      position: 'บานหน้า',
      carType: 'เก๋งเล็ก',
      price: 2800,
      shop: 'lpg',
    },
  ];

  function renderAt(shop: string) {
    const ticket = makeTicket({
      shop,
      items: [
        {
          category: 'ฟิล์มกรองแสง',
          booked: '',
          bookedPrice: 0,
          sold: '',
          soldPrice: 0,
          positions: [{ position: 'บานหน้า', product: '', price: 0 }],
        },
      ],
    });
    return render(
      <TicketDetail
        {...baseProps(ticket)}
        shops={[
          { id: 'cm', name: 'FINNIX CM' },
          { id: 'lpg', name: 'FINNIX ลำปาง' },
        ]}
        initialStock={[
          {
            id: 1,
            name: PRODUCT,
            shortName: '3M60',
            category: 'ฟิล์มกรองแสง',
            shop,
            qty: 5,
            cost: 800,
            sellPrice: 1000,
          },
        ]}
        filmPriceMatrix={matrix}
      />,
    );
  }

  async function pickProduct(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByLabelText('สินค้าประจำตำแหน่ง บานหน้า'));
    await user.click(await screen.findByText(new RegExp(PRODUCT)));
  }

  /** The price box sitting beside the picker for that position. */
  function positionPrice(): string {
    const picker = screen.getByLabelText('สินค้าประจำตำแหน่ง บานหน้า');
    const cell = picker.closest('div')?.parentElement;
    const input = cell?.querySelector('input[type="number"]') as HTMLInputElement | null;
    return input?.value ?? '(no price input)';
  }

  it("quotes the branch's own price when it has one", async () => {
    const user = userEvent.setup();
    renderAt('lpg');
    await pickProduct(user);
    expect(positionPrice()).toBe('2800');
  });

  it('falls back to the ราคากลาง at a branch that has not set its own', async () => {
    const user = userEvent.setup();
    renderAt('cm');
    await pickProduct(user);
    // 2500, NOT the 2800 ลำปาง charges and not the product's 1,000 sell price.
    expect(positionPrice()).toBe('2500');
  });
});

/**
 * ใบเคลมประกัน (migration 0023).
 *
 * The sheet goes out to the workshop with the car. Everything the ใบงาน already
 * knows has to be ON it — the film that was fitted, who sold it, the team that
 * did the work, the dates — or the counter writes out by hand what the system
 * is holding, which is how two versions of the same job start to exist.
 */
describe('TicketDetail — ใบเคลมประกัน ดึงข้อมูลจากใบงาน', () => {
  const FILM = 'TPU กันรอยเกรดพรีเมียม';

  const policy = {
    id: 7,
    ticketId: 'JT-CM-00214',
    plate: '250 กก',
    planName: 'ประกันฟิล์มกันรอย 1 ปี',
    price: 3000,
    bigPieces: 3,
    smallPieces: 20,
    terms: '',
    soldAt: '2026-08-26',
    startsAt: '2026-08-26',
    endsAt: '2027-08-26',
    notes: '',
    claims: [
      {
        id: 9,
        claimedAt: '2026-09-01',
        bigUsed: 1,
        smallUsed: 0,
        detail: 'กันชนหน้า',
        technician: 'บอล',
      },
    ],
  };

  function renderWithPolicy() {
    const ticket = makeTicket({
      createdBy: 'คุณเซลล์',
      qcBy: 'คุณนิด',
      techByCategory: { ฟิล์มกันรอย: ['บอล', 'อ้วน'] },
      extras: { ประกัน: { checked: true } },
      items: [
        {
          category: 'ฟิล์มกันรอย',
          booked: '',
          bookedPrice: 0,
          sold: FILM,
          soldPrice: 29500,
          positions: [],
        },
      ],
      insurancePolicies: [policy],
    });
    const props = baseProps(ticket);
    return render(
      <TicketDetail
        {...props}
        initialOptions={options({
          extra_options: ['ประกัน'],
          technicians: ['บอล', 'อ้วน', 'สยาม'],
        })}
        initialStock={[
          {
            id: 1,
            name: FILM,
            shortName: 'TPU',
            category: 'ฟิล์มกันรอย',
            shop: 'cm',
            qty: 3,
            cost: 8000,
            sellPrice: 29500,
          },
        ]}
        insuranceAction={vi.fn(async () => ({ ok: true }))}
        insurancePlans={[]}
      />,
    );
  }

  /** The printed sheet only — the form holds the same words on screen. */
  function sheetText(): string {
    return document.querySelector('.print-area')?.textContent ?? '';
  }

  it('prints the film, the seller, the team and the dates without being asked again', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    renderWithPolicy();

    // Claims are made at the service visit now (0059); one recorded before
    // that still reprints from its own row under the policy.
    await user.click(screen.getByLabelText('แก้ไขประกัน ประกันฟิล์มกันรอย 1 ปี'));
    await user.click(screen.getByLabelText('พิมพ์ใบเคลมครั้งที่ 1'));

    const sheet = sheetText();
    expect(sheet).toContain('ใบเคลมประกันฟิล์มกันรอย');
    // ฟิล์มที่ใช้ / เซลล์รับรถ — from the ticket, not typed a second time.
    expect(sheet).toContain(FILM);
    expect(sheet).toContain('คุณเซลล์');
    // QC ผู้รับผิดชอบ — named once on the ใบงาน, printed here.
    expect(sheet).toContain('คุณนิด');
    // วันรับรถ / วันส่งมอบรถ of the job the warranty came from.
    expect(sheet).toContain('วันรับรถ');
    expect(sheet).toContain('24 ก.ค. 2569');
    expect(sheet).toContain('25 ก.ค. 2569');
    expect(sheet).toContain('09:00');
    // ...and the team the ticket put on the job, ticked.
    expect(sheet).toMatch(/✓บอล/);
    expect(sheet).toMatch(/✓อ้วน/);
  });

  it('reprints a recorded claim with what it used and what is left', async () => {
    // A claim on file prints its own boxes filled in, and the cover as it stands.
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    renderWithPolicy();

    // Claims are made at the service visit now (0059); one recorded before
    // that still reprints from its own row under the policy.
    await user.click(screen.getByLabelText('แก้ไขประกัน ประกันฟิล์มกันรอย 1 ปี'));
    await user.click(screen.getByLabelText('พิมพ์ใบเคลมครั้งที่ 1'));

    const sheet = sheetText();
    expect(sheet).toContain('1 ชิ้นใหญ่, 0 ชิ้นเล็ก');
    expect(sheet).toContain('กันชนหน้า');
    expect(sheet).toContain('คงเหลือ');
    // 3 − 1 ชิ้นใหญ่ left, and the cover it came from.
    expect(sheet).toContain('2 ชิ้นใหญ่, 20 ชิ้นเล็ก');
  });
});

describe('TicketDetail — QC ผู้รับผิดชอบ', () => {
  it('names one QC on the ticket and prints it on the ใบงานติดตั้ง', async () => {
    // Before this the sheet had a blank line to write on, and the only place a
    // QC name existed was inside a service visit — nothing said who checked the
    // install itself.
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    const ticket = makeTicket({
      items: [
        {
          category: 'ฟิล์มกรองแสง',
          booked: '',
          bookedPrice: 0,
          sold: 'ฟิล์ม 3M CRM 60%',
          soldPrice: 12000,
          positions: [],
        },
      ],
    });
    render(
      <TicketDetail
        {...baseProps(ticket)}
        initialOptions={options({ technicians: ['บอล', 'คุณนิด'] })}
      />,
    );

    await user.selectOptions(screen.getByLabelText('QC ผู้รับผิดชอบ'), 'คุณนิด');
    expect(screen.getByLabelText('QC ผู้รับผิดชอบ')).toHaveValue('คุณนิด');
  });
});

describe('TicketDetail — รายได้ / รับแทน', () => {
  it('starts on รายได้ and switches the whole ticket to รับแทน', async () => {
    const user = userEvent.setup();
    const saveAction = vi.fn(async () => ({ ok: true, id: 'JT-CM-00214' }));
    render(<TicketDetail {...baseProps(makeTicket())} saveAction={saveAction} />);

    const held = screen.getByRole('button', { name: /รายได้ Finnix/ });
    const own = screen.getByRole('button', { name: /รายได้ของสาขา/ });
    expect(own).toHaveAttribute('aria-pressed', 'true');
    expect(held).toHaveAttribute('aria-pressed', 'false');

    await user.click(held);
    expect(held).toHaveAttribute('aria-pressed', 'true');
    // The consequence is stated on screen, not left for the report to reveal.
    expect(screen.getByText(/ไม่นับเป็นยอดขายของสาขา/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^บันทึก/ }));
    expect(saveAction).toHaveBeenCalledWith(expect.objectContaining({ revenueKind: 'รับแทน' }));
  });
});

/**
 * ใบกำกับภาษีกับเงินที่รายได้ Finnix.
 *
 * A tax invoice asserts that THIS shop made the sale. A held ticket is another
 * Finnix shop's sale, so issuing one here would put a document into this shop's
 * tax position for money it never earned.
 */
describe('TicketDetail — ล็อกใบกำกับภาษีเมื่อรายได้ Finnix', () => {
  const TAX = 'ใบกำกับภาษี/ใบเสร็จรับเงิน';

  it('locks the tax invoice the moment the ticket becomes รับแทน', async () => {
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(makeTicket())} />);

    expect(screen.getByRole('button', { name: TAX })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /รายได้ Finnix/ }));
    expect(screen.getByRole('button', { name: new RegExp(TAX) })).toBeDisabled();
    expect(screen.getByText(/จึงออกใบกำกับภาษีไม่ได้/)).toBeInTheDocument();
  });

  it('moves the selection off the tax invoice rather than leaving it selected', async () => {
    // Otherwise the ออก… button would still offer the one document now refused.
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(makeTicket())} />);

    await user.click(screen.getByRole('button', { name: TAX }));
    await user.click(screen.getByRole('button', { name: /รายได้ Finnix/ }));

    expect(screen.getByRole('button', { name: /^ออก/ })).toHaveTextContent('ออกใบเสร็จรับเงิน');
  });

  it('leaves ใบเสนอราคา and ใบเสร็จรับเงิน available', async () => {
    // The customer did pay at this counter and can still be given paperwork.
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(makeTicket({ revenueKind: 'รับแทน' }))} />);

    expect(screen.getByRole('button', { name: 'ใบเสนอราคา' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'ใบเสร็จรับเงิน' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'ใบเสนอราคา' }));
    expect(screen.getByRole('button', { name: /^ออก/ })).toHaveTextContent('ออกใบเสนอราคา');
  });
});

/**
 * ใบกำกับภาษีออกได้เฉพาะสาขาที่จดทะเบียนภาษีมูลค่าเพิ่ม (migration 0035).
 *
 * Only FINNIX FILM เชียงใหม่ is registered. A tax invoice from anywhere else
 * asserts a registration that does not exist — the kind of paper an auditor
 * finds months later, already in a customer's hands.
 */
describe('TicketDetail — ใบกำกับภาษีตามการจดทะเบียนของสาขา', () => {
  const TAX = 'ใบกำกับภาษี/ใบเสร็จรับเงิน';

  function atShop(shop: string, vatRegistered: boolean) {
    return {
      ...baseProps(makeTicket({ shop })),
      shops: [
        { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
        { id: 'lpg', name: 'FINNIX FILM ลำปาง' },
      ],
      shopInfo: { [shop]: { vatRegistered } },
    };
  }

  it('locks it at a branch that is not registered, and says which branch', () => {
    render(<TicketDetail {...atShop('lpg', false)} />);
    expect(screen.getByRole('button', { name: new RegExp(TAX) })).toBeDisabled();
    expect(
      screen.getByText(/FINNIX FILM ลำปาง ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม/),
    ).toBeInTheDocument();
  });

  it('leaves the other two documents available there', () => {
    render(<TicketDetail {...atShop('lpg', false)} />);
    expect(screen.getByRole('button', { name: 'ใบเสนอราคา' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'ใบเสร็จรับเงิน' })).toBeEnabled();
  });

  it('allows it at the registered branch', () => {
    render(<TicketDetail {...atShop('cm', true)} />);
    expect(screen.getByRole('button', { name: TAX })).toBeEnabled();
  });

  it('offers ข้อมูลนิติบุคคล on a ใบเสร็จรับเงิน once the shop’s details are shown', async () => {
    // At a branch that cannot issue a tax invoice, a receipt made out to a
    // company was the only paperwork available and had nowhere to type the
    // company into.
    const user = userEvent.setup();
    render(<TicketDetail {...atShop('lpg', false)} />);

    await user.click(screen.getByRole('button', { name: 'ใบเสร็จรับเงิน' }));
    expect(screen.queryByPlaceholderText('ที่อยู่นิติบุคคล')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/แสดงชื่อนิติบุคคล/));
    expect(screen.getByPlaceholderText('ที่อยู่นิติบุคคล')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('เลขผู้เสียภาษี 13 หลัก')).toBeInTheDocument();
    // …and it can be kept for next time, which is the point of asking for it.
    expect(
      screen.getByRole('button', { name: /บันทึกข้อมูลนี้ไว้ใช้ครั้งถัดไป/ }),
    ).toBeInTheDocument();
  });
});

/**
 * เปิดใบงานให้สาขาอื่นได้ (ตามสิทธิ์ที่มี).
 *
 * Head office books for a branch over the phone. Before this the form had no
 * branch field at all: a new ticket landed on whichever of the caller's shops
 * sorted first, and there was no way to say otherwise — an admin could edit
 * another branch's ticket but could not open one.
 */
describe('TicketDetail — เลือกสาขาตอนเปิดใบงานใหม่', () => {
  const SHOPS = [
    { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
    { id: 'lpg', name: 'FINNIX FILM ลำปาง' },
  ];

  it('opens the ticket at the branch the user picked', async () => {
    const user = userEvent.setup();
    const saveAction = vi.fn(async () => ({ ok: true, id: 'JT-LPG-00001' }));
    render(
      <TicketDetail
        {...baseProps(makeTicket({ shop: 'cm' }))}
        isNew
        shops={SHOPS}
        accessibleShops={SHOPS}
        saveAction={saveAction}
      />,
    );

    // Buttons, like every other branch choice (ร้านแจ้ง 21 ก.ย. 2569).
    await user.click(
      within(screen.getByRole('group', { name: 'สาขาที่เปิดใบงาน' })).getByRole('button', {
        name: /ลำปาง/,
      }),
    );
    await user.click(screen.getByRole('button', { name: /^บันทึก/ }));
    expect(saveAction).toHaveBeenCalledWith(expect.objectContaining({ shop: 'lpg' }));
  });

  it('does not offer it on a saved ticket', () => {
    // The id, the documents and the stock movements all name the branch already.
    render(<TicketDetail {...baseProps(makeTicket())} shops={SHOPS} accessibleShops={SHOPS} />);
    expect(screen.queryByLabelText('สาขาที่เปิดใบงาน')).not.toBeInTheDocument();
  });

  it('does not offer it to somebody who only has one branch', () => {
    render(
      <TicketDetail
        {...baseProps(makeTicket())}
        isNew
        shops={SHOPS}
        accessibleShops={[SHOPS[0]]}
      />,
    );
    expect(screen.queryByLabelText('สาขาที่เปิดใบงาน')).not.toBeInTheDocument();
  });
});

/**
 * บัญชีรับชำระบนใบเสนอราคา (ร้านขอ 21 ก.ย. 2569) — the customer is told which
 * account to pay into, and the choice stays with the ticket.
 */
describe('TicketDetail — บัญชีรับชำระบนใบเสนอราคา', () => {
  const ACCOUNTS = [
    { id: 11, shop: 'cm', name: 'กสิกร ออมทรัพย์', kind: 'bank', accountNo: '236-1-38053-6' },
    { id: 21, shop: 'lpg', name: 'SCB ลำปาง', kind: 'bank', accountNo: '999-9' },
  ];

  async function openQuotation(props: Record<string, unknown> = {}) {
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(makeTicket())} payAccounts={ACCOUNTS} {...props} />);
    await user.click(screen.getByRole('button', { name: 'ใบเสนอราคา' }));
    return user;
  }

  it('offers this branch’s accounts on a quotation', async () => {
    await openQuotation();
    const options = within(screen.getByLabelText('บัญชีรับชำระ'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['ไม่ระบุ', 'กสิกร ออมทรัพย์ · เลขที่บัญชี 236-1-38053-6']);
  });

  it('saves the choice at once, without making the form unsaved', async () => {
    const payAccountAction = vi.fn(async () => ({ ok: true }));
    const user = await openQuotation({ payAccountAction });
    await user.selectOptions(screen.getByLabelText('บัญชีรับชำระ'), '11');
    expect(payAccountAction).toHaveBeenCalledWith({ ticketId: 'JT-CM-00214', accountId: 11 });
    // And the account is on the paper.
    vi.spyOn(window, 'print').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: /^ออก/ }));
    const sheet = document.querySelector('.print-area')?.textContent ?? '';
    expect(sheet).toContain('ชำระเงินเข้าบัญชี');
    expect(sheet).toContain('236-1-38053-6');
  });

  it('puts the old choice back when the save is refused', async () => {
    const payAccountAction = vi.fn(async () => ({ ok: false, error: 'ใบงานนี้ถูกล็อก' }));
    const user = await openQuotation({ payAccountAction });
    await user.selectOptions(screen.getByLabelText('บัญชีรับชำระ'), '11');
    expect(screen.getByLabelText('บัญชีรับชำระ')).toHaveValue('');
    expect(screen.getByText('ใบงานนี้ถูกล็อก')).toBeInTheDocument();
  });

  it('is not asked for on a receipt, which records money already paid', async () => {
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(makeTicket())} payAccounts={ACCOUNTS} />);
    await user.click(screen.getByRole('button', { name: 'ใบเสร็จรับเงิน' }));
    expect(screen.queryByLabelText('บัญชีรับชำระ')).not.toBeInTheDocument();
  });
});

/**
 * บันทึกโดย บนหน้าจอ (ร้านขอ 22 ก.ย. 2569) — the name was only ever on the
 * printed sheet, so finding out who raised a ticket meant printing it.
 */
describe('TicketDetail — บันทึกโดย', () => {
  it('shows who saved the ticket, and when, under its number', () => {
    render(
      <TicketDetail
        {...baseProps(
          makeTicket({
            createdBy: 'คุณป๊อก',
            createdAt: '2026-09-22T03:05:00Z',
          } as unknown as Partial<Ticket>),
        )}
      />,
    );
    const line = screen.getByText('คุณป๊อก').closest('p') as HTMLElement;
    expect(line).toHaveTextContent('บันทึกโดย');
    expect(line).toHaveTextContent('22 ก.ย. 2569');
  });

  it('says it does not know, rather than naming nobody, on an old ticket', () => {
    render(<TicketDetail {...baseProps(makeTicket({ createdBy: '' } as Partial<Ticket>))} />);
    expect(screen.getByText('ไม่ทราบ').closest('p')).toHaveTextContent('บันทึกโดย');
  });

  it('is not shown on a ticket that has not been saved yet', () => {
    render(<TicketDetail {...baseProps(makeTicket())} isNew />);
    expect(screen.queryByText('บันทึกโดย')).not.toBeInTheDocument();
  });
});

/**
 * วิธีชำระ = แหล่งเงินของสาขา (migration 0064, ร้านขอ 22 ก.ย. 2569) — whatever
 * is picked is the account the money lands in.
 */
describe('TicketDetail — วิธีชำระจากแหล่งเงิน', () => {
  const ACCOUNTS = [
    { id: 1, shop: 'cm', name: 'เงินสดหน้าร้าน', kind: 'cash', accountNo: '' },
    { id: 2, shop: 'cm', name: 'กสิกร ออมทรัพย์', kind: 'bank', accountNo: '236-1' },
    { id: 3, shop: 'cm', name: 'เงินสดย่อย', kind: 'petty', accountNo: '' },
    { id: 4, shop: 'lpg', name: 'SCB ลำปาง', kind: 'bank', accountNo: '9' },
  ];

  it('offers this branch’s accounts a customer can pay into, and starts on its cash', async () => {
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(makeTicket({ payments: [] }))} payAccounts={ACCOUNTS} />);
    await user.click(screen.getByRole('button', { name: /เพิ่มรายการรับเงิน/ }));
    const picker = screen.getByLabelText('วิธีชำระเงินรายการที่ 1');
    expect(picker).toHaveValue('เงินสดหน้าร้าน');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['เลือกแหล่งเงินที่เงินเข้า...', 'เงินสดหน้าร้าน', 'กสิกร ออมทรัพย์']);
  });

  it('still shows a method saved before, so an old ticket reads as it was', () => {
    render(
      <TicketDetail
        {...baseProps(
          makeTicket({
            payments: [{ type: 'มัดจำ', method: 'โอน TTB', amount: 1000, date: '2026-09-01' }],
          }),
        )}
        payAccounts={ACCOUNTS}
      />,
    );
    expect(screen.getByLabelText('วิธีชำระเงินรายการที่ 1')).toHaveValue('โอน TTB');
  });
});

/**
 * ข้อมูลของช่าง บนใบงานที่ปิดแล้ว (migration 0066, ร้านขอ 23 ก.ย. 2569).
 *
 * The technician's part of a job is often finished after the customer has paid
 * and gone — the car leaves on Friday, the numbers for what came off the roll
 * are written down on Monday. So the lock lets this block through while any
 * จำนวนสินค้าที่ใช้จริง is blank, and again whenever แก้งาน is ticked.
 */
describe('TicketDetail — ข้อมูลของช่างหลังปิดงาน', () => {
  const soldItem = (actualQtyMap: Record<string, number> = {}) => ({
    category: 'ฟิล์มกรองแสง',
    booked: '',
    bookedPrice: 0,
    sold: 'ฟิล์ม 3M CR70',
    soldPrice: 5000,
    actualQtyMap,
  });

  const closedWith = (over: Partial<Ticket> = {}) =>
    makeTicket({
      locked: true,
      status: 'ส่งมอบแล้ว',
      items: [soldItem()],
      ...over,
    });

  const techProps = (ticket: Ticket) => ({
    ...baseProps(ticket),
    initialOptions: options({ extra_options: ['Service', 'แก้งาน'], technicians: ['ช่างเอ'] }),
    // Typed through its argument, so `mock.calls[0][0]` is the payload rather
    // than `never`.
    techAction: vi.fn(
      async (input: {
        ticketId: string;
        shop: string;
        extras: Record<string, unknown>;
        techByCategory: Record<string, string[]>;
        actualQty: Record<string, number>[];
      }) => ({ ok: true, id: input.ticketId }),
    ),
  });

  /** Guards are the greyed-out wrappers; the tech block has its own. */
  const guards = (c: HTMLElement) => c.querySelectorAll('[aria-disabled="true"]').length;

  it('leaves ข้อมูลของช่าง open while a quantity is still blank', () => {
    const { container } = render(<TicketDetail {...techProps(closedWith())} />);
    expect(screen.getByText(/ใบงานนี้ปิดงานแล้ว/)).toBeInTheDocument();
    // One guard, not two: the money is frozen, the technician block is not.
    expect(guards(container)).toBe(1);
    expect(screen.getByText(/ยังกรอกจำนวนสินค้าที่ใช้จริงไม่ครบ/)).toBeInTheDocument();
    expect(screen.getByLabelText('จำนวนที่ใช้จริง ฟิล์ม 3M CR70')).toBeInTheDocument();
  });

  it('freezes it once every quantity has been recorded', () => {
    const { container } = render(
      <TicketDetail {...techProps(closedWith({ items: [soldItem({ 'ฟิล์ม 3M CR70': 2 })] }))} />,
    );
    expect(guards(container)).toBe(2);
    expect(screen.queryByRole('button', { name: /บันทึกข้อมูลของช่าง/ })).toBeNull();
  });

  it('opens it again when แก้งาน is ticked, without saving first', async () => {
    // The tick is read from the DRAFT: ticking the box and reaching straight
    // for the quantity is the whole point, not two saves and a reload.
    const user = userEvent.setup();
    const { container } = render(
      <TicketDetail {...techProps(closedWith({ items: [soldItem({ 'ฟิล์ม 3M CR70': 2 })] }))} />,
    );
    expect(guards(container)).toBe(2);
    await user.click(screen.getByLabelText('แก้งาน'));
    expect(guards(container)).toBe(1);
    expect(screen.getByText(/ติ๊ก "แก้งาน" ไว้/)).toBeInTheDocument();
  });

  it('saves the technician fields on their own, and nothing else', async () => {
    const user = userEvent.setup();
    const props = techProps(closedWith());
    render(<TicketDetail {...props} />);

    await user.type(screen.getByLabelText('จำนวนที่ใช้จริง ฟิล์ม 3M CR70'), '2');
    await user.click(screen.getByRole('button', { name: /บันทึกข้อมูลของช่าง/ }));

    expect(props.techAction).toHaveBeenCalledTimes(1);
    const payload = props.techAction.mock.calls[0][0];
    expect(payload).toMatchObject({ ticketId: 'JT-CM-00214', shop: 'cm' });
    // One map per item, in the order the form loaded them.
    expect(payload.actualQty).toEqual([{ 'ฟิล์ม 3M CR70': 2 }]);
    // The whole-ticket save stays gone: this path cannot move a price.
    expect(screen.queryByRole('button', { name: /^บันทึกใบงาน/ })).toBeNull();
  });

  it('is not offered on an open ticket — the ordinary save covers it', () => {
    const { container } = render(
      <TicketDetail {...techProps(makeTicket({ items: [soldItem()] }))} />,
    );
    expect(guards(container)).toBe(0);
    expect(screen.queryByRole('button', { name: /บันทึกข้อมูลของช่าง/ })).toBeNull();
  });
});

/**
 * ใบงานเดียว มีทั้งรายได้สาขาและรายได้ Finnix (ร้านแจ้ง 25 ก.ย. 2569, migration 0068).
 *
 * 0031 asked this once for the whole job. One car can carry the branch's own
 * film and another branch's wrap, so the answer belongs on the line — and the
 * two buttons at the top of การชำระเงิน now set every line at once, because a
 * wholly-held job is still the common case.
 */
describe('TicketDetail — รายได้/รับแทน ทีละรายการ', () => {
  const twoItems = () =>
    makeTicket({
      items: [
        {
          category: 'ฟิล์มกรองแสง',
          booked: '',
          bookedPrice: 0,
          sold: 'ฟิล์ม A',
          soldPrice: 6000,
        },
        { category: 'ฟิล์มกันรอย', booked: '', bookedPrice: 0, sold: 'TPU', soldPrice: 4000 },
      ],
    });

  it('ตั้งรายการเดียวเป็นรับแทน แล้วบอกยอดที่แยกกันบนหน้าจอ', async () => {
    const user = userEvent.setup();
    // Typed through its argument, so `mock.calls[0][0]` is the payload.
    const saveAction = vi.fn(async (p: TicketSavePayload) => ({ ok: true, id: p.id }));
    render(<TicketDetail {...baseProps(twoItems())} saveAction={saveAction} />);

    await user.click(screen.getByRole('button', { name: 'รายได้ Finnix รายการที่ 2' }));

    // Neither whole-job button is on while the lines disagree, and the split is
    // spelled out rather than left for the report to reveal.
    expect(screen.getByRole('button', { name: /รายได้ของสาขา/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText(/ใบงานนี้แยกกัน/)).toHaveTextContent(
      /รายได้สาขา 6,000.00 · รายได้ Finnix 4,000.00/,
    );

    await user.click(screen.getByRole('button', { name: /^บันทึก/ }));
    const payload = saveAction.mock.calls[0][0];
    expect(payload.items.map((i) => i.revenueKind)).toEqual(['รายได้', 'รับแทน']);
    // A mixed job is not held as a whole — it did earn the branch something.
    expect(payload.revenueKind).toBe('รายได้');
  });

  it('ปุ่มด้านบนตั้งให้ทุกรายการพร้อมกัน', async () => {
    const user = userEvent.setup();
    // Typed through its argument, so `mock.calls[0][0]` is the payload.
    const saveAction = vi.fn(async (p: TicketSavePayload) => ({ ok: true, id: p.id }));
    render(<TicketDetail {...baseProps(twoItems())} saveAction={saveAction} />);

    await user.click(screen.getByRole('button', { name: /รายได้ Finnix$/ }));
    await user.click(screen.getByRole('button', { name: /^บันทึก/ }));

    const payload = saveAction.mock.calls[0][0];
    expect(payload.items.map((i) => i.revenueKind)).toEqual(['รับแทน', 'รับแทน']);
    expect(payload.revenueKind).toBe('รับแทน');
  });

  it('มีรายการ Finnix ปนอยู่ ยังออกใบกำกับภาษีได้ — เอกสารออกให้เฉพาะส่วนของสาขา', async () => {
    // ร้านแจ้ง 25 ก.ย. 2569: a tax invoice is for what the branch sold. Finnix's
    // lines are left off it rather than the whole document being refused.
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(twoItems())} />);

    await user.click(screen.getByRole('button', { name: 'รายได้ Finnix รายการที่ 2' }));
    expect(screen.getByRole('button', { name: 'ใบกำกับภาษี/ใบเสร็จรับเงิน' })).toBeEnabled();
  });

  it('ไม่มีรายการของสาขาเลย จึงออกใบกำกับภาษีไม่ได้', async () => {
    // Nothing of the branch's to invoice. The receipt is still available for
    // the whole amount, because the customer did pay it here.
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(twoItems())} />);

    await user.click(screen.getByRole('button', { name: /รายได้ Finnix$/ }));
    expect(screen.getByRole('button', { name: /ใบกำกับภาษี/ })).toBeDisabled();
    expect(screen.getByText(/ไม่มีรายการที่เป็นรายได้ของสาขา/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ใบเสร็จรับเงิน' })).toBeEnabled();
  });

  it('รายการที่เพิ่มทีหลัง ตามฝั่งที่ใบงานตั้งไว้', async () => {
    // Marking a job รับแทน and then typing what was sold must not quietly put
    // that money back into the branch's takings.
    const user = userEvent.setup();
    // Typed through its argument, so `mock.calls[0][0]` is the payload.
    const saveAction = vi.fn(async (p: TicketSavePayload) => ({ ok: true, id: p.id }));
    render(<TicketDetail {...baseProps(makeTicket())} saveAction={saveAction} />);

    await user.click(screen.getByRole('button', { name: /รายได้ Finnix$/ }));
    await user.click(screen.getByRole('button', { name: /เพิ่มสินค้าในคันนี้/ }));
    await user.click(screen.getByRole('button', { name: /^บันทึก/ }));

    expect(saveAction.mock.calls[0][0].items[0].revenueKind).toBe('รับแทน');
  });
});

/**
 * จับคู่รายได้ Finnix กับบัญชีที่รับเงินไว้จริง (ร้านขอ 25 ก.ย. 2569, migration 0069).
 *
 * The lines say what was sold and whose it was; the account each payment names
 * says where the money went. They are supposed to agree — and when they do not,
 * somebody has to move money, which nobody could see before.
 */
describe('TicketDetail — เงินเข้าบัญชีตรงกับที่ขายไหม', () => {
  const ACCOUNTS = [
    { id: 1, shop: 'cm', name: 'เงินสดหน้าร้าน', kind: 'cash', accountNo: '', owner: 'สาขา' },
    {
      id: 2,
      shop: 'cm',
      name: 'เงิน FINNIX - Kbank',
      kind: 'bank',
      accountNo: '187-1-27068-2',
      owner: 'Finnix',
    },
  ] as const;

  const mixedTicket = (
    payments: { type: string; method: string; amount: number; date: string }[],
  ) =>
    makeTicket({
      items: [
        {
          category: 'ฟิล์มกรองแสง',
          booked: '',
          bookedPrice: 0,
          sold: 'ฟิล์ม A',
          soldPrice: 6000,
          revenueKind: 'รายได้',
        },
        {
          category: 'ฟิล์มกันรอย',
          booked: '',
          bookedPrice: 0,
          sold: 'TPU',
          soldPrice: 4000,
          revenueKind: 'รับแทน',
        },
      ],
      payments,
    });

  const paid = (method: string, amount: number) => ({
    type: 'ชำระเต็มจำนวน',
    method,
    amount,
    date: '2026-09-25',
  });

  it('เงียบเมื่อเงินเข้าถูกบัญชีทั้งสองฝั่ง', () => {
    render(
      <TicketDetail
        {...baseProps(
          mixedTicket([paid('เงินสดหน้าร้าน', 6000), paid('เงิน FINNIX - Kbank', 4000)]),
        )}
        payAccounts={[...ACCOUNTS]}
      />,
    );
    expect(screen.queryByText(/เงินเข้าบัญชีไม่ตรงกับที่ขาย/)).toBeNull();
  });

  it('บอกยอดที่ต้องโอนคืน เมื่อเงินของ Finnix เข้าบัญชีสาขา', () => {
    render(
      <TicketDetail
        {...baseProps(
          mixedTicket([paid('เงินสดหน้าร้าน', 7000), paid('เงิน FINNIX - Kbank', 3000)]),
        )}
        payAccounts={[...ACCOUNTS]}
      />,
    );
    expect(screen.getByText(/เงินเข้าบัญชีไม่ตรงกับที่ขาย/)).toBeInTheDocument();
    expect(screen.getByText(/ต้องโอนคืน Finnix อีก 1,000.00/)).toBeInTheDocument();
    // And it says out loud that the sales figure is not moving with it.
    expect(screen.getByText(/ยอดขายของสาขายึดตามสินค้าที่ขาย/)).toBeInTheDocument();
  });

  it('ยังไม่พูดอะไรระหว่างที่ลูกค้ายังจ่ายไม่ครบ', () => {
    render(
      <TicketDetail
        {...baseProps(mixedTicket([paid('เงินสดหน้าร้าน', 5000)]))}
        payAccounts={[...ACCOUNTS]}
      />,
    );
    expect(screen.queryByText(/เงินเข้าบัญชีไม่ตรงกับที่ขาย/)).toBeNull();
  });

  it('ใบงานที่ไม่มีรายการของ Finnix ไม่มีอะไรต้องจับคู่', () => {
    render(
      <TicketDetail
        {...baseProps(
          makeTicket({
            items: [
              {
                category: 'ฟิล์มกรองแสง',
                booked: '',
                bookedPrice: 0,
                sold: 'ฟิล์ม A',
                soldPrice: 6000,
              },
            ],
            payments: [paid('เงิน FINNIX - Kbank', 6000)],
          }),
        )}
        payAccounts={[...ACCOUNTS]}
      />,
    );
    expect(screen.queryByText(/เงินเข้าบัญชีไม่ตรงกับที่ขาย/)).toBeNull();
  });
});

/**
 * ค่าประกันต้องถูกเรียกเก็บบนใบงาน (ร้านแจ้ง 26 ก.ย. 2569).
 *
 * A policy is its own record and its revenue belongs to the day it was sold
 * (0023) — but the ticket's total left it out entirely, so selling ประกัน 6,000
 * moved nothing on screen. คงเหลือ never asked for the money, nobody recorded
 * receiving it, and the premium never reached an account balance or the
 * dashboard's ยอดขาย, which counts money actually received. The report on the
 * other side counted it as revenue, so the two disagreed by every premium ever
 * written.
 */
describe('TicketDetail — ค่าประกันรวมอยู่ในยอดของใบงาน', () => {
  const policy = {
    id: 5,
    ticketId: 'JT-CM-00214',
    plate: '250 กก',
    planName: 'ประกันฟิล์มกันรอย 1 ปี',
    price: 6000,
    bigPieces: 3,
    smallPieces: 20,
    terms: '',
    soldAt: '2026-09-24',
    startsAt: '2026-09-24',
    endsAt: '2027-09-24',
    notes: '',
    claims: [],
  };

  const withPolicy = () =>
    makeTicket({
      items: [
        {
          category: 'ฟิล์มกันรอย',
          booked: '',
          bookedPrice: 0,
          sold: 'TPU',
          soldPrice: 4000,
        },
      ],
      payments: [{ type: 'ชำระเต็มจำนวน', method: 'เงินสด', amount: 4000, date: '2026-09-24' }],
      insurancePolicies: [policy],
      extras: { ประกัน: { checked: true } },
    });

  it('นับค่าประกันเข้ายอดสุทธิ และยังค้างอยู่จนกว่าจะรับเงิน', () => {
    render(<TicketDetail {...baseProps(withPolicy())} />);
    // 4,000 ของฟิล์ม + 6,000 ค่าประกัน — the ticket asks for all of it.
    expect(screen.getByText(/ยอดสุทธิ 10,000.00/)).toBeInTheDocument();
    expect(screen.getByText(/คงเหลือ 6,000.00/)).toBeInTheDocument();
  });

  it('ค่าประกันขึ้นเป็นบรรทัดหนึ่งในใบเสร็จรับเงิน', async () => {
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(withPolicy())} />);
    await user.click(screen.getByRole('button', { name: 'ใบเสร็จรับเงิน' }));
    await user.click(screen.getByRole('button', { name: /^ออก/ }));
    // The premium is on the paper the customer is handed, or the total would
    // not match the rows above it.
    expect(screen.getAllByText('ประกันฟิล์มกันรอย 1 ปี').length).toBeGreaterThan(0);
  });

  it('ไม่มีประกัน ยอดก็เป็นของสินค้าอย่างเดียวเหมือนเดิม', () => {
    render(
      <TicketDetail
        {...baseProps(
          makeTicket({
            items: [
              { category: 'ฟิล์มกันรอย', booked: '', bookedPrice: 0, sold: 'TPU', soldPrice: 4000 },
            ],
          }),
        )}
      />,
    );
    expect(screen.getByText(/ยอดสุทธิ 4,000.00/)).toBeInTheDocument();
  });
});

/**
 * วันนัด Service ต้องบันทึกตัวเอง (ร้านแจ้ง 26 ก.ย. 2569).
 *
 * A ใบเซอร์วิส saves the moment it is recorded, so nothing on that screen
 * suggests the appointment above it has not been saved too. It had not: the
 * schedule reached the database only through บันทึกใบงาน, and since every
 * unconfirmed row is rebuilt from the start date, a lost save took the real
 * dates with it and put the plain six-month grid back — which is what the shop
 * saw as "the service dates changed by themselves".
 */
describe('TicketDetail — วันนัด Service บันทึกทันที', () => {
  const serviceTicket = () =>
    makeTicket({
      items: [
        { category: 'ฟิล์มกันรอย', booked: '', bookedPrice: 0, sold: 'TPU', soldPrice: 4000 },
      ],
      extras: { Service: { checked: true, serviceDate: '2026-09-16', serviceCount: 3 } },
    });

  const props = () => ({
    ...baseProps(serviceTicket()),
    initialOptions: options({ extra_options: ['Service'] }),
    // Typed through its argument, so  is the payload.
    extrasAction: vi.fn(async (input: { ticketId: string; extras: Record<string, unknown> }) => ({
      ok: true,
      id: input.ticketId,
    })),
  });

  it('พิมพ์วันนัดแล้วเขียนลงฐานข้อมูลเลย ไม่ต้องรอกดบันทึกใบงาน', async () => {
    const p = props();
    render(<TicketDetail {...p} />);

    fireEvent.change(screen.getByLabelText('วันนัด Service ครั้งที่ 1'), {
      target: { value: '2026-10-05' },
    });

    await vi.waitFor(() => expect(p.extrasAction).toHaveBeenCalled());
    const saved = p.extrasAction.mock.calls[0][0];
    expect(saved.ticketId).toBe('JT-CM-00214');
    const service = saved.extras.Service as {
      schedule?: { no: number; date: string; confirmed: boolean }[];
    };
    // The day the customer agreed, kept as agreed.
    expect(service.schedule?.[0]).toEqual({
      no: 1,
      date: '2026-10-05',
      confirmed: true,
    });
  });

  it('ใบงานใหม่ที่ยังไม่เคยบันทึก ยังเก็บไว้ในร่างตามเดิม', async () => {
    // Nothing to write to yet; the first บันทึกใบงาน carries it.
    const p = { ...props(), isNew: true };
    render(<TicketDetail {...p} />);
    fireEvent.change(screen.getByLabelText('วันนัด Service ครั้งที่ 1'), {
      target: { value: '2026-10-05' },
    });
    expect(p.extrasAction).not.toHaveBeenCalled();
  });
});

/**
 * คำเตือน "ยังไม่ได้บันทึก" ต้องหมายความตามนั้น (ร้านแจ้ง 26 ก.ย. 2569).
 *
 * Visits and policies are written by their own actions and come back through
 * `router.refresh()`, which replaces `initialTicket` and leaves the draft
 * alone. The dirty check compared the two wholesale, so recording one ใบเซอร์วิส
 * left the ticket claiming unsaved changes for the rest of the session — and a
 * warning that is always on is a warning nobody reads.
 */
describe('TicketDetail — มีข้อมูลที่ยังไม่ได้บันทึก', () => {
  const visit = {
    id: 9,
    visitNo: 1,
    plate: '250 กก',
    receivedAt: '2026-09-16',
    receivedTime: '',
    deliveredAt: '',
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
  };

  /** Leaving the page asks first only when there is really something to lose. */
  const leaveAsks = async (ticket: Ticket) => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(ticket)} />);
    await user.click(screen.getByRole('button', { name: /กลับไปรายการใบงาน/ }));
    const asked = ask.mock.calls.length > 0;
    ask.mockRestore();
    return asked;
  };

  it('ใบงานที่เพิ่งบันทึกใบเซอร์วิสไป ไม่ถามว่ามีของค้าง', async () => {
    // Same draft, server copy now carries the visit: not a change of the
    // form's, and not something บันทึกใบงาน would send.
    expect(await leaveAsks(makeTicket({ serviceVisits: [visit] }))).toBe(false);
  });

  it('แต่ถ้าแก้ของในฟอร์มจริง ๆ ยังถามเหมือนเดิม', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(makeTicket({ serviceVisits: [visit] }))} />);
    await user.click(screen.getByRole('button', { name: /รายได้ Finnix$/ }));
    await user.click(screen.getByRole('button', { name: /กลับไปรายการใบงาน/ }));
    expect(ask).toHaveBeenCalled();
    ask.mockRestore();
  });
});
