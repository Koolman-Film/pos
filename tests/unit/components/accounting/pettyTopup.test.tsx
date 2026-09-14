import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { AccountingModule, type TopupInput } from '@/components/accounting/AccountingModule';

/**
 * เติมเงินสดย่อย — ต้องบอกว่าเงินมาจากไหน (migration 0056).
 *
 * The top-up is now a transfer into the branch's petty-cash account, and a
 * transfer has two ends. Leaving the source to a default would file the money
 * against whichever account happened to be first, so the form makes the person
 * choose — นอกระบบ included, as an answer rather than a fallback.
 */

const SHOPS = [{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }];
const ACCOUNTS = [
  { id: 1, shop: 'cm', name: 'เงินสดหน้าร้าน', kind: 'cash' },
  { id: 2, shop: 'cm', name: 'บัญชีธนาคารสาขา', kind: 'bank' },
  { id: 3, shop: 'cm', name: 'เงินสดย่อย', kind: 'petty' },
];

function openTopup(
  action: (input: TopupInput) => Promise<{ ok: boolean; error?: string }>,
  accounts = ACCOUNTS,
) {
  render(
    <AccountingModule
      expenses={[]}
      pettyCash={[]}
      accessibleShops={SHOPS}
      canTopupCash
      topupCashAction={action}
      moneyAccounts={accounts}
    />,
  );
  return userEvent.setup();
}

describe('AccountingModule — เติมเงินสดย่อย', () => {
  it('offers every account of the branch as the source, but not petty cash itself', async () => {
    const user = openTopup(vi.fn(async () => ({ ok: true })));
    await user.click(screen.getByRole('button', { name: /เติมเงินสดย่อย/ }));

    const options = within(screen.getByLabelText('เงินที่เติมมาจากแหล่งไหน'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('เงินสดหน้าร้าน');
    expect(options).toContain('บัญชีธนาคารสาขา');
    expect(options.some((o) => o?.startsWith('นอกระบบ'))).toBe(true);
    expect(options).not.toContain('เงินสดย่อย');
  });

  it('will not save until the source is chosen', async () => {
    const action = vi.fn(async () => ({ ok: true }));
    const user = openTopup(action);
    await user.click(screen.getByRole('button', { name: /เติมเงินสดย่อย/ }));
    await user.clear(screen.getByRole('spinbutton'));
    await user.type(screen.getByRole('spinbutton'), '500');
    await user.click(screen.getByRole('button', { name: 'บันทึกการเติมเงิน' }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('เลือกก่อนว่าเงินที่เติมมาจากแหล่งไหน');
  });

  it('sends the chosen account', async () => {
    const action = vi.fn(async () => ({ ok: true }));
    const user = openTopup(action);
    await user.click(screen.getByRole('button', { name: /เติมเงินสดย่อย/ }));
    await user.selectOptions(screen.getByLabelText('เงินที่เติมมาจากแหล่งไหน'), '2');
    await user.clear(screen.getByRole('spinbutton'));
    await user.type(screen.getByRole('spinbutton'), '500');
    await user.click(screen.getByRole('button', { name: 'บันทึกการเติมเงิน' }));

    await vi.waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({ shop: 'cm', amount: 500, fromAccountId: 2 }),
      ),
    );
  });

  it('sends นอกระบบ as no account', async () => {
    const action = vi.fn(async () => ({ ok: true }));
    const user = openTopup(action);
    await user.click(screen.getByRole('button', { name: /เติมเงินสดย่อย/ }));
    await user.selectOptions(screen.getByLabelText('เงินที่เติมมาจากแหล่งไหน'), 'outside');
    await user.clear(screen.getByRole('spinbutton'));
    await user.type(screen.getByRole('spinbutton'), '200');
    await user.click(screen.getByRole('button', { name: 'บันทึกการเติมเงิน' }));

    await vi.waitFor(() =>
      expect(action).toHaveBeenCalledWith(expect.objectContaining({ fromAccountId: null })),
    );
  });

  it('shows a refusal from the server and keeps the form open', async () => {
    const action = vi.fn(async () => ({ ok: false, error: 'แหล่งเงินต้นทางไม่ได้อยู่ในสาขานี้' }));
    const user = openTopup(action);
    await user.click(screen.getByRole('button', { name: /เติมเงินสดย่อย/ }));
    await user.selectOptions(screen.getByLabelText('เงินที่เติมมาจากแหล่งไหน'), '1');
    await user.clear(screen.getByRole('spinbutton'));
    await user.type(screen.getByRole('spinbutton'), '100');
    await user.click(screen.getByRole('button', { name: 'บันทึกการเติมเงิน' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'แหล่งเงินต้นทางไม่ได้อยู่ในสาขานี้',
    );
    expect(screen.getByRole('button', { name: 'บันทึกการเติมเงิน' })).toBeInTheDocument();
  });

  it('says so when the branch has no petty-cash account to top up', async () => {
    const user = openTopup(
      vi.fn(async () => ({ ok: true })),
      ACCOUNTS.filter((a) => a.kind !== 'petty'),
    );
    await user.click(screen.getByRole('button', { name: /เติมเงินสดย่อย/ }));
    expect(screen.getByText(/ยังไม่มีแหล่งเงินประเภทเงินสดย่อย/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกการเติมเงิน' })).toBeDisabled();
  });
});
