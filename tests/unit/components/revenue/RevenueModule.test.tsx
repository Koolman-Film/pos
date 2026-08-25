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
