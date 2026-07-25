import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TicketList } from '@/components/tickets/TicketList';

const tickets = [
  {
    id: 'JT-CM-00214',
    shop: 'cm',
    customer: 'คุณ เอ',
    plate: '250 กก',
    status: 'กำลัง QC ก่อนติดตั้ง',
    items: [{ soldPrice: 5100 }],
    payments: [],
  },
];
const statuses = [
  { key: 'กำลัง QC ก่อนติดตั้ง', short: 'รอ QC', bg: '#FBF1DA', text: '#8A5A12', dot: '#E8B23D' },
];

describe('TicketList', () => {
  it('renders a ticket row with its status badge', () => {
    render(
      <TicketList tickets={tickets} statuses={statuses} canDo={() => true} accessibleShops={[{ id: 'cm', name: 'CM' }]} />
    );
    // customer and plate share a text node in the faithful markup ("คุณ เอ · 250 กก");
    // the customer also appears again inside the body-portaled print table.
    expect(screen.getAllByText(/คุณ เอ/).length).toBeGreaterThan(0);
    expect(screen.getByText('รอ QC')).toBeInTheDocument();
  });

  it('hides the "create new" button when canDo("list.createNew") is false', () => {
    render(
      <TicketList tickets={tickets} statuses={statuses} canDo={() => false} accessibleShops={[{ id: 'cm', name: 'CM' }]} />
    );
    expect(screen.queryByText('สร้างใบงานใหม่')).not.toBeInTheDocument();
    expect(screen.queryByText('สร้างใหม่')).not.toBeInTheDocument();
  });

  it('shows the "create new" controls when canDo("list.createNew") is true', () => {
    render(
      <TicketList tickets={tickets} statuses={statuses} canDo={() => true} accessibleShops={[{ id: 'cm', name: 'CM' }]} />
    );
    expect(screen.getByText('สร้างใบงานใหม่')).toBeInTheDocument();
  });
});
