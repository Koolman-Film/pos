import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BranchComparison } from '@/components/dashboard/BranchComparison';
import { buildBranchComparison } from '@/components/dashboard/branchTotals';

/**
 * เปรียบเทียบรายสาขา.
 *
 * Management could ask the dashboard "how is this branch doing" or "how is the
 * business doing" and nothing in between, so comparing five branches meant
 * choosing each one from the filter in turn and copying the numbers onto paper.
 */

const shops = [
  { id: 'cm', name: 'FINNIX เชียงใหม่' },
  { id: 'lp', name: 'FINNIX ลำพูน' },
  { id: 'py', name: 'FINNIX พะเยา' },
];

const figures: Record<string, ReturnType<Parameters<typeof buildBranchComparison>[1]>> = {
  cm: {
    revenue: 120_000,
    expenses: 40_000,
    profit: 80_000,
    jobs: 12,
    receivable: 9_000,
    heldForFinnix: 0,
    payable: 108_400,
  },
  lp: {
    revenue: 45_000,
    expenses: 60_000,
    profit: -15_000,
    jobs: 4,
    receivable: 0,
    heldForFinnix: 7_500,
    payable: 0,
  },
  py: {
    revenue: 80_000,
    expenses: 20_000,
    profit: 60_000,
    jobs: 9,
    receivable: 2_000,
    heldForFinnix: 0,
    payable: 12_000,
  },
};
const data = buildBranchComparison(shops, (shop) => figures[shop]);

describe('buildBranchComparison', () => {
  it('ranks by ยอดขาย so the question the card exists for is answered by row order', () => {
    expect(data.rows.map((r) => r.shop)).toEqual(['cm', 'py', 'lp']);
  });

  it('totals every column, including a branch running at a loss', () => {
    // 80,000 + 60,000 − 15,000. A total that skipped the negative would flatter
    // the group by the exact amount that most needs looking at.
    expect(data.total.profit).toBe(125_000);
    expect(data.total.revenue).toBe(245_000);
    expect(data.total.jobs).toBe(25);
    expect(data.total.heldForFinnix).toBe(7_500);
    expect(data.total.payable).toBe(120_400);
  });

  it('keeps ค้างจ่าย out of ค่าใช้จ่าย, so คงเหลือ is not understated', () => {
    // เชียงใหม่ owes 108,400 that has not left the bank. Folding it into
    // ค่าใช้จ่าย would drag its คงเหลือ from 80,000 to a loss on money it still
    // holds — which is why the debt gets a column of its own instead.
    const cm = data.rows.find((r) => r.shop === 'cm')!;
    expect(cm.profit).toBe(80_000);
    expect(cm.payable).toBe(108_400);
  });
});

describe('BranchComparison card', () => {
  it('names every branch with its rank and its figures', () => {
    render(<BranchComparison data={data} caption="รายเดือน · กันยายน 2569" />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('FINNIX เชียงใหม่')).toBeInTheDocument();
    expect(within(table).getByText('FINNIX ลำพูน')).toBeInTheDocument();
    // getAllByText: the figure sits in a span inside the cell, so both match.
    expect(within(table).getAllByText('120,000.00').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('245,000.00').length).toBeGreaterThan(0);
    expect(within(table).getByText('รวมทุกสาขา')).toBeInTheDocument();
    expect(screen.getByText('รายเดือน · กันยายน 2569')).toBeInTheDocument();
  });

  it('reorders when another column is chosen', async () => {
    const user = userEvent.setup();
    render(<BranchComparison data={data} />);
    // By ค้างรับ, ลำพูน (0) drops to the bottom and พะเยา rises above it.
    await user.click(screen.getByRole('button', { name: /จัดอันดับตาม ค้างรับ/ }));
    const names = screen
      .getAllByRole('row')
      .slice(1, 4)
      .map((r) => r.textContent);
    expect(names[0]).toContain('เชียงใหม่');
    expect(names[2]).toContain('ลำพูน');
  });

  it('says so rather than rendering an empty table when there are no branches', () => {
    render(<BranchComparison data={buildBranchComparison([], () => figures.cm)} />);
    expect(screen.getByText('ไม่มีสาขาให้เปรียบเทียบ')).toBeInTheDocument();
  });
});
