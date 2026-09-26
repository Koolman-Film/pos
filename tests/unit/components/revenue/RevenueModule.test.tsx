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
  finnixDocNo: '',
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

  it('does not show the ยอดที่ออกใบกำกับภาษี card', () => {
    // ซ่อนไว้ก่อน (ร้านขอ 19 ก.ย. 2569). Which sales carry a tax invoice is
    // still answerable through the ใบกำกับภาษี filter and the column below.
    renderModule([line({ amount: 30000, taxInvoiceNo: 'INV-CM-00216' })]);
    expect(screen.queryByText('ยอดที่ออกใบกำกับภาษี')).not.toBeInTheDocument();
    expect(screen.getByLabelText('กรองตามใบกำกับภาษี')).toBeInTheDocument();
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
    // The branch sheet: the sale rows, then its table and branch total rows.
    const sales = payload.groups[0].rows.filter((r) => r['ใบงาน']);
    expect(sales).toHaveLength(1);
    expect(sales[0]['เลขที่ใบกำกับภาษี']).toBe('INV-CM-00216');
  });
});

/**
 * กำไรขั้นต้น — ซ่อนการ์ดไว้ก่อน (ร้านขอ 19 ก.ย. 2569).
 *
 * The shop has not settled what ต้นทุนขาย means: the lots a job drew on
 * (migration 0027, which is what the per-line ต้นทุน below still is), or the
 * ต้นทุนขาย category in ค่าใช้จ่าย. The export keeps carrying the per-line cost
 * for whoever may see it; the screen shows no margin until that is decided.
 */
describe('RevenueModule — กำไรขั้นต้น', () => {
  it('does not show the กำไรขั้นต้น card, whoever is reading', () => {
    renderModule([line({ amount: 30000, cost: 18000 })], { canSeeCost: true });
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
 * รายได้ Finnix (migration 0031).
 *
 * Some jobs are taken here for another Finnix shop: the customer pays at this
 * counter, so the cash is real and on the ticket, but the takings are not this
 * branch's. Counting it as ยอดขาย overstates every figure on the page — and
 * disagrees with the dashboard, which leaves it out too.
 */
describe('RevenueModule — รายได้ Finnix', () => {
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

    const heldCard = screen.getByText('รายได้ Finnix').parentElement!;
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

    const report = screen.getByText(/รายได้ Finnix \(1 ใบงาน\)/).closest('div')!.parentElement!;
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
    expect(screen.queryByText(/รายได้ Finnix \(/)).not.toBeInTheDocument();
    // The card still shows, so the shop can see the figure is zero.
    expect(screen.getByText('รายได้ Finnix')).toBeInTheDocument();
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

/**
 * รายงานรายได้ (ร้านขอ 22 ก.ย. 2569) — "ยังขาดข้อมูลการชำระเงิน, จองผ่าน,
 * ยี่ห้อ/รุ่น ซึ่งจำเป็น".
 */
describe('RevenueModule — จองผ่าน / ยี่ห้อรุ่น / การชำระเงิน ในรายงาน', () => {
  it('carries the booking channel, the car and the payment on every exported row', async () => {
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
    const paid = {
      methods: 'เงินสดหน้าร้าน, โอน กสิกร',
      status: 'ค้างชำระ',
      paid: 3000,
      due: 1500,
    };
    renderModule(
      [
        line({
          bookingChannel: 'เพจร้าน',
          car: 'Honda City',
          amount: 3000,
          payment: paid,
        }),
        line({
          product: 'ลำโพง JBL',
          category: 'เครื่องเสียง',
          amount: 1500,
          bookingChannel: 'เพจร้าน',
          car: 'Honda City',
          payment: paid,
        }),
      ],
      { canExport: true, exportAction },
    );
    await user.click(screen.getByRole('button', { name: /Excel/ }));

    const rows = exportAction.mock.calls[0][0].groups[0].rows.filter((r) => r['ใบงาน']);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({
        'ยี่ห้อ/รุ่น': 'Honda City',
        จองผ่าน: 'เพจร้าน',
        วิธีชำระ: 'เงินสดหน้าร้าน, โอน กสิกร',
        สถานะชำระ: 'ค้างชำระ',
      });
    }
    // Summed down the column, the ticket's money is counted once — on the
    // first of its lines, whichever that is after the filters.
    expect(rows.reduce((s, r) => s + Number(r['ชำระแล้ว']), 0)).toBe(3000);
    expect(rows.reduce((s, r) => s + Number(r['ค้างชำระ']), 0)).toBe(1500);
  });
});

/**
 * รายงานรายได้ PDF และการจัดเรียง (ร้านขอ 22 ก.ย. 2569): สาขา → แหล่งเงิน →
 * วันที่, a table per แหล่งเงิน with its totals, and the grand total.
 */
describe('RevenueModule — รายงานแยกตาราง', () => {
  const cash = { methods: 'เงินสดหน้าร้าน', status: 'ชำระครบ', paid: 3000, due: 0 };
  const bank = { methods: 'โอน กสิกร', status: 'ค้างชำระ', paid: 1000, due: 4000 };
  const lines = [
    line({ ticketId: 'JT-CM-00002', soldAt: thisMonth(9), amount: 5000, payment: bank }),
    line({ ticketId: 'JT-CM-00001', soldAt: thisMonth(3), amount: 3000, payment: cash }),
    line({ ticketId: 'JT-CM-00003', soldAt: thisMonth(4), amount: 2000 }),
  ];

  it('prints a table per แหล่งเงิน with its totals, unpaid last, and the grand total', async () => {
    let printed = '';
    vi.spyOn(window, 'print').mockImplementation(() => {
      printed = document.querySelector('.print-area')?.textContent ?? '';
    });
    const user = userEvent.setup();
    renderModule(lines, { canExport: true });
    await user.click(screen.getByRole('button', { name: /PDF/ }));

    const order = ['แหล่งเงิน: เงินสดหน้าร้าน', 'แหล่งเงิน: โอน กสิกร', 'แหล่งเงิน: ยังไม่ชำระ'];
    for (const t of order) expect(printed).toContain(t);
    expect(order.map((t) => printed.indexOf(t))).toEqual(
      [...order.map((t) => printed.indexOf(t))].sort((a, b) => a - b),
    );
    expect(printed).toContain('รวม แหล่งเงิน โอน กสิกร');
    expect(printed).toContain(
      'ยอดรวมทั้งหมด: ยอดขาย 10,000.00 · ชำระแล้ว 4,000.00 · ค้างชำระ 4,000.00',
    );
    // Built for the print only, then gone.
    expect(document.querySelector('.print-area')).toBeNull();
  });

  it('gives the Excel file the same tables, and a summary sheet with the grand total', async () => {
    const exportAction = vi.fn(
      async (payload: {
        fileNameBase: string;
        groups: { sheetName: string; rows: Record<string, string | number>[] }[];
      }) => {
        void payload;
        return null;
      },
    );
    const user = userEvent.setup();
    renderModule(lines, { canExport: true, exportAction });
    await user.click(screen.getByRole('button', { name: /Excel/ }));
    const groups = exportAction.mock.calls[0][0].groups;
    expect(groups.map((g) => g.sheetName)).toEqual(['FINNIX CM', 'สรุปรวม']);
    expect(
      groups[0].rows.map((r) => r['ลูกค้า']).filter((c) => String(c).startsWith('รวม')),
    ).toEqual([
      'รวม แหล่งเงิน เงินสดหน้าร้าน',
      'รวม แหล่งเงิน โอน กสิกร',
      'รวม แหล่งเงิน ยังไม่ชำระ',
      'รวมทั้งสาขา FINNIX CM',
    ]);
    expect(groups[1].rows.at(-1)).toMatchObject({ สาขา: 'ยอดรวมทั้งหมด', ยอดขาย: 10000 });
  });
});
