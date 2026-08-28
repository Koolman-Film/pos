import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

    // Unticked extras are folded away until the section is opened.
    fireEvent.click(screen.getByRole('button', { name: /^ข้อมูลเพิ่มเติม/ }));
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

    await user.click(screen.getByLabelText(/พิมพ์ใบเคลมประกัน/));

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

  it('prints the latest claim when the button did not name one', async () => {
    // The ปุ่มใบเคลม on the policy row passes no claim. Printing the claim boxes
    // blank while a claim is on file is the same paperwork done twice.
    const user = userEvent.setup();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    renderWithPolicy();

    await user.click(screen.getByLabelText(/พิมพ์ใบเคลมประกัน/));

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

    const held = screen.getByRole('button', { name: /รับแทน Finnix/ });
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
 * ใบกำกับภาษีกับเงินที่รับแทน Finnix.
 *
 * A tax invoice asserts that THIS shop made the sale. A held ticket is another
 * Finnix shop's sale, so issuing one here would put a document into this shop's
 * tax position for money it never earned.
 */
describe('TicketDetail — ล็อกใบกำกับภาษีเมื่อรับแทน Finnix', () => {
  const TAX = 'ใบกำกับภาษี/ใบเสร็จรับเงิน';

  it('locks the tax invoice the moment the ticket becomes รับแทน', async () => {
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(makeTicket())} />);

    expect(screen.getByRole('button', { name: TAX })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /รับแทน Finnix/ }));
    expect(screen.getByRole('button', { name: new RegExp(TAX) })).toBeDisabled();
    expect(screen.getByText(/จึงออกใบกำกับภาษีไม่ได้/)).toBeInTheDocument();
  });

  it('moves the selection off the tax invoice rather than leaving it selected', async () => {
    // Otherwise the ออก… button would still offer the one document now refused.
    const user = userEvent.setup();
    render(<TicketDetail {...baseProps(makeTicket())} />);

    await user.click(screen.getByRole('button', { name: TAX }));
    await user.click(screen.getByRole('button', { name: /รับแทน Finnix/ }));

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
