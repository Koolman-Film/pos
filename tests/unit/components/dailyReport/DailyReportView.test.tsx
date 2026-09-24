import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}));

import type { DailyReport } from '@/components/dailyReport/buildDailyReport';
import { DailyReportView } from '@/components/dailyReport/DailyReportView';

/**
 * สรุปการเงินประจำวัน — the screen. The arithmetic is pinned in
 * buildDailyReport.test.ts; this pins that every section shows it, and that
 * the day and branch are URLs.
 */

const REPORT: DailyReport = {
  day: '2026-09-22',
  sales: {
    channels: [
      {
        channel: 'ปลีก',
        total: 11500,
        count: 3,
        categories: [
          { name: 'ฟิล์มกรองแสง', amount: 7500, count: 2 },
          { name: 'เครื่องเสียง', amount: 4000, count: 1 },
        ],
      },
      {
        channel: 'ขายส่ง',
        total: 8000,
        count: 1,
        categories: [{ name: 'ลำโพง', amount: 8000, count: 1 }],
      },
    ],
    total: 19500,
    previousTotal: 10000,
    held: 700,
    documents: 4,
    outstanding: { count: 5, amount: 42300 },
  },
  inflow: {
    rows: [
      { key: 'a1', shop: 'cm', accountId: 1, name: 'เงินสดหน้าร้าน', amount: 7500, count: 2 },
      { key: 'lcm:โอน TTB', shop: 'cm', accountId: null, name: 'โอน TTB', amount: 700, count: 1 },
    ],
    total: 8200,
  },
  outflow: {
    rows: [{ key: 'a3', shop: 'cm', accountId: 3, name: 'เงินสดย่อย', amount: 350, count: 1 }],
    total: 350,
  },
  balances: [
    {
      shop: 'cm',
      name: 'Finnix Film เชียงใหม่',
      total: 7650,
      accounts: [
        {
          accountId: 3,
          shop: 'cm',
          name: 'เงินสดย่อย',
          kind: 'petty',
          opening: 200,
          inflow: 0,
          outflow: 350,
          transfer: 0,
          closing: -150,
        },
      ],
    },
  ],
  hasUnmatched: true,
};

const SHOPS = [
  { id: 'cm', name: 'Finnix Film เชียงใหม่' },
  { id: 'north', name: 'Central Audio' },
];

function renderView() {
  return render(
    <DailyReportView
      report={REPORT}
      today="2026-09-23"
      shopFilter="all"
      shops={SHOPS}
      scopeName="ทุกสาขา"
      showShopColumn={false}
      basePath="/daily-report"
    />,
  );
}

describe('DailyReportView', () => {
  beforeEach(() => nav.push.mockReset());

  it('shows the four headline figures', () => {
    renderView();
    expect(screen.getAllByText('19,500.00').length).toBeGreaterThan(0);
    expect(screen.getByText('▲ 95% จากเมื่อวาน · 4 งาน')).toBeInTheDocument();
    expect(screen.getAllByText('+7,850.00').length).toBeGreaterThan(0);
  });

  it('splits sales into ขายปลีก and ขายส่ง, then by ชนิดสินค้า', () => {
    renderView();
    const sales = screen
      .getByRole('heading', { name: /① ยอดขาย/ })
      .closest('.card')! as HTMLElement;
    expect(within(sales).getByText('ขายปลีก')).toBeInTheDocument();
    expect(within(sales).getByText('ขายส่ง')).toBeInTheDocument();
    expect(within(sales).getByText('ฟิล์มกรองแสง')).toBeInTheDocument();
    expect(within(sales).getByText(/เงินรอคืน Finnix 700.00/)).toBeInTheDocument();
  });

  it('shows how many jobs each line is, and the jobs still owed money', () => {
    renderView();
    const sales = screen.getByRole('heading', { name: /① ยอดขาย/ }).closest('.card') as HTMLElement;
    const film = within(sales).getByText('ฟิล์มกรองแสง').closest('tr') as HTMLElement;
    expect(within(film).getByText('2')).toBeInTheDocument();
    const due = within(sales).getByText('งานขายค้างชำระ').closest('tr') as HTMLElement;
    expect(within(due).getByText('5')).toBeInTheDocument();
    expect(within(due).getByText('42,300.00')).toBeInTheDocument();
  });

  it('flags a label no account claims, and a negative balance', () => {
    renderView();
    expect(screen.getByText(/ยังไม่ได้ผูกกับบัญชีใด/)).toBeInTheDocument();
    expect(screen.getByText('-150.00 ⚠')).toBeInTheDocument();
  });

  it('moves between days and branches by URL', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'วันก่อนหน้า' }));
    expect(nav.push).toHaveBeenLastCalledWith('/daily-report?d=2026-09-21&shop=all');
    await userEvent.click(screen.getByRole('button', { name: 'วันถัดไป' }));
    expect(nav.push).toHaveBeenLastCalledWith('/daily-report?d=2026-09-23&shop=all');
    await userEvent.click(screen.getByRole('button', { name: 'Central Audio' }));
    expect(nav.push).toHaveBeenLastCalledWith('/daily-report?d=2026-09-22&shop=north');
  });
});
