import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The trend chart mounts Chart.js against a real canvas, which jsdom does not
// provide; and JobCalendar calls next/navigation's useRouter, which needs an app
// router context. Both are unrelated to what these tests assert, so stub them.
vi.mock('@/components/charts/LineChart', () => ({ LineChart: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

import { Dashboard } from '@/components/dashboard/Dashboard';

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
      />
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
      />
    );
    expect(screen.getByText('คุณ เอ (1กก)')).toBeInTheDocument();
  });
});
