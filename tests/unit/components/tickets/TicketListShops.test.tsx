import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TicketList } from '@/components/tickets/TicketList';
import type { TicketListRow } from '@/components/tickets/types';

/**
 * สาขาใน Book งาน เป็นปุ่ม เหมือนแดชบอร์ด — not a dropdown.
 */

const statuses = [{ key: 'จองแล้ว', short: 'จองแล้ว', bg: '#eee', text: '#333', dot: '#999' }];
const row = (id: string, shop: string, customer: string): TicketListRow => ({
  id,
  shop,
  customer,
  plate: '',
  status: 'จองแล้ว',
  items: [],
  payments: [],
});
const shops = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'lp', name: 'FINNIX FILM ลำพูน' },
];

function renderList(canSeeAllShops = true) {
  render(
    <TicketList
      tickets={[row('JT-CM-00001', 'cm', 'คุณ เชียงใหม่'), row('JT-LP-00001', 'lp', 'คุณ ลำพูน')]}
      statuses={statuses}
      canDo={() => true}
      accessibleShops={shops}
      canSeeAllShops={canSeeAllShops}
    />,
  );
}

describe('TicketList — สาขาเป็นปุ่ม', () => {
  it('shows the branches as buttons, and no branch dropdown', () => {
    renderList();
    const group = screen.getByRole('group', { name: 'เลือกสาขา' });
    expect(within(group).getByRole('button', { name: 'ทุกร้าน (2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByLabelText('กรองตามสาขา')).not.toBeInTheDocument();
  });

  it('filters the list to the branch pressed', async () => {
    renderList();
    const group = screen.getByRole('group', { name: 'เลือกสาขา' });
    const lamphun = within(group).getAllByRole('button')[2];
    await userEvent.click(lamphun);
    expect(lamphun).toHaveAttribute('aria-pressed', 'true');
    // The print layout repeats the rows, so the name appears more than once.
    expect(screen.getAllByText('คุณ ลำพูน').length).toBeGreaterThan(0);
    expect(screen.queryByText('คุณ เชียงใหม่')).not.toBeInTheDocument();
  });

  it('offers no ทุกร้าน to someone scoped to their own branches', () => {
    renderList(false);
    const group = screen.getByRole('group', { name: 'เลือกสาขา' });
    expect(within(group).queryByRole('button', { name: /ทุกร้าน/ })).not.toBeInTheDocument();
    expect(within(group).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true');
  });
});
