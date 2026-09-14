import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import type { WsOrder } from '@/components/wholesale/types';
import { WholesaleList } from '@/components/wholesale/WholesaleList';

/**
 * เปิดรายการขายส่งจากการแจ้งเตือน.
 *
 * An alert that says "เลยกำหนดชำระ 1" has to open a list of exactly that one PO,
 * or the next number on the bell will not be believed.
 */

const base = {
  shop: 'north',
  customerId: 1,
  status: 'รอจัดส่ง',
  salesBy: 'โหน่ง',
  items: [{ name: 'ฟิล์ม', qty: 1, listPrice: 1000, requestedPrice: 1000, reason: '' }],
  returns: [],
  adjustments: [],
  payments: [],
  createdAt: '2020-01-01T00:00:00Z',
};

const ORDERS = [
  { ...base, id: 'WS-NT-LATE', dueAt: '2020-01-01' },
  { ...base, id: 'WS-NT-FUTURE', dueAt: '2099-01-01' },
  { ...base, id: 'WS-NT-KEN-LATE', dueAt: '2020-01-01', salesBy: 'เคน' },
] as unknown as WsOrder[];

function renderList(props: { initialFlag?: string; initialSale?: string }) {
  render(
    <WholesaleList
      orders={ORDERS}
      customers={[{ id: 1, name: 'ร้านออโต้สไตล์', phone: '', address: '' }]}
      caps={{}}
      wsStatuses={{}}
      accessibleShops={[{ id: 'north', name: 'Finnix North' }]}
      {...props}
    />,
  );
}

describe('WholesaleList — ?flag= from an alert', () => {
  it('opens on exactly the overdue POs, whatever period is selected', () => {
    renderList({ initialFlag: 'overdue' });
    expect(screen.getAllByText('WS-NT-LATE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('WS-NT-KEN-LATE').length).toBeGreaterThan(0);
    expect(screen.queryByText('WS-NT-FUTURE')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /กำลังกรอง: เลยกำหนดชำระ/ })).toBeInTheDocument();
  });

  it("opens a rep's alert on that rep's POs", () => {
    renderList({ initialFlag: 'overdue', initialSale: 'โหน่ง' });
    expect(screen.getAllByText('WS-NT-LATE').length).toBeGreaterThan(0);
    expect(screen.queryByText('WS-NT-KEN-LATE')).not.toBeInTheDocument();
  });

  it('ignores a flag it does not know', () => {
    renderList({ initialFlag: 'nonsense' });
    expect(screen.queryByRole('button', { name: /กำลังกรอง/ })).not.toBeInTheDocument();
  });
});
