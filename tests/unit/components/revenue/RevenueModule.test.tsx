import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RevenueModule } from '@/components/revenue/RevenueModule';
import type { SaleLine } from '@/app/(app)/revenue/data';

/**
 * The shop reads its takings by ชนิดสินค้า — which line earns — and the
 * accountant needs to know which of those sales carry a ใบกำกับภาษี. Those two
 * questions are what this module exists to answer, so they are what these pin.
 */

const thisMonth = (day: number) => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const line = (over: Partial<SaleLine> = {}): SaleLine => ({
  ticketId: 'JT-CM-00216',
  shop: 'cm',
  soldAt: thisMonth(5),
  customer: 'คุณ ปรีชา',
  plate: 'กก 999',
  category: 'ฟิล์มกันรอย',
  product: 'TPU กันรอยเกรดพรีเมียม',
  amount: 30000,
  cost: 0,
  held: false,
  channel: 'ปลีก',
  taxInvoiceNo: '',
  documents: [],
  ...over,
});

function renderModule(lines: SaleLine[], over: Record<string, unknown> = {}) {
  render(
    <RevenueModule
      lines={lines}
      accessibleShops={[{ id: 'cm', name: 'FINNIX CM' }]}
      canSeeAllShops
      canExport={false}
      {...over}
    />,
  );
}

describe('RevenueModule', () => {
  it('splits the period’s takings by ชนิดสินค้า', () => {
    renderModule([
      line(),
      line({ category: 'เครื่องเสียง', product: 'ลำโพง JBL', amount: 4500 }),
      line({
        ticketId: 'JT-CM-00217',
        category: 'เครื่องเสียง',
        product: 'ลำโพง JBL',
        amount: 5500,
      }),
    ]);

    const panel = screen.getByText('ยอดขายแยกตามชนิดสินค้า').parentElement!;
    expect(within(panel).getByText('30,000.00')).toBeInTheDocument();
    // 4,500 + 5,500 across two tickets.
    expect(within(panel).getByText('10,000.00')).toBeInTheDocument();
  });

  it('counts a ticket once however many categories it sold', () => {
    renderModule([line(), line({ category: 'เครื่องเสียง', product: 'ลำโพง JBL', amount: 4500 })]);
    // One ticket, two lines.
    expect(screen.getByText('จำนวนใบงาน').parentElement).toHaveTextContent('1');
  });

  it('shows the tax-invoice number against the sales that have one', () => {
    renderModule([
      line({ taxInvoiceNo: 'INV-CM-00216' }),
      line({ ticketId: 'JT-CM-00217', amount: 12000 }),
    ]);
    expect(screen.getByText('INV-CM-00216')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่ออก')).toBeInTheDocument();
  });

  it('totals how much of the period was invoiced', () => {
    renderModule([
      line({ amount: 30000, taxInvoiceNo: 'INV-CM-00216' }),
      line({ ticketId: 'JT-CM-00217', amount: 10000 }),
    ]);
    const card = screen.getByText('ยอดที่ออกใบกำกับภาษี').parentElement!;
    expect(within(card).getByText('30,000.00')).toBeInTheDocument();
    expect(within(card).getByText(/75% ของยอดขาย/)).toBeInTheDocument();
  });

  it('filters down to the sales still missing a tax invoice', async () => {
    const user = userEvent.setup();
    renderModule([
      line({ taxInvoiceNo: 'INV-CM-00216' }),
      line({ ticketId: 'JT-CM-00217', product: 'ลำโพง JBL', amount: 4500 }),
    ]);

    await user.selectOptions(screen.getByLabelText('กรองตามใบกำกับภาษี'), 'none');
    expect(screen.getByText('ลำโพง JBL')).toBeInTheDocument();
    expect(screen.queryByText('TPU กันรอยเกรดพรีเมียม')).not.toBeInTheDocument();
  });

  it('leaves sales outside the period out of every figure', () => {
    // Default period is this month; a line dated last year must not appear.
    renderModule([line(), line({ ticketId: 'JT-CM-00100', soldAt: '2020-01-05', amount: 99999 })]);
    expect(screen.queryByText('99,999.00')).not.toBeInTheDocument();
    expect(screen.getByText('รายการขาย (1)')).toBeInTheDocument();
  });

  it('drops an undated line rather than counting it in every month', () => {
    // `isInPeriod` treats a missing date as "always in", which would smear a
    // ticket with no วันที่รับงาน across every period the shop looks at.
    renderModule([line({ soldAt: '' })]);
    expect(screen.getByText('รายการขาย (0)')).toBeInTheDocument();
  });

  it('exports what is on screen, not the whole table', async () => {
    const user = userEvent.setup();
    // Typed through its argument so `mock.calls[0][0]` is the payload, not `never`.
    const exportAction = vi.fn(
      async (payload: {
        fileNameBase: string;
        groups: { sheetName: string; rows: Record<string, string | number>[] }[];
      }) => {
        void payload;
        return null;
      },
    );
    renderModule([line({ taxInvoiceNo: 'INV-CM-00216' }), line({ ticketId: 'JT-CM-00217' })], {
      canExport: true,
      exportAction,
    });

    await user.selectOptions(screen.getByLabelText('กรองตามใบกำกับภาษี'), 'tax');
    await user.click(screen.getByRole('button', { name: /Excel/ }));

    const payload = exportAction.mock.calls[0][0];
    expect(payload.groups[0].rows).toHaveLength(1);
    expect(payload.groups[0].rows[0]['เลขที่ใบกำกับภาษี']).toBe('INV-CM-00216');
  });
});

/**
 * กำไรขั้นต้น. The cost comes from the LOTS a job actually drew on (migration
 * 0027), so this is a real margin — and it is behind the same gate as stock
 * prices, because it is the owner's figure rather than the counter's.
 */
describe('RevenueModule — กำไรขั้นต้น', () => {
  it('shows margin against the real cost of the goods', () => {
    renderModule([line({ amount: 30000, cost: 18000 })], { canSeeCost: true });
    const card = screen.getByText('กำไรขั้นต้น').parentElement!;
    expect(within(card).getByText('12,000.00')).toBeInTheDocument();
    expect(within(card).getByText(/ต้นทุน 18,000.00/)).toBeInTheDocument();
    expect(within(card).getByText(/40%/)).toBeInTheDocument();
  });

  it('keeps cost away from a caller who may not see stock prices', () => {
    renderModule([line({ amount: 30000, cost: 18000 })]);
    expect(screen.queryByText('กำไรขั้นต้น')).not.toBeInTheDocument();
  });

  it('adds the cost columns to the export only when they may be seen', async () => {
    const user = userEvent.setup();
    const exportAction = vi.fn(
      async (payload: {
        fileNameBase: string;
        groups: { sheetName: string; rows: Record<string, string | number>[] }[];
      }) => {
        void payload;
        return null;
      },
    );
    renderModule([line({ amount: 30000, cost: 18000 })], {
      canExport: true,
      canSeeCost: true,
      exportAction,
    });

    await user.click(screen.getByRole('button', { name: /Excel/ }));
    const row = exportAction.mock.calls[0][0].groups[0].rows[0];
    expect(row['ต้นทุน']).toBe(18000);
    expect(row['กำไรขั้นต้น']).toBe(12000);
  });
});

/**
 * เงินรอคืน Finnix (migration 0031).
 *
 * Some jobs are taken here for another Finnix shop: the customer pays at this
 * counter, so the cash is real and on the ticket, but the takings are not this
 * branch's. Counting it as ยอดขาย overstates every figure on the page — and
 * disagrees with the dashboard, which leaves it out too.
 */
describe('RevenueModule — เงินรอคืน Finnix', () => {
  it('keeps held money out of ยอดขาย and reports it on its own', () => {
    renderModule([
      line({ amount: 30000 }),
      line({
        ticketId: 'JT-CM-00301',
        customer: 'คุณ สมชาย',
        product: 'TPU กันรอยเต็มคัน',
        amount: 18000,
        held: true,
      }),
    ]);

    // ยอดขายรวม is the 30,000 only.
    const salesCard = screen.getByText('ยอดขายรวม').parentElement!;
    expect(within(salesCard).getByText('30,000.00')).toBeInTheDocument();

    const heldCard = screen.getByText('เงินรอคืน Finnix').parentElement!;
    expect(within(heldCard).getByText('18,000.00')).toBeInTheDocument();
    expect(within(heldCard).getByText(/1 ใบงาน/)).toBeInTheDocument();
  });

  it('lists each held ใบงาน with a link back to it', () => {
    renderModule([
      line({
        ticketId: 'JT-CM-00301',
        customer: 'คุณ สมชาย',
        product: 'TPU กันรอยเต็มคัน',
        amount: 18000,
        held: true,
      }),
    ]);

    const report = screen.getByText(/เงินรอคืน Finnix \(1 ใบงาน\)/).closest('div')!.parentElement!;
    expect(within(report).getByText('คุณ สมชาย')).toBeInTheDocument();
    expect(within(report).getByRole('link', { name: 'JT-CM-00301' })).toHaveAttribute(
      'href',
      '/tickets/JT-CM-00301',
    );
  });

  it('keeps a held job out of the ชนิดสินค้า breakdown as well', () => {
    // The breakdown is a split OF ยอดขาย; a held job in it would not add up.
    renderModule([
      line({ category: 'ฟิล์มกรองแสง', amount: 12000 }),
      line({ ticketId: 'JT-CM-00301', category: 'ฟิล์มกันรอย', amount: 18000, held: true }),
    ]);
    const panel = screen.getByText('ยอดขายแยกตามชนิดสินค้า').parentElement!;
    expect(within(panel).queryByText('ฟิล์มกันรอย')).not.toBeInTheDocument();
  });

  it('says nothing at all when the period holds none', () => {
    renderModule([line()]);
    expect(screen.queryByText(/เงินรอคืน Finnix \(/)).not.toBeInTheDocument();
    // The card still shows, so the shop can see the figure is zero.
    expect(screen.getByText('เงินรอคืน Finnix')).toBeInTheDocument();
    expect(screen.getByText('ไม่มีในช่วงนี้')).toBeInTheDocument();
  });
});

/**
 * ปลีก / ส่ง (ข้อ 5 ของ docs/DESIGN-wholesale-sales-and-channel.md).
 *
 * Central Audio sells retail through Book งาน and wholesale through the ขายส่ง
 * module, and wholesale used to appear in no figure anywhere in the app. Adding
 * it to the totals without saying where it came from would read as takings
 * jumping for no reason, so the split is part of the feature, not decoration.
 */
describe('RevenueModule — ช่องทางการขาย', () => {
  const ws = (over: Partial<SaleLine> = {}) =>
    line({
      ticketId: 'WS-CM-0088',
      channel: 'ส่ง',
      customer: 'ร้านออโต้เซอร์วิส บางแค',
      plate: 'โหน่ง',
      category: 'ฟิล์มกรองแสง',
      product: 'ฟิล์ม 3M CRM (ม้วน)',
      amount: 12000,
      ...over,
    });

  it('แยกยอดปลีกกับยอดส่งให้เห็น', () => {
    renderModule([line({ amount: 30000 }), ws()]);
    const card = screen.getByText('ปลีก / ส่ง').parentElement!;
    expect(card).toHaveTextContent('30,000.00');
    expect(card).toHaveTextContent('12,000.00');
    // One ใบงาน and one PO, counted as what each of them is.
    expect(card).toHaveTextContent('1 ใบงาน · 1 PO');
  });

  it('ไม่แสดงตัวเลือกช่องทางในสาขาที่ไม่ได้ขายส่ง', () => {
    renderModule([line()]);
    expect(screen.queryByLabelText('กรองตามช่องทางการขาย')).not.toBeInTheDocument();
    // The plain count stays where nothing is being split.
    expect(screen.getByText('จำนวนใบงาน')).toBeInTheDocument();
  });

  it('กรองรายการตามช่องทางได้', async () => {
    const user = userEvent.setup();
    renderModule([line({ amount: 30000 }), ws()]);

    await user.selectOptions(screen.getByLabelText('กรองตามช่องทางการขาย'), 'ส่ง');
    expect(screen.getByText('WS-CM-0088')).toBeInTheDocument();
    expect(screen.queryByText('JT-CM-00216')).not.toBeInTheDocument();
    // The split card keeps reading as the whole period, not as the filter.
    expect(screen.getByText('ปลีก / ส่ง').parentElement!).toHaveTextContent('30,000.00');
  });

  it('คิดสัดส่วนใบกำกับภาษีจากยอดขายปลีก ไม่ใช่ยอดรวม', () => {
    // ขายส่งไม่ออกใบกำกับภาษี by design. Measured against the total, the ratio
    // would fall every time the shop sold a case of film and read as a
    // compliance problem that is not one.
    renderModule([line({ amount: 10000, taxInvoiceNo: 'INV-1' }), ws({ amount: 90000 })]);
    expect(screen.getByText('ยอดที่ออกใบกำกับภาษี').parentElement!).toHaveTextContent(
      '100% ของยอดขายปลีก',
    );
  });

  it('ลิงก์ไปหน้า PO ไม่ใช่หน้าใบงาน', () => {
    renderModule([ws()]);
    expect(screen.getByText('WS-CM-0088').closest('a')).toHaveAttribute(
      'href',
      '/wholesale/WS-CM-0088',
    );
  });

  it('รายการขายส่งขึ้นชื่อพนักงานขายแทนทะเบียนรถ', () => {
    renderModule([ws()]);
    expect(screen.getByText('ขายโดย โหน่ง')).toBeInTheDocument();
  });
});
