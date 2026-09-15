import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import type { WsOrder } from '@/components/wholesale/types';
import { WholesaleList } from '@/components/wholesale/WholesaleList';

/**
 * ค้นหา PO — the wholesale list had no search box at all, so finding one PO
 * meant narrowing four dropdowns and a period and reading the rest by eye.
 */

const base = {
  shop: 'north',
  status: 'รอจัดส่ง',
  returns: [],
  adjustments: [],
  payments: [],
  // Long ago: a search must find a PO whatever period is selected.
  createdAt: '2020-01-01T00:00:00Z',
};

const ORDERS = [
  {
    ...base,
    id: 'WS-NT-0001',
    customerId: 1,
    salesBy: 'โหน่ง',
    items: [{ name: 'ฟิล์ม 3M', qty: 10, listPrice: 1000, requestedPrice: 1000, reason: '' }],
  },
  {
    ...base,
    id: 'WS-NT-0002',
    customerId: 2,
    salesBy: 'เคน',
    items: [{ name: 'ลำโพง JBL', qty: 3, listPrice: 7250, requestedPrice: 7250, reason: '' }],
  },
] as unknown as WsOrder[];

const CUSTOMERS = [
  { id: 1, name: 'ร้านออโต้สไตล์', phone: '053-111-222', address: '' },
  { id: 2, name: 'ร้านดีคาร์แคร์', phone: '089-111-2222', address: '' },
];

function renderList(initialSearch?: string) {
  render(
    <WholesaleList
      orders={ORDERS}
      customers={CUSTOMERS}
      caps={{}}
      wsStatuses={{}}
      accessibleShops={[{ id: 'north', name: 'Finnix North' }]}
      initialSearch={initialSearch}
    />,
  );
}

const shows = (id: string) => screen.queryAllByText(id).length > 0;

describe('WholesaleList — ค้นหา', () => {
  it.each([
    ['the PO number', '0002'],
    ["the customer's phone, typed without dashes", '0891112222'],
    ['the customer', 'ดีคาร์'],
    ['the rep', 'เคน'],
    ['the product', 'JBL'],
    ['the total', '21750'],
  ])('finds a PO by %s', async (_what, words) => {
    renderList();
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'ค้นหา PO' }), words);
    expect(shows('WS-NT-0002')).toBe(true);
    expect(shows('WS-NT-0001')).toBe(false);
  });

  it('opens already searched when the header sent a search', () => {
    renderList('ออโต้สไตล์');
    expect(shows('WS-NT-0001')).toBe(true);
    expect(shows('WS-NT-0002')).toBe(false);
  });
});
