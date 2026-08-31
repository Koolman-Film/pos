import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { JobCalendar, type CalendarTicket } from '@/components/dashboard/JobCalendar';

/**
 * ปฏิทินงาน — งานแก้ และ เซอร์วิส.
 *
 * The calendar answers "what is happening that day". A car coming back is one of
 * those things, but it is not a STATUS — the ticket keeps whatever status it has
 * — so the day cell used to read its keys off the shop's status list and drop
 * the visits on the floor.
 */
describe('JobCalendar — งานแก้/เซอร์วิส', () => {
  const day = new Date();
  const entry = (over: Partial<CalendarTicket>): CalendarTicket => ({
    id: 'JT-CM-1',
    shop: 'cm',
    status: 'จองแล้ว',
    dropOff: day,
    statusHistory: [],
    ...over,
  });

  it('shows a visit that is not one of the shop’s statuses', () => {
    render(
      <JobCalendar
        tickets={[entry({ status: 'แก้งาน' }), entry({ id: 'JT-CM-2', status: 'Service' })]}
        shopFilter="all"
        statuses={[{ key: 'จองแล้ว', short: 'จองแล้ว', dot: '#B5AAA1' }]}
      />,
    );
    expect(screen.getByText('แก้งาน')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
  });

  it('still shows the ordinary statuses beside them', () => {
    render(
      <JobCalendar
        tickets={[entry({}), entry({ id: 'JT-CM-2', status: 'แก้งาน' })]}
        shopFilter="all"
        statuses={[{ key: 'จองแล้ว', short: 'จองแล้ว', dot: '#B5AAA1' }]}
      />,
    );
    expect(screen.getByText('จองแล้ว')).toBeInTheDocument();
    expect(screen.getByText('แก้งาน')).toBeInTheDocument();
  });
});
