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
