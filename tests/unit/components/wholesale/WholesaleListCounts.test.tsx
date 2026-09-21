import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { DEFAULT_WS_STATUS, type WsOrder } from '@/components/wholesale/types';
import { WholesaleList } from '@/components/wholesale/WholesaleList';

/**
 * ตัวเลขบนปุ่มสถานะ (ร้านแจ้ง 21 ก.ย. 2569) — "มีจำนวนสถานะค้าง แต่ไม่มีรายละเอียด".
 *
 * On Finnix North, year 2569, the chip read รออนุมัติราคา 1 and pressing it
 * showed nothing: the chips counted every PO in every branch and period, the
 * rows only the ones in view. A number on a chip is a promise about what
 * pressing it will show.
 */

const thisYear = new Date().toISOString();
const po = (id: string, shop: string, status: string, createdAt = thisYear) =>
  ({
    id,
    shop,
    status,
    customerId: 1,
    salesBy: '',
    items: [{ name: 'ฟิล์ม 3M', qty: 1, listPrice: 1000, requestedPrice: 1000, reason: '' }],
    returns: [],
    adjustments: [],
    payments: [],
    createdAt,
  }) as unknown as WsOrder;

const ORDERS = [
  po('WS-NT-0001', 'north', 'จัดส่งแล้ว'),
  po('WS-NT-0002', 'north', 'จัดส่งแล้ว'),
  // The one waiting for approval is in ANOTHER branch.
  po('WS-CM-0001', 'cm', 'รออนุมัติราคา'),
];

const SHOPS = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'north', name: 'Finnix North' },
];

function renderList(orders = ORDERS) {
  render(
    <WholesaleList
      orders={orders}
      customers={[{ id: 1, name: 'ร้านออโต้สไตล์', phone: '', address: '' }]}
      caps={{}}
      wsStatuses={DEFAULT_WS_STATUS}
      accessibleShops={SHOPS}
    />,
  );
  return userEvent.setup();
}

const chip = (name: RegExp) => screen.getByRole('button', { name });

describe('WholesaleList — ตัวเลขบนปุ่มสถานะ', () => {
  it('counts only the branch in view', async () => {
    const user = renderList();
    await user.click(
      within(screen.getByRole('group', { name: 'เลือกสาขา' })).getByRole('button', {
        name: 'Finnix North',
      }),
    );
    expect(chip(/^ทั้งหมด 2$/)).toBeInTheDocument();
    expect(chip(/^รออนุมัติราคา 0$/)).toBeInTheDocument();
    expect(chip(/^จัดส่งแล้ว 2$/)).toBeInTheDocument();
  });

  it('never promises rows the list will not show', async () => {
    const user = renderList();
    await user.click(
      within(screen.getByRole('group', { name: 'เลือกสาขา' })).getByRole('button', {
        name: /เชียงใหม่/,
      }),
    );
    await user.click(chip(/^รออนุมัติราคา 1$/));
    // Rows open on click rather than being links; the PO number is on each.
    expect(screen.getAllByText('WS-CM-0001').length).toBeGreaterThan(0);
    expect(screen.queryByText('WS-NT-0001')).not.toBeInTheDocument();
  });

  it('counts only the period in view', () => {
    // A PO from years ago is not in this month's chips.
    renderList([...ORDERS, po('WS-NT-0000', 'north', 'รออนุมัติราคา', '2020-01-01T00:00:00Z')]);
    expect(chip(/^รออนุมัติราคา 1$/)).toBeInTheDocument();
  });
});
