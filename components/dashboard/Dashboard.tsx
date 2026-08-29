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
// The four row-shaped widgets — job-status totals, this-week bookings, pending
// approvals and the recent-jobs list — were initially left out because the port's
// instinct is to push numbers rather than row arrays to the client (correction
// C13). They are back, because the prototype's dashboard is not a numbers
// dashboard: those four are half of what the screen is *for*. The rows are still
// assembled and trimmed server-side (top 5 recent, 7-day booking window), so what
// crosses the wire is a small bounded projection, not the full ticket set. The
// only interactive leaf is the status dropdown (TicketStatusSelect).

import Link from 'next/link';
import type { ReactNode } from 'react';

import { LineChart } from '@/components/charts/LineChart';
import { getStatus, type StatusConfig } from '@/components/ui/Badge';
import { shopDayKey, hhmm, fmt, fmtThaiDate } from '@/lib/domain/format';

import { JobCalendar, type CalendarTicket } from './JobCalendar';
import { TicketStatusSelect } from './TicketStatusSelect';
import type { APItem, ARItem, TrendSeries } from './receivables';

export type ShopBreakdown = { name: string; count: number };
export type ExpenseByCategory = { name: string; amount: number };
export type StockByCategory = { name: string; qty: number };

/** One bar in the "งานทั้งหมด" breakdown (prototype `statusList`). */
export type StatusTotal = { key: string; count: number; pct: number };

/**
 * ประกันที่ใกล้หมดอายุใน 30 วัน.
 *
 * "As of now" like the bookings window, not a period total: a policy running
 * out next week is a call to make today, whatever month the dashboard shows.
 */
export type ExpiringInsurance = {
  ticketId: string;
  plate: string;
  planName: string;
  endsAt: string;
  daysLeft: number;
};

/** A booking inside the next-7-days window (prototype `upcoming`). */
export type UpcomingTicket = {
  id: string;
  customer: string;
  brand: string;
  model: string;
  plate: string;
  serviceType: string;
  categories: string[];
  /** สินค้าที่เลือกไว้แล้ว — empty until the counter picks one. */
  products: string[];
  dropOff: Date;
  status: string;
  /** วันส่งมอบ — what a รอส่งมอบ job is listed under. */
  pickup?: Date | null;
};

/** The one status whose appointment is the HANDOVER, not the drop-off. */
export const HANDOVER_STATUS = 'รอส่งมอบ';

/**
 * วันที่นัด — which date this job belongs under.
 *
 * A job waiting to be handed back was dropped off days ago; listing it under
 * that old date puts it out of sight of the day it actually needs someone,
 * so รอส่งมอบ is listed under วันส่งมอบ instead. Everything else is listed
 * under the day the car comes in.
 */
export function appointmentDate<
  T extends { status: string; dropOff: Date | null; pickup?: Date | null },
>(t: T): Date | null {
  return t.status === HANDOVER_STATUS ? (t.pickup ?? t.dropOff) : t.dropOff;
}

/**
 * เวลานัด — the clock part of the same date the job is listed under.
 *
 * '' when the stored time is midnight: the ticket form always picks a slot, so
 * midnight means nobody recorded one, and printing "00:00" on a card the shop
 * sends to a customer would be inventing an appointment at midnight.
 */
export function appointmentTime<
  T extends { status: string; dropOff: Date | null; pickup?: Date | null },
>(t: T): string {
  const at = hhmm(appointmentDate(t));
  return at === '00:00' ? '' : at;
}

/** A row of the "งานล่าสุด" list (prototype `visible.slice(0,5)`). */
export type RecentJob = {
  id: string;
  customer: string;
  brand: string;
  model: string;
  plate: string;
  serviceType: string;
  categories: string[];
  products: string[];
  status: string;
};

/** The two counters on the "รอการอนุมัติ" card. */
export type PendingApprovals = { discount: number; badDebt: number };

export type DashboardProps = {
  hasDashboardWidget: (key: string) => boolean;
  revenue: number;
  totalExpenses: number;
  cashBalance: number;
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
  /**
   * Sub-heading under the title, describing the window the numbers cover
   * (`periodCaption`). Defaults to today's date for callers that render the
   * dashboard without a period filter.
   */
  caption?: string;
  /** Live `statuses` config (labels, pill colours, dots). Falls back to none. */
  statuses?: StatusConfig[];
  /** Total jobs in scope — the big number above the status bars. */
  totalJobs?: number;
  statusTotals?: StatusTotal[];
  upcoming?: UpcomingTicket[];
  expiringInsurance?: ExpiringInsurance[];
  pendingApprovals?: PendingApprovals;
  recentJobs?: RecentJob[];
  /** Capability check, for the `list.createNew` button. Denies by default. */
  canDo?: (capabilityKey: string) => boolean;
  /** `updateTicketStatus` Server Action; omitted renders the select read-only. */
  onUpdateTicketStatus?: (ticketId: string, newStatus: string) => Promise<void>;
};

export function Dashboard({
  hasDashboardWidget,
  revenue,
  totalExpenses,
  cashBalance,
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
  caption = `สรุปข้อมูลวันนี้ · ${new Date().toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}`,
  statuses = [],
  totalJobs = 0,
  statusTotals = [],
  upcoming = [],
  expiringInsurance = [],
  pendingApprovals,
  recentJobs = [],
  canDo = () => false,
  onUpdateTicketStatus,
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
            {caption}
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
                      style={{
                        width: `${(s.count / maxShopCount) * 100}%`,
                        background: 'var(--revenue)',
                      }}
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
                      style={{
                        width: `${(c.amount / maxExpenseCat) * 100}%`,
                        background: '#C24B57',
                      }}
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

        {/*
          The balance is the whole card. The prototype also stacked three
          sub-lines under it — เติมแล้ว, จ่ายไป and ค้างชำระจากลูกค้า — which the
          trial run asked to drop: the first two are the Accounting module's job
          (it shows the same two legs under its own petty-cash card, where they
          can be acted on), and the third repeats what the ลูกหนี้ · ยอดค้างรับ
          card below already lists per customer.
        */}
        {hasDashboardWidget('pettycash') && (
          <div
            className="card p-5"
            style={{ background: 'var(--primary-soft)', borderColor: 'transparent' }}
          >
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
                  <span
                    className="text-xs font-semibold flex-shrink-0"
                    style={{ color: '#4C7A3E' }}
                  >
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
                  <span
                    className="text-xs font-semibold flex-shrink-0"
                    style={{ color: '#B23A48' }}
                  >
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

      {/* Row 3: job status totals + this-week bookings + pending approvals
          (prototype :844-917). The first two are ungated there, so they are
          ungated here; only รอการอนุมัติ sits behind a widget permission. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4">
        <div className="card p-5 lg:col-span-6">
          <div className="flex items-start justify-between mb-3">
            <div className="icon-tile" style={{ background: '#E6EFDC' }}>
              <i className="fa-solid fa-clipboard-check" style={{ color: '#4C7A3E' }}></i>
            </div>
          </div>
          <p className="text-2xl font-extrabold">{totalJobs}</p>
          <p className="text-sm mt-0.5 mb-3" style={{ color: 'var(--ink-soft)' }}>
            งานทั้งหมด
          </p>
          <div className="flex flex-col gap-2.5">
            {statusTotals.map((s) => {
              const conf = getStatus(statuses, s.key);
              return (
                <div key={s.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--ink-soft)' }}>{conf.short}</span>
                    <span className="font-medium">{s.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'var(--paper)' }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${s.pct}%`, background: conf.dot }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/*
          ประกันใกล้หมดอายุ. Sits beside the bookings because it is the same kind
          of list: a short queue of customers somebody should ring this week.
        */}
        {/* Gated like every other card. It was added after the permission list
            was written and went ungoverned — an admin could not hide it from a
            role that has no business seeing customer policies. */}
        {hasDashboardWidget('insuranceExpiry') && expiringInsurance.length > 0 && (
          <div className="card p-5 lg:col-span-6">
            <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <i className="fa-solid fa-shield-halved" style={{ color: '#B26A00' }}></i>
              ประกันใกล้หมดอายุ (ภายใน 30 วัน) ({expiringInsurance.length})
            </p>
            <div className="flex flex-col max-h-[26rem] overflow-y-auto scrollbar-thin">
              {expiringInsurance.map((p) => (
                <Link
                  key={`${p.ticketId}-${p.endsAt}-${p.plate}`}
                  href={`/tickets/${p.ticketId}`}
                  className="row-hover rounded-xl px-2.5 py-2 flex items-center justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="text-xs font-semibold block">{p.plate || p.ticketId}</span>
                    <span className="text-xs block" style={{ color: 'var(--ink-soft)' }}>
                      {p.planName || 'ประกัน'} · หมด {fmtThaiDate(new Date(`${p.endsAt}T00:00:00`))}
                    </span>
                  </span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                    style={{ background: '#FBF0DF', color: '#B26A00' }}
                  >
                    {p.daysLeft === 0 ? 'หมดวันนี้' : `อีก ${p.daysLeft} วัน`}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
        {hasDashboardWidget('pendingApprovals') && pendingApprovals && (
          <div className="card p-5 lg:col-span-6">
            <p className="text-sm font-semibold mb-3">รอการอนุมัติ</p>
            <div className="h-1.5 rounded-full flex overflow-hidden mb-4">
              <div className="h-full" style={{ width: '50%', background: '#E8B23D' }}></div>
              <div className="h-full" style={{ width: '50%', background: '#C24B57' }}></div>
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <Link
                href="/wholesale"
                className="flex items-center justify-between hover:opacity-80"
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: '#E8B23D' }}></span>
                  ส่วนลด PO รออนุมัติ
                </span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: '#FBF1DA', color: '#8A5A12' }}
                >
                  {pendingApprovals.discount}
                </span>
              </Link>
              <Link
                href="/wholesale"
                className="flex items-center justify-between hover:opacity-80"
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: '#C24B57' }}></span>
                  ขอตัดหนี้สูญ
                </span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: '#FBEAEC', color: '#B23A48' }}
                >
                  {pendingApprovals.badDebt}
                </span>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Row 3b: the week ahead, on a row of its own.

          It shared a row with two other cards and was a third of the width, so
          it needed an inner scrollbar and still cut lines off — and this is the
          card the shop photographs and sends out, where a hidden line is a line
          the person receiving the photo never sees. Full width, no scroller, and
          the days lay out across the row instead of down it. */}
      <div className="card p-5 mb-4">
        <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <i className="fa-solid fa-calendar-week" style={{ color: 'var(--primary)' }}></i>
          การนัดหมายวันนี้ &ndash; อีก 7 วันข้างหน้า ({upcoming.length})
        </p>
        {upcoming.length === 0 && (
          <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-faint)' }}>
            ยังไม่มีนัดหมายในช่วงนี้
          </p>
        )}
        {/*
          Nothing here truncates or scrolls. The shop photographs this card and
          sends it out, so a line hidden under the fold of an inner scrollbar is
          a line the person receiving the photo never sees. Each field gets its
          own line and wraps, ชนิดสินค้า is a heading rather than a fourth line
          on every row, and the card grows to fit the whole week.
        */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1">
          {groupUpcoming(upcoming).map((day) => (
            <div key={day.key} className="mb-2 break-inside-avoid">
              {/* Three headings, three weights: the day carries the rule, the
                  การนัดหมาย is a filled chip, and the ชนิดสินค้า underneath is
                  quiet. Reading the photo, the eye has to land on WHAT KIND of
                  appointment these cars are here for before anything else. */}
              <p
                className="text-sm font-bold mt-2 mb-1.5 pb-1"
                style={{ color: 'var(--primary)', borderBottom: '1px solid var(--line)' }}
              >
                {fmtThaiDate(day.date)}
              </p>
              {day.byService.map((group) => (
                <div key={group.serviceType} className="mb-2">
                  <span
                    className="text-xs font-bold px-2 py-1 rounded-lg inline-block mb-1.5"
                    style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                  >
                    {group.serviceType}
                  </span>
                  {group.byCategory.map((cat) => (
                    <div key={cat.category} className="mb-1 ml-1">
                      <p
                        className="text-xs font-medium mb-0.5"
                        style={{ color: 'var(--ink-faint)' }}
                      >
                        {cat.category}
                      </p>
                      {cat.tickets.map((t, i) => (
                        <Link
                          // One ticket can appear more than once — its booking,
                          // its งานแก้ and each เซอร์วิส visit are separate
                          // appointments — so the id alone is not a key.
                          key={`${t.id}-${t.serviceType}-${i}`}
                          href={`/tickets/${t.id}`}
                          className="flex items-start justify-between gap-2 cursor-pointer py-1.5 pl-2"
                          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
                        >
                          {/*
                            One line per car: ลูกค้า · รถ · ทะเบียน. Three weights
                            rather than three lines — the name leads, the model is
                            quiet, the plate is legible again because it is the
                            field the person reading the photo matches on. It wraps
                            rather than clipping when the name is long.
                          */}
                          <div className="min-w-0">
                            <p className="text-sm break-words">
                              {/* The time leads the line so the day reads as a
                                schedule; a fixed width keeps the names lined up
                                under each other even when a slot is missing. */}
                              <span
                                className="text-xs font-bold tabular-nums inline-block align-middle mr-1"
                                style={{ color: 'var(--primary)', minWidth: '2.7rem' }}
                              >
                                {appointmentTime(t)}
                              </span>
                              <span className="font-semibold">{t.customer}</span>
                              {[t.brand, t.model].filter(Boolean).join(' ') && (
                                <span style={{ color: 'var(--ink-soft)' }}>
                                  {' · '}
                                  {[t.brand, t.model].filter(Boolean).join(' ')}
                                </span>
                              )}
                              {t.plate && (
                                <span className="font-medium" style={{ color: 'var(--ink)' }}>
                                  {' · '}
                                  {t.plate}
                                </span>
                              )}
                              {/* Says WHY this job is under today: the car has been
                                here since last week and goes back now. The badge
                                is the STATUS itself, not a word of its own — the
                                board and this card have to say the same thing. */}
                              {t.status === HANDOVER_STATUS && (
                                <span
                                  className="text-xs font-semibold px-1.5 py-0.5 rounded-full ml-1.5 align-middle"
                                  style={{ background: '#E8F1E4', color: '#4C7A3E' }}
                                >
                                  {t.status}
                                </span>
                              )}
                            </p>
                            {/* สินค้าที่เลือกแล้ว, indented to sit under the name
                                rather than the time. Nothing prints while the
                                counter has not picked one — an empty line under
                                every booking reads as missing information. */}
                            {t.products.length > 0 && (
                              <p
                                className="text-xs break-words"
                                style={{ color: 'var(--ink-soft)', marginLeft: '3rem' }}
                              >
                                {t.products.join(', ')}
                              </p>
                            )}
                          </div>
                          <span
                            className="row-action text-xs flex-shrink-0 mt-1"
                            style={{ color: 'var(--primary)' }}
                          >
                            <i className="fa-solid fa-chevron-right"></i>
                          </span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Row 4: the wide "งานล่าสุด" list (prototype :919-943). */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-sm font-semibold">งานล่าสุด</p>
          <Link href="/tickets" className="btn-primary text-xs px-3 py-1.5 rounded-lg font-medium">
            ดูทั้งหมด
          </Link>
        </div>
        <div className="flex flex-col">
          {recentJobs.length === 0 && (
            <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-faint)' }}>
              ยังไม่มีใบงาน
            </p>
          )}
          {recentJobs.map((t, i) => (
            <div
              key={t.id}
              className="group flex items-center justify-between gap-3 py-3"
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
            >
              {/* The row is a link and the status select is not — nesting a
                  <select> inside an <a> would be invalid HTML and would swallow
                  its clicks, so they sit side by side instead of the prototype's
                  onClick-on-the-row. */}
              <Link href={`/tickets/${t.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                <div className="icon-tile" style={{ background: 'var(--paper)' }}>
                  <i className="fa-solid fa-car text-sm" style={{ color: 'var(--primary)' }}></i>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {t.customer} &middot; {t.brand} {t.model} &middot; {t.plate}
                  </p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-faint)' }}>
                    {t.serviceType || 'ยังไม่ระบุการนัดหมาย'} &middot;{' '}
                    {t.categories.join(', ') || 'ยังไม่ระบุชนิดสินค้า'}
                  </p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-soft)' }}>
                    {t.products.join(', ') || 'ยังไม่ระบุสินค้า'}
                  </p>
                </div>
              </Link>
              <div className="flex items-center gap-3 flex-shrink-0">
                <TicketStatusSelect
                  ticketId={t.id}
                  status={t.status}
                  statuses={statuses}
                  onChange={onUpdateTicketStatus}
                />
                <Link
                  href={`/tickets/${t.id}`}
                  aria-label={`เปิดใบงาน ${t.id}`}
                  className="row-action text-xs"
                  style={{ color: 'var(--primary)' }}
                >
                  <i className="fa-solid fa-arrow-right"></i>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {canDo('list.createNew') && (
        <Link
          href="/tickets/new"
          className="btn-primary mt-6 w-full rounded-2xl py-3.5 text-sm font-semibold flex items-center justify-center gap-2"
        >
          <i className="fa-solid fa-plus"></i> สร้างใบงานใหม่
        </Link>
      )}
    </div>
  );
}

/**
 * Group the 7-day booking window: วันที่นัด → การนัดหมาย → ชนิดสินค้า.
 *
 * Three levels, not two, because this card is photographed and sent out. A
 * heading per ชนิดสินค้า says "these four cars are film jobs" once instead of
 * repeating it on every line, and the lines that are left are short enough to
 * read whole.
 *
 * Input order is preserved (the caller sorts by วันที่นัด), so every level
 * comes out in first-seen order.
 */
export function groupUpcoming(upcoming: UpcomingTicket[]) {
  const days: {
    key: string;
    date: Date;
    byService: {
      serviceType: string;
      byCategory: { category: string; tickets: UpcomingTicket[] }[];
    }[];
  }[] = [];
  for (const t of upcoming) {
    const date = appointmentDate(t) ?? t.dropOff;
    // The shop's calendar day, not the server's: a job at 02:00 in Bangkok is
    // still the previous day in UTC, and the deployed server runs in UTC.
    const key = shopDayKey(date);
    let day = days.find((d) => d.key === key);
    if (!day) {
      day = { key, date, byService: [] };
      days.push(day);
    }
    const serviceType = t.serviceType || 'ยังไม่ระบุการนัดหมาย';
    let group = day.byService.find((g) => g.serviceType === serviceType);
    if (!group) {
      group = { serviceType, byCategory: [] };
      day.byService.push(group);
    }
    // A job carrying two ชนิดสินค้า is ONE job and stays one line — listing it
    // under each would read as two cars coming in.
    const category = t.categories.filter(Boolean).join(', ') || 'ยังไม่ระบุชนิดสินค้า';
    let cat = group.byCategory.find((c) => c.category === category);
    if (!cat) {
      cat = { category, tickets: [] };
      group.byCategory.push(cat);
    }
    cat.tickets.push(t);
  }
  return days;
}
