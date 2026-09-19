import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TicketList } from '@/components/tickets/TicketList';
import type { TicketListRow } from '@/components/tickets/types';

/**
 * กรองตามชนิดสินค้า (ร้านขอ 19 ก.ย. 2569) — "งานฟิล์มกันรอยเดือนนี้มีกี่คัน" was a
 * question the list could not answer without reading every row.
 */

const statuses = [{ key: 'จองแล้ว', short: 'จองแล้ว', bg: '#eee', text: '#333', dot: '#999' }];

const row = (id: string, customer: string, categories: string[]): TicketListRow => ({
  id,
  shop: 'cm',
  customer,
  plate: '',
  status: 'จองแล้ว',
  items: categories.map((category) => ({ category, soldPrice: 1000 })),
  payments: [],
});

const tickets = [
  row('JT-CM-00001', 'คุณ ฟิล์มกรองแสง', ['ฟิล์มกรองแสง']),
  row('JT-CM-00002', 'คุณ กันรอย', ['ฟิล์มกันรอย']),
  row('JT-CM-00003', 'คุณ ทั้งสองอย่าง', ['ฟิล์มกรองแสง', 'ฟิล์มกันรอย']),
];

function renderList() {
  render(
    <TicketList
      tickets={tickets}
      statuses={statuses}
      canDo={() => true}
      accessibleShops={[{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }]}
    />,
  );
  return userEvent.setup();
}

const picker = () => screen.getByLabelText('กรองตามชนิดสินค้า');
const shows = (id: string) => !!document.querySelector(`a[href="/tickets/${id}"]`);

describe('TicketList — กรองตามชนิดสินค้า', () => {
  it('offers the kinds of work the branch has on', () => {
    renderList();
    const options = Array.from(picker().querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['ทุกชนิดสินค้า', 'ฟิล์มกรองแสง', 'ฟิล์มกันรอย']);
  });

  it('keeps a job with any line of that kind, and drops the rest', async () => {
    const user = renderList();
    await user.selectOptions(picker(), 'ฟิล์มกันรอย');
    expect(shows('JT-CM-00002')).toBe(true);
    // Two kinds on one job: it is a ฟิล์มกันรอย job too.
    expect(shows('JT-CM-00003')).toBe(true);
    expect(shows('JT-CM-00001')).toBe(false);
  });

  it('counts the status chips over the filtered jobs', async () => {
    const user = renderList();
    await user.selectOptions(picker(), 'ฟิล์มกรองแสง');
    expect(screen.getByRole('button', { name: /ทั้งหมด 2/ })).toBeInTheDocument();
  });

  it('opens already filtered when the link says so', () => {
    render(
      <TicketList
        tickets={tickets}
        statuses={statuses}
        canDo={() => true}
        accessibleShops={[{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }]}
        initialCategory="ฟิล์มกันรอย"
      />,
    );
    expect(picker()).toHaveValue('ฟิล์มกันรอย');
    expect(shows('JT-CM-00001')).toBe(false);
  });
});
