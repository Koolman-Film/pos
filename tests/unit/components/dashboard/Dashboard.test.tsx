import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The trend chart mounts Chart.js against a real canvas, which jsdom does not
// provide; and JobCalendar calls next/navigation's useRouter, which needs an app
// router context. Both are unrelated to what these tests assert, so stub them.
vi.mock('@/components/charts/LineChart', () => ({ LineChart: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

import { shopDayKey } from '@/lib/domain/format';
import {
  Dashboard,
  appointmentDate,
  groupUpcoming,
  type RecentJob,
} from '@/components/dashboard/Dashboard';

const emptyTrend = { labels: [], revenue: [], expense: [], profit: [] };

describe('Dashboard', () => {
  it('hides the revenue card when hasDashboardWidget("revenue") is false', () => {
    render(
      <Dashboard
        hasDashboardWidget={(k) => k !== 'revenue'}
        revenue={99999}
        totalExpenses={0}
        cashBalance={0}
        arItems={[]}
        apItems={[]}
        shopBreakdown={[]}
        expenseByCategory={[]}
        trend={emptyTrend}
      />,
    );
    expect(screen.queryByText('ยอดขายรวม (บาท)')).not.toBeInTheDocument();
  });

  it('shows the receivables card with items when the widget is enabled', () => {
    render(
      <Dashboard
        hasDashboardWidget={() => true}
        revenue={0}
        totalExpenses={0}
        cashBalance={0}
        arItems={[{ id: 'JT-1', name: 'คุณ เอ (1กก)', amount: 3100, source: 'ใบงานติดตั้ง' }]}
        apItems={[]}
        shopBreakdown={[]}
        expenseByCategory={[]}
        trend={emptyTrend}
      />,
    );
    expect(screen.getByText('คุณ เอ (1กก)')).toBeInTheDocument();
  });
});

// --- The four row-shaped widgets restored by correction C13 ---

const STATUSES = [
  { key: 'จองแล้ว', short: 'จองแล้ว', bg: '#EEE', text: '#555', dot: '#B5AAA1' },
  { key: 'กำลังติดตั้ง', short: 'กำลังติดตั้ง', bg: '#DFF', text: '#066', dot: '#2F8F82' },
];

const base = {
  hasDashboardWidget: () => true,
  revenue: 0,
  totalExpenses: 0,
  cashBalance: 0,
  arItems: [],
  apItems: [],
  shopBreakdown: [],
  expenseByCategory: [],
  trend: emptyTrend,
  statuses: STATUSES,
};

function job(over: Partial<RecentJob> = {}): RecentJob {
  return {
    id: 'JT-1',
    customer: 'คุณ เอ',
    brand: 'Toyota',
    model: 'Vios',
    plate: '1กก',
    serviceType: 'เข้าทำ/ติดตั้ง',
    categories: ['ฟิล์มกรองแสง'],
    products: ['Ceramic 40'],
    status: 'จองแล้ว',
    ...over,
  };
}

describe('Dashboard job-status totals', () => {
  it('renders one bar per status, using the short label and the live count', () => {
    render(
      <Dashboard
        {...base}
        totalJobs={4}
        statusTotals={[
          { key: 'จองแล้ว', count: 3, pct: 75 },
          { key: 'กำลังติดตั้ง', count: 1, pct: 25 },
        ]}
      />,
    );
    // Bare numbers like "4" appear in several cards, so scope to this one.
    const card = screen.getByText('งานทั้งหมด').closest('.card') as HTMLElement;
    expect(within(card).getByText('4')).toBeInTheDocument();
    expect(within(card).getByText('จองแล้ว')).toBeInTheDocument();
    expect(within(card).getByText('3')).toBeInTheDocument();
    expect(within(card).getByText('กำลังติดตั้ง')).toBeInTheDocument();
  });
});

describe('Dashboard upcoming bookings', () => {
  it('groups the window by day and then by appointment type', () => {
    const day = new Date('2026-07-27T09:00:00+07:00');
    render(
      <Dashboard
        {...base}
        upcoming={[
          { ...job({ id: 'JT-1' }), dropOff: day },
          { ...job({ id: 'JT-2', customer: 'คุณ บี', serviceType: 'ถอดฟิล์ม' }), dropOff: day },
        ]}
      />,
    );
    // Both appointment types appear as their own subheading under the one day.
    expect(screen.getByText('เข้าทำ/ติดตั้ง')).toBeInTheDocument();
    expect(screen.getByText('ถอดฟิล์ม')).toBeInTheDocument();
    expect(screen.getByText(/การนัดหมายวันนี้/)).toHaveTextContent('(2)');
  });

  it('marks a job that is under today because it goes BACK today', async () => {
    const day = new Date('2026-07-27T09:00:00+07:00');
    render(
      <Dashboard
        {...base}
        upcoming={[
          {
            ...job({ id: 'JT-9', customer: 'คุณ วิภา', status: 'รอส่งมอบ' }),
            dropOff: new Date('2026-07-20T09:00:00+07:00'),
            pickup: day,
          },
        ]}
      />,
    );
    // The badge carries the STATUS, so the card and the board say the same word.
    expect(screen.getByText('รอส่งมอบ')).toBeInTheDocument();
  });

  it('shows the time of the appointment and the product once one is chosen', () => {
    render(
      <Dashboard
        {...base}
        upcoming={[
          {
            ...job({ id: 'JT-7', products: ['ฟิล์ม 3M CRM 60%'] }),
            dropOff: new Date('2026-07-27T14:30:00+07:00'),
          },
        ]}
      />,
    );
    expect(screen.getByText('14:30')).toBeInTheDocument();
    expect(screen.getByText('ฟิล์ม 3M CRM 60%')).toBeInTheDocument();
  });

  it('prints no time and no product line when neither was recorded', () => {
    render(
      <Dashboard
        {...base}
        upcoming={[
          {
            ...job({ id: 'JT-8', products: [] }),
            // Midnight is what a ticket with no slot picked stores.
            dropOff: new Date('2026-07-27T00:00:00+07:00'),
          },
        ]}
      />,
    );
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing is booked in the window', () => {
    render(<Dashboard {...base} upcoming={[]} />);
    expect(screen.getByText('ยังไม่มีนัดหมายในช่วงนี้')).toBeInTheDocument();
  });
});

describe('Dashboard pending approvals', () => {
  it('shows both counters and links them to wholesale', () => {
    render(<Dashboard {...base} pendingApprovals={{ discount: 2, badDebt: 1 }} />);
    const discount = screen.getByText('ส่วนลด PO รออนุมัติ').closest('a');
    expect(discount).toHaveAttribute('href', '/wholesale');
    expect(discount).toHaveTextContent('2');
    expect(screen.getByText('ขอตัดหนี้สูญ').closest('a')).toHaveTextContent('1');
  });

  it('is hidden when the pendingApprovals widget permission is off', () => {
    render(
      <Dashboard
        {...base}
        hasDashboardWidget={(k) => k !== 'pendingApprovals'}
        pendingApprovals={{ discount: 2, badDebt: 1 }}
      />,
    );
    expect(screen.queryByText('รอการอนุมัติ')).not.toBeInTheDocument();
  });
});

describe('Dashboard recent jobs', () => {
  it('renders a row linking to the ticket, with its products and categories', () => {
    render(<Dashboard {...base} recentJobs={[job()]} />);
    expect(screen.getByText('คุณ เอ · Toyota Vios · 1กก')).toBeInTheDocument();
    expect(screen.getByText('Ceramic 40')).toBeInTheDocument();
    expect(screen.getByText(/ฟิล์มกรองแสง/)).toBeInTheDocument();
    expect(screen.getByLabelText('เปิดใบงาน JT-1')).toHaveAttribute('href', '/tickets/JT-1');
  });

  it('falls back to the prototype placeholder copy when a job has no details', () => {
    render(
      <Dashboard {...base} recentJobs={[job({ serviceType: '', categories: [], products: [] })]} />,
    );
    expect(screen.getByText(/ยังไม่ระบุการนัดหมาย · ยังไม่ระบุชนิดสินค้า/)).toBeInTheDocument();
    expect(screen.getByText('ยังไม่ระบุสินค้า')).toBeInTheDocument();
  });

  it('calls the status action with the ticket id and the newly picked status', async () => {
    const onUpdateTicketStatus = vi.fn().mockResolvedValue(undefined);
    render(
      <Dashboard {...base} recentJobs={[job()]} onUpdateTicketStatus={onUpdateTicketStatus} />,
    );

    await userEvent.selectOptions(screen.getByLabelText('สถานะของ JT-1'), 'กำลังติดตั้ง');

    expect(onUpdateTicketStatus).toHaveBeenCalledWith('JT-1', 'กำลังติดตั้ง');
  });

  it('disables the status select when no action is wired', () => {
    render(<Dashboard {...base} recentJobs={[job()]} />);
    expect(screen.getByLabelText('สถานะของ JT-1')).toBeDisabled();
  });

  it('shows the empty state when there are no jobs', () => {
    render(<Dashboard {...base} recentJobs={[]} />);
    expect(screen.getByText('ยังไม่มีใบงาน')).toBeInTheDocument();
  });
});

describe('Dashboard create-ticket button', () => {
  it('appears only with the list.createNew capability', () => {
    const { unmount } = render(<Dashboard {...base} canDo={() => false} />);
    expect(screen.queryByText('สร้างใบงานใหม่')).not.toBeInTheDocument();
    unmount();

    render(<Dashboard {...base} canDo={(k) => k === 'list.createNew'} />);
    expect(screen.getByText(/สร้างใบงานใหม่/)).toHaveAttribute('href', '/tickets/new');
  });
});

/**
 * วันที่นัด — which day a job is listed under (การนัดหมายวันนี้ – อีก 7 วันข้างหน้า).
 *
 * The shop photographs this card and sends it out, so the grouping IS the
 * deliverable: วันที่นัด → การนัดหมาย → ชนิดสินค้า, one line per car.
 */
describe('appointmentDate', () => {
  const drop = new Date('2026-07-20T09:00:00+07:00');
  const pick = new Date(2026, 6, 27, 17, 0, 0);

  it('lists a job under the day the car comes in', () => {
    expect(appointmentDate({ status: 'จองแล้ว', dropOff: drop, pickup: pick })).toBe(drop);
  });

  it('lists a รอส่งมอบ job under the day it goes back', () => {
    // It came in last week; under the drop-off date it would sit in the past,
    // out of the window entirely, on no day anyone is looking at.
    expect(appointmentDate({ status: 'รอส่งมอบ', dropOff: drop, pickup: pick })).toBe(pick);
  });

  it('falls back to the drop-off when a รอส่งมอบ job has no pickup date', () => {
    expect(appointmentDate({ status: 'รอส่งมอบ', dropOff: drop, pickup: null })).toBe(drop);
  });
});

describe('groupUpcoming', () => {
  const day = new Date('2026-07-27T09:00:00+07:00');
  const later = new Date('2026-08-03T17:00:00+07:00');
  const row = (over: Partial<ReturnType<typeof baseUpcoming>> = {}) => ({
    ...baseUpcoming(),
    ...over,
  });
  function baseUpcoming() {
    return {
      id: 'JT-1',
      customer: 'คุณ เอ',
      brand: 'Toyota',
      model: 'Vios',
      plate: '1กก',
      serviceType: 'เข้าทำ/ติดตั้ง',
      categories: ['ฟิล์มกรองแสง'],
      products: ['ฟิล์ม 3M CRM 60%'],
      dropOff: day,
      status: 'จองแล้ว',
      pickup: null as Date | null,
    };
  }

  it('nests ชนิดสินค้า under การนัดหมาย under วันที่', () => {
    const days = groupUpcoming([
      row(),
      row({ id: 'JT-2', categories: ['ฟิล์มกันรอย'] }),
      row({ id: 'JT-3', serviceType: 'ถอดฟิล์ม' }),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].byService.map((g) => g.serviceType)).toEqual(['เข้าทำ/ติดตั้ง', 'ถอดฟิล์ม']);
    expect(days[0].byService[0].byCategory.map((c) => c.category)).toEqual([
      'ฟิล์มกรองแสง',
      'ฟิล์มกันรอย',
    ]);
  });

  it('keeps a job with two ชนิดสินค้า as one line, not two cars', () => {
    const days = groupUpcoming([row({ categories: ['ฟิล์มกันรอย', 'เครื่องเสียง'] })]);
    const cats = days[0].byService[0].byCategory;
    expect(cats).toHaveLength(1);
    expect(cats[0].category).toBe('ฟิล์มกันรอย, เครื่องเสียง');
    expect(cats[0].tickets).toHaveLength(1);
  });

  it('files a รอส่งมอบ job under its handover day, not its drop-off day', () => {
    const days = groupUpcoming([row(), row({ id: 'JT-2', status: 'รอส่งมอบ', pickup: later })]);
    expect(days.map((d) => d.key)).toEqual([shopDayKey(day), shopDayKey(later)]);
  });

  it('names the empty cases rather than dropping the row', () => {
    const days = groupUpcoming([row({ serviceType: '', categories: [] })]);
    expect(days[0].byService[0].serviceType).toBe('ยังไม่ระบุการนัดหมาย');
    expect(days[0].byService[0].byCategory[0].category).toBe('ยังไม่ระบุชนิดสินค้า');
  });
});

/**
 * งานแก้ และ เซอร์วิส บนการ์ดนัดหมาย.
 *
 * A car coming back is an appointment on its own day, under its own heading —
 * not a line hidden inside the booking it came from. The card groups by
 * การนัดหมาย, so all it takes is giving those rows their own one.
 */
describe('Dashboard — งานแก้/เซอร์วิส เป็นหัวข้อนัดหมายของตัวเอง', () => {
  const day = new Date('2026-07-27T09:00:00+07:00');

  it('heads them separately from เข้าทำ/ติดตั้ง', () => {
    render(
      <Dashboard
        {...base}
        upcoming={[
          { ...job({ id: 'JT-1' }), dropOff: day },
          {
            ...job({ id: 'JT-1', serviceType: 'แก้งาน', products: ['ฟิล์มมีฝุ่น'] }),
            dropOff: day,
          },
          { ...job({ id: 'JT-2', serviceType: 'Service' }), dropOff: day },
        ]}
      />,
    );
    expect(screen.getByText('เข้าทำ/ติดตั้ง')).toBeInTheDocument();
    expect(screen.getByText('แก้งาน')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText(/การนัดหมายวันนี้/)).toHaveTextContent('(3)');
  });

  it('lists the same ticket twice when it is two appointments', () => {
    // The booking and the rework are different days' work on the same car; a
    // duplicate id must not collapse them into one row.
    const days = groupUpcoming([
      { ...job({ id: 'JT-1' }), dropOff: day, pickup: null },
      { ...job({ id: 'JT-1', serviceType: 'แก้งาน' }), dropOff: day, pickup: null },
    ]);
    expect(days[0].byService.map((g) => g.serviceType)).toEqual(['เข้าทำ/ติดตั้ง', 'แก้งาน']);
  });
});
