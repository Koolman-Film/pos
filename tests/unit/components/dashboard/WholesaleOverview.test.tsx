import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WholesaleOverview } from '@/components/dashboard/WholesaleOverview';
import type { WholesaleOverviewData } from '@/components/dashboard/buildWholesaleOverview';

/**
 * การ์ดขายส่งบนแดชบอร์ด — every number opens the list of exactly those POs.
 */

const DATA: WholesaleOverviewData = {
  openCount: 3,
  statusCounts: [
    { status: 'รออนุมัติราคา', count: 1 },
    { status: 'รอจัดส่ง', count: 1 },
    { status: 'จัดส่งแล้ว', count: 1 },
    { status: 'ค้างชำระ', count: 0 },
  ],
  sales: 44500,
  owing: { count: 2, amount: 44500 },
  overdue: { count: 1, amount: 21750 },
  dueSoon: { count: 0, amount: 0 },
  byRep: [
    { name: 'เคน', openCount: 1, sales: 21750, owing: 21750 },
    { name: 'โหน่ง', openCount: 2, sales: 22750, owing: 22750 },
  ],
  recent: [
    {
      id: 'WS-NT-0002',
      customer: 'ร้านดีคาร์แคร์',
      salesBy: 'เคน',
      total: 21750,
      status: 'ค้างชำระ',
    },
  ],
};

describe('WholesaleOverview', () => {
  it('shows sales, what is owed, and what is late', () => {
    render(<WholesaleOverview data={DATA} />);
    expect(screen.getByText('ขายส่งรับเงินแล้ว (ช่วงที่เลือก)')).toBeInTheDocument();
    expect(screen.getByText('PO ที่ยังไม่ปิด 3 ใบ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /เลยกำหนดชำระ/ })).toHaveAttribute(
      'href',
      '/wholesale?flag=overdue',
    );
  });

  it('opens each step of the process as a filtered list', () => {
    render(<WholesaleOverview data={DATA} />);
    expect(screen.getByRole('link', { name: 'รอจัดส่ง 1' })).toHaveAttribute(
      'href',
      `/wholesale?status=${encodeURIComponent('รอจัดส่ง')}`,
    );
  });

  it('summarises each rep and links to their POs', () => {
    render(<WholesaleOverview data={DATA} />);
    expect(screen.getByRole('link', { name: 'เคน' })).toHaveAttribute(
      'href',
      `/wholesale?sale=${encodeURIComponent('เคน')}`,
    );
  });

  it('lists the latest POs with their totals', () => {
    render(<WholesaleOverview data={DATA} />);
    expect(screen.getByLabelText('ยอด WS-NT-0002 21,750.00 บาท')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ร้านดีคาร์แคร์/ })).toHaveAttribute(
      'href',
      '/wholesale/WS-NT-0002',
    );
  });
});
