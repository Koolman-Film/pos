import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { AccountingModule } from '@/components/accounting/AccountingModule';

const expenses = [
  {
    id: 1,
    shop: 'cm',
    desc: 'ค่าเช่าร้านเดือนกรกฎาคม',
    category: 'ค่าเช่า',
    source: 'บัญชีธนาคารสาขา',
    amount: 35000,
    status: 'จ่ายแล้ว',
  },
];
const pettyCash = [{ id: 1, shop: 'cm', type: 'เติมเงิน', amount: 10000 }];

describe('AccountingModule', () => {
  it('hides the topup-cash button when canDo("accounting.topupCash") is false', () => {
    render(<AccountingModule expenses={expenses} pettyCash={pettyCash} canDo={() => false} />);
    expect(screen.queryByText('เติมเงินสดย่อย')).not.toBeInTheDocument();
  });

  it('renders an expense row with its amount formatted via lib/domain/format.ts fmt()', () => {
    render(<AccountingModule expenses={expenses} pettyCash={pettyCash} canDo={() => true} />);
    // The formatted amount '35,000.00' appears both in the "จ่ายแล้ว" summary
    // card and in the expense row, so scope the assertion to the expense list
    // (the plan snippet's bare getByText would match both). The intent — the row
    // amount is rendered through fmt() — is what we verify.
    const list = screen.getByText('รายการค่าใช้จ่าย').closest('.card') as HTMLElement;
    expect(within(list).getByText('35,000.00')).toBeInTheDocument();
    expect(within(list).getByText('ค่าเช่าร้านเดือนกรกฎาคม')).toBeInTheDocument();
  });
});

const SHOPS = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'lp', name: 'FINNIX FILM ลำพูน' },
];

/** Paid + pending, in two shops, so filters and totals have something to bite on. */
const mixedExpenses = [
  {
    id: 1,
    shop: 'cm',
    desc: 'ค่าเช่าร้าน',
    category: 'ค่าเช่า',
    source: 'บัญชีธนาคารสาขา',
    amount: 35000,
    status: 'จ่ายแล้ว',
  },
  {
    id: 2,
    shop: 'cm',
    desc: 'ค่าไฟฟ้า',
    category: 'ค่าน้ำ-ไฟ',
    source: 'บัญชีธนาคารสาขา',
    amount: 12400,
    status: 'รอจ่าย',
    due: '25 ก.ค. 2569',
  },
  {
    id: 3,
    shop: 'cm',
    desc: 'ค่ากาแฟ',
    category: 'การตลาด',
    source: 'เงินสดย่อย',
    amount: 150,
    status: 'จ่ายแล้ว',
  },
  {
    id: 4,
    shop: 'lp',
    desc: 'ค่าเช่าลำพูน',
    category: 'ค่าเช่า',
    source: 'บัญชีธนาคารสาขา',
    amount: 20000,
    status: 'จ่ายแล้ว',
  },
];

const renderAccounting = (over: Record<string, unknown> = {}) =>
  render(
    <AccountingModule
      expenses={mixedExpenses}
      pettyCash={pettyCash}
      accessibleShops={SHOPS}
      expenseCategories={['ค่าเช่า', 'ค่าน้ำ-ไฟ', 'การตลาด']}
      paymentSources={['เงินสดย่อย', 'บัญชีธนาคารสาขา']}
      canDo={() => true}
      {...over}
    />,
  );

describe('AccountingModule capability gates', () => {
  it('shows both write buttons for a fully-capable user', () => {
    renderAccounting();
    expect(screen.getByText('เพิ่มรายการ')).toBeInTheDocument();
    // 'เติมเงินสดย่อย' is also the balance-card label, so target the button.
    expect(screen.getByRole('button', { name: /เติมเงินสดย่อย/ })).toBeInTheDocument();
  });

  it('hides the add-expense button on its own capability', () => {
    renderAccounting({ canDo: undefined, canAddExpense: false, canTopupCash: true });
    expect(screen.queryByText('เพิ่มรายการ')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /เติมเงินสดย่อย/ })).toBeInTheDocument();
  });

  it('prefers the explicit boolean props a Server Component passes over canDo', () => {
    // The page cannot hand over a closure, so it pre-evaluates the booleans; when
    // both are present the booleans must win.
    renderAccounting({ canDo: () => true, canAddExpense: false });
    expect(screen.queryByText('เพิ่มรายการ')).not.toBeInTheDocument();
  });

  it('denies by default when given neither form', () => {
    render(<AccountingModule expenses={mixedExpenses} pettyCash={pettyCash} />);
    expect(screen.queryByText('เพิ่มรายการ')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เติมเงินสดย่อย/ })).not.toBeInTheDocument();
  });

  it('gates the Excel export independently', () => {
    const { rerender } = renderAccounting({ canDo: undefined, canExport: true });
    expect(screen.getByText(/Excel/)).toBeInTheDocument();

    rerender(
      <AccountingModule
        expenses={mixedExpenses}
        pettyCash={pettyCash}
        accessibleShops={SHOPS}
        canExport={false}
      />,
    );
    expect(screen.queryByText(/Excel/)).not.toBeInTheDocument();
  });
});

describe('AccountingModule totals', () => {
  it('separates the paid total from the pending total', () => {
    renderAccounting();
    // Shop filter defaults to the first accessible shop (cm), so lp is excluded:
    // paid = 35,000 + 150; pending = 12,400. Both figures also appear on
    // individual rows, so scope to the three summary cards at the top.
    const summary = screen.getByText('เงินสดย่อยคงเหลือ').closest('.grid') as HTMLElement;
    expect(within(summary).getByText('35,150.00')).toBeInTheDocument();
    expect(within(summary).getByText('12,400.00')).toBeInTheDocument();
  });

  it('shows the petty-cash balance as topups minus cash-funded paid expenses', () => {
    // 10,000 topped up, 150 paid from เงินสดย่อย → 9,850.
    renderAccounting();
    expect(screen.getByText('9,850.00')).toBeInTheDocument();
  });

  it('lists both the paid and the pending row', () => {
    // The due date itself is only surfaced on the dashboard's เจ้าหนี้ card in the
    // prototype (:807), not in this list, so do not assert it here.
    renderAccounting();
    const list = screen.getByText('รายการค่าใช้จ่าย').closest('.card') as HTMLElement;
    expect(within(list).getByText('ค่าเช่าร้าน')).toBeInTheDocument();
    expect(within(list).getByText('ค่าไฟฟ้า')).toBeInTheDocument();
  });

  it('survives having no expenses and no petty cash', () => {
    render(<AccountingModule expenses={[]} pettyCash={[]} accessibleShops={SHOPS} />);
    expect(screen.getByText('บัญชี / ค่าใช้จ่าย')).toBeInTheDocument();
  });
});
