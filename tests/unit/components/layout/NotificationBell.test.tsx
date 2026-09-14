import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

import { NotificationBell } from '@/components/layout/NotificationBell';
import type { AlertSnapshot } from '@/lib/alerts/types';

/**
 * การแจ้งเตือน — the bell, the once-a-day window, and the urgent toast.
 */

const ALERTS: AlertSnapshot['alerts'] = [
  {
    key: 'cheque.due',
    level: 'urgent',
    title: 'เช็คถึงวันหน้าเช็คแล้ว ยังไม่ยืนยันเงินเข้า',
    count: 1,
    href: '/wholesale?flag=cheques',
    itemIds: ['cheque:WS-NT-0002'],
    examples: ['WS-NT-0002'],
  },
  {
    key: 'po.badDebt',
    level: 'todo',
    title: 'ขอตัดหนี้สูญ รออนุมัติ',
    count: 3,
    href: '/wholesale?status=ค้างชำระ',
    itemIds: ['baddebt:A', 'baddebt:B', 'baddebt:C'],
    examples: ['A', 'B', 'C'],
  },
  {
    key: 'stock.low',
    level: 'info',
    title: 'สินค้าต่ำกว่าจำนวนขั้นต่ำ',
    count: 5,
    href: '/stock',
    itemIds: ['s1', 's2', 's3', 's4', 's5'],
    examples: [],
  },
];

const snapshot = (over: Partial<AlertSnapshot> = {}): AlertSnapshot => ({
  today: '2026-09-14',
  alerts: ALERTS,
  ackedToday: false,
  ackedKeys: [],
  ...over,
});

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('NotificationBell', () => {
  it('counts ด่วน and ต้องทำ on the bell, but not แจ้งให้ทราบ', async () => {
    render(
      <NotificationBell
        loadAction={vi.fn(async () => snapshot({ ackedToday: true }))}
        ackAction={vi.fn(async () => ({ ok: true }))}
      />,
    );
    expect(
      await screen.findByRole('button', { name: 'การแจ้งเตือน 4 เรื่อง' }),
    ).toBeInTheDocument();
  });

  it('shows no count at all when there is nothing to do', async () => {
    const load = vi.fn(async () => snapshot({ alerts: [], ackedToday: true }));
    render(<NotificationBell loadAction={load} ackAction={vi.fn(async () => ({ ok: true }))} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'การแจ้งเตือน' })).toBeInTheDocument();
  });

  it('opens the day with a summary of what is waiting', async () => {
    render(
      <NotificationBell
        loadAction={vi.fn(async () => snapshot())}
        ackAction={vi.fn(async () => ({ ok: true }))}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'สิ่งที่รอคุณวันนี้' });
    expect(dialog).toHaveTextContent('เช็คถึงวันหน้าเช็คแล้ว');
    expect(dialog).toHaveTextContent('ขอตัดหนี้สูญ');
    // แจ้งให้ทราบ never interrupts.
    expect(dialog).not.toHaveTextContent('สินค้าต่ำกว่าจำนวนขั้นต่ำ');
  });

  it('hides until tomorrow on รับทราบ, recording the urgent records it showed', async () => {
    const user = userEvent.setup();
    const ack = vi.fn(async () => ({ ok: true }));
    render(<NotificationBell loadAction={vi.fn(async () => snapshot())} ackAction={ack} />);
    await user.click(await screen.findByRole('button', { name: 'รับทราบ · ซ่อนถึงพรุ่งนี้' }));
    expect(ack).toHaveBeenCalledWith(['cheque:WS-NT-0002']);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not open the window again once today is acknowledged', async () => {
    const load = vi.fn(async () =>
      snapshot({ ackedToday: true, ackedKeys: ['cheque:WS-NT-0002'] }),
    );
    render(<NotificationBell loadAction={load} ackAction={vi.fn(async () => ({ ok: true }))} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closing without acknowledging does not record anything', async () => {
    const user = userEvent.setup();
    const ack = vi.fn(async () => ({ ok: true }));
    render(<NotificationBell loadAction={vi.fn(async () => snapshot())} ackAction={ack} />);
    await user.click(await screen.findByRole('button', { name: 'ปิดไว้ก่อน' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(ack).not.toHaveBeenCalled();
  });

  it('points out an urgent record that appeared after acknowledging', async () => {
    const load = vi.fn(async () => snapshot({ ackedToday: true, ackedKeys: [] }));
    render(<NotificationBell loadAction={load} ackAction={vi.fn(async () => ({ ok: true }))} />);
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('มีเรื่องด่วนใหม่');
    expect(toast).toHaveTextContent('เช็คถึงวันหน้าเช็คแล้ว');
  });

  it('lists every alert, grouped, each opening its filtered list', async () => {
    const user = userEvent.setup();
    render(
      <NotificationBell
        loadAction={vi.fn(async () =>
          snapshot({ ackedToday: true, ackedKeys: ['cheque:WS-NT-0002'] }),
        )}
        ackAction={vi.fn(async () => ({ ok: true }))}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'การแจ้งเตือน 4 เรื่อง' }));
    expect(screen.getByText('ด่วน')).toBeInTheDocument();
    expect(screen.getByText('ต้องทำ')).toBeInTheDocument();
    expect(screen.getByText('แจ้งให้ทราบ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ขอตัดหนี้สูญ/ })).toHaveAttribute(
      'href',
      '/wholesale?status=ค้างชำระ',
    );
  });
});
