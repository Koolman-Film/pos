import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TicketList } from '@/components/tickets/TicketList';
import type { TicketListRow } from '@/components/tickets/types';

/**
 * ค้นหาใบงาน — by anything the shop might remember a job by.
 *
 * The box used to match only the customer's name and the plate, so a job could
 * not be found by its own ใบงาน number, the customer's phone, or the car.
 */

const statuses = [
  { key: 'รอส่งมอบ', short: 'รอส่งมอบ', bg: '#EAF3EC', text: '#2F6B3F', dot: '#4E9A64' },
];

const a: TicketListRow = {
  id: 'JT-CM-00214',
  shop: 'cm',
  customer: 'คุณ เอ',
  phone: '081-234-5678',
  plate: '250 กก',
  brand: 'Toyota',
  model: 'Vios',
  color: 'ขาว',
  status: 'รอส่งมอบ',
  items: [{ category: 'ฟิล์มกรองแสง', sold: '3M CRM 60%', soldPrice: 9600 }],
  payments: [],
  techByCategory: { ฟิล์มกรองแสง: ['ช่างเอก'] },
};

const b: TicketListRow = {
  id: 'JT-CM-00212',
  shop: 'cm',
  customer: 'คุณ สมชาย',
  phone: '089-999-0000',
  plate: 'ไกข 4521',
  brand: 'Honda',
  model: 'City',
  status: 'รอส่งมอบ',
  items: [{ category: 'เครื่องเสียง', sold: 'JBL Stage', soldPrice: 6700 }],
  payments: [],
  techByCategory: { เครื่องเสียง: ['ช่างนัท'] },
  // A job from long ago: search must still find it whatever period is selected.
  dropOffDateObj: new Date('2025-01-10T09:00:00'),
};

const rowA = 'คุณ เอ · 250 กก';
const rowB = 'คุณ สมชาย · ไกข 4521';

function renderList(initialSearch?: string) {
  render(
    <TicketList
      tickets={[a, b]}
      statuses={statuses}
      canDo={() => true}
      accessibleShops={[{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }]}
      initialSearch={initialSearch}
    />,
  );
}

async function search(words: string) {
  const user = userEvent.setup();
  const box = screen.getByRole('textbox', { name: 'ค้นหาใบงาน' });
  await user.clear(box);
  await user.type(box, words);
}

describe('TicketList — ค้นหา', () => {
  it.each([
    ['the ใบงาน number', '00212'],
    ['the phone, typed without dashes', '0899990000'],
    ['the car', 'honda city'],
    ['the product sold', 'JBL'],
    ['the technician', 'ช่างนัท'],
    ['the total', '6700'],
  ])('finds a job by %s', async (_what, words) => {
    renderList();
    await search(words);
    expect(screen.getByText(rowB)).toBeInTheDocument();
    expect(screen.queryByText(rowA)).not.toBeInTheDocument();
  });

  it('opens already searched when the header sent a search', () => {
    renderList('081-234-5678');
    expect(screen.getByText(rowA)).toBeInTheDocument();
    expect(screen.queryByText(rowB)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'ค้นหาใบงาน' })).toHaveValue('081-234-5678');
  });
});
