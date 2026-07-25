// Ported from reference/v0.4/finnix-film.html:642-957 (the bento dashboard).
//
// This is a Server Component: it receives already-aggregated, serialisable data
// and renders the permission-gated widgets, delegating only the interactive
// leaves — the trend `LineChart`, the `JobCalendar`, and the `filter` bar — to
// Client Components. `hasDashboardWidget` is the port's replacement for the
// prototype's `dashboardPermissions[role]` lookup (same keys, same gating), and
// it is safe to receive as a function here because Dashboard is itself a Server
// Component (no server→client function-prop boundary is crossed).
//
// Widgets whose prototype data is a full per-ticket client array (job-status
// totals, upcoming bookings, pending approvals, recent-jobs list) are not part of
// this server-aggregated contract and are intentionally omitted — the port pushes
// numbers, not row arrays, to the client. The remaining widgets are faithful.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { LineChart } from '@/components/charts/LineChart';
import { fmt } from '@/lib/domain/format';

import { JobCalendar, type CalendarTicket } from './JobCalendar';
import type { APItem, ARItem, TrendSeries } from './receivables';

export type ShopBreakdown = { name: string; count: number };
export type ExpenseByCategory = { name: string; amount: number };
export type StockByCategory = { name: string; qty: number };

export type DashboardProps = {
  hasDashboardWidget: (key: string) => boolean;
  revenue: number;
  totalExpenses: number;
  cashBalance: number;
  cashTopups?: number;
  cashSpent?: number;
  outstanding?: number;
  arItems: ARItem[];
  apItems: APItem[];
  shopBreakdown: ShopBreakdown[];
  expenseByCategory: ExpenseByCategory[];
  stockByCategory?: StockByCategory[];
  stockTotal?: number;
  trend: TrendSeries;
  calendarTickets?: CalendarTicket[];
  shopFilter?: string;
  filter?: ReactNode;
};

export function Dashboard({
  hasDashboardWidget,
  revenue,
  totalExpenses,
  cashBalance,
  cashTopups = 0,
  cashSpent = 0,
  outstanding = 0,
  arItems,
  apItems,
  shopBreakdown,
  expenseByCategory,
  stockByCategory = [],
  stockTotal = 0,
  trend,
  calendarTickets = [],
  shopFilter = 'all',
  filter,
}: DashboardProps) {
  const maxShopCount = Math.max(...shopBreakdown.map((s) => s.count), 1);
  const maxExpenseCat = Math.max(...expenseByCategory.map((c) => c.amount), 1);
  const maxStockCat = Math.max(...stockByCategory.map((c) => c.qty), 1);
  const totalAR = arItems.reduce((s, i) => s + i.amount, 0);
  const totalAP = apItems.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">ภาพรวมธุรกิจ</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
            สรุปข้อมูลวันนี้ &middot;{' '}
            {new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {filter}

      {/* Row 1: permission-gated stat cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {hasDashboardWidget('revenue') && (
          <div className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="icon-tile" style={{ background: 'var(--revenue-soft)' }}>
                <i className="fa-solid fa-sack-dollar" style={{ color: 'var(--revenue)' }}></i>
              </div>
            </div>
            <p className="text-2xl font-extrabold" style={{ color: 'var(--revenue)' }}>
              {fmt(revenue)}
            </p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
              ยอดขายรวม (บาท)
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {shopBreakdown.map((s) => (
                <div key={s.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--ink-soft)' }}>{s.name}</span>
                    <span className="font-medium">{s.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'var(--paper)' }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${(s.count / maxShopCount) * 100}%`, background: 'var(--revenue)' }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
            <Link
              href="/tickets"
              className="btn-outline w-full mt-4 rounded-xl py-2 text-sm font-medium block text-center"
            >
              ดูใบงานทั้งหมด
            </Link>
          </div>
        )}

        {hasDashboardWidget('expense') && (
          <div className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="icon-tile" style={{ background: '#FBEAEC' }}>
                <i className="fa-solid fa-receipt" style={{ color: '#B23A48' }}></i>
              </div>
            </div>
            <p className="text-2xl font-extrabold">{fmt(totalExpenses)}</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
              ยอดรวมค่าใช้จ่าย (บาท)
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {expenseByCategory.length === 0 && (
                <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                  ยังไม่มีรายการค่าใช้จ่าย
                </p>
              )}
              {expenseByCategory.map((c) => (
                <div key={c.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--ink-soft)' }}>{c.name}</span>
                    <span className="font-medium">{fmt(c.amount)}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'var(--paper)' }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${(c.amount / maxExpenseCat) * 100}%`, background: '#C24B57' }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
            <Link
              href="/accounting"
              className="btn-outline w-full mt-4 rounded-xl py-2 text-sm font-medium block text-center"
            >
              ดูรายละเอียดค่าใช้จ่าย
            </Link>
          </div>
        )}

        {hasDashboardWidget('pettycash') && (
          <div className="card p-5" style={{ background: 'var(--primary-soft)', borderColor: 'transparent' }}>
            <div className="flex items-start justify-between mb-3">
              <div className="icon-tile" style={{ background: 'rgba(255,255,255,.6)' }}>
                <i className="fa-solid fa-wallet" style={{ color: 'var(--primary)' }}></i>
              </div>
            </div>
            <p className="text-2xl font-extrabold" style={{ color: 'var(--primary)' }}>
              {fmt(cashBalance)}
            </p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--primary)', opacity: 0.8 }}>
              เงินสดย่อยคงเหลือ
            </p>
            <p className="text-xs mt-4" style={{ color: 'var(--primary)', opacity: 0.7 }}>
              เติมแล้ว {fmt(cashTopups)}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--primary)', opacity: 0.7 }}>
              จ่ายไป {fmt(cashSpent)}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--primary)', opacity: 0.7 }}>
              ค้างชำระจากลูกค้า {fmt(outstanding)}
            </p>
          </div>
        )}
      </div>

      {/* Row 2: revenue/expense/profit trend */}
      {hasDashboardWidget('trendChart') && (
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">รายได้ &middot; ค่าใช้จ่าย &middot; กำไร</p>
            <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              <i className="fa-solid fa-arrow-pointer mr-1"></i>ชี้หรือคลิกที่กราฟเพื่อดูตัวเลข
            </span>
          </div>
          <LineChart
            labels={trend.labels}
            revenue={trend.revenue}
            expense={trend.expense}
            profit={trend.profit}
          />
        </div>
      )}

      {/* Row 2.5: receivables / payables */}
      {hasDashboardWidget('receivablesPayables') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="icon-tile" style={{ background: '#E6EFDC' }}>
                    <i className="fa-solid fa-hand-holding-dollar" style={{ color: '#4C7A3E' }}></i>
                  </div>
                  <p className="text-sm font-semibold">ลูกหนี้ &middot; ยอดค้างรับ</p>
                </div>
                <p className="text-2xl font-extrabold" style={{ color: '#4C7A3E' }}>
                  {fmt(totalAR)}
                </p>
              </div>
              <span
                className="text-xs px-2 py-1 rounded-full font-medium"
                style={{ background: '#E6EFDC', color: '#4C7A3E' }}
              >
                {arItems.length} รายการ
              </span>
            </div>
            <div className="flex flex-col gap-2 mt-3 max-h-56 overflow-y-auto scrollbar-thin">
              {arItems.length === 0 && (
                <p className="text-xs py-4 text-center" style={{ color: 'var(--ink-faint)' }}>
                  ไม่มียอดค้างรับ
                </p>
              )}
              {arItems.slice(0, 8).map((i) => (
                <Link
                  key={i.source + i.id}
                  href={i.source === 'ใบงานติดตั้ง' ? `/tickets/${i.id}` : '/wholesale'}
                  className="flex items-center justify-between gap-2 py-2 cursor-pointer"
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{i.name}</p>
                    <p className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                      {i.source}
                    </p>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#4C7A3E' }}>
                    {fmt(i.amount)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="icon-tile" style={{ background: '#FBEAEC' }}>
                    <i className="fa-solid fa-file-invoice" style={{ color: '#B23A48' }}></i>
                  </div>
                  <p className="text-sm font-semibold">เจ้าหนี้ &middot; ยอดค้างจ่าย</p>
                </div>
                <p className="text-2xl font-extrabold" style={{ color: '#B23A48' }}>
                  {fmt(totalAP)}
                </p>
              </div>
              <span
                className="text-xs px-2 py-1 rounded-full font-medium"
                style={{ background: '#FBEAEC', color: '#B23A48' }}
              >
                {apItems.length} รายการ
              </span>
            </div>
            <div className="flex flex-col gap-2 mt-3 max-h-56 overflow-y-auto scrollbar-thin">
              {apItems.length === 0 && (
                <p className="text-xs py-4 text-center" style={{ color: 'var(--ink-faint)' }}>
                  ไม่มียอดค้างจ่าย
                </p>
              )}
              {apItems.slice(0, 8).map((i) => (
                <Link
                  key={i.id}
                  href="/accounting"
                  className="flex items-center justify-between gap-2 py-2 cursor-pointer"
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{i.name}</p>
                    <p className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                      {i.source}
                      {i.due ? ` · กำหนด ${i.due}` : ''}
                    </p>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#B23A48' }}>
                    {fmt(i.amount)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Job overview: stock + calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {hasDashboardWidget('stockSummary') && (
          <div className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="icon-tile" style={{ background: '#E4ECFC' }}>
                <i className="fa-solid fa-boxes-stacked" style={{ color: '#2563EB' }}></i>
              </div>
            </div>
            <p className="text-2xl font-extrabold">{stockTotal}</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--ink-soft)' }}>
              สินค้าคงเหลือ (ชิ้น)
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {stockByCategory.length === 0 && (
                <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                  ยังไม่มีข้อมูลสต็อก
                </p>
              )}
              {stockByCategory.map((c) => (
                <div key={c.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--ink-soft)' }}>{c.name}</span>
                    <span className="font-medium">{c.qty}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'var(--paper)' }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${(c.qty / maxStockCat) * 100}%`, background: '#2563EB' }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
            <Link
              href="/stock"
              className="btn-outline w-full mt-4 rounded-xl py-2 text-sm font-medium block text-center"
            >
              ดูสต็อกทั้งหมด
            </Link>
          </div>
        )}

        {hasDashboardWidget('jobCalendar') && (
          <JobCalendar tickets={calendarTickets} shopFilter={shopFilter} />
        )}
      </div>
    </div>
  );
}
