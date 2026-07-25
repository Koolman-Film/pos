'use client';

// Ported from reference/v0.4/finnix-film.html:571-641.
// The prototype drove navigation through SPA `setActiveId`/`setView`; here a day
// with a single ticket routes to that ticket's detail page and a day with several
// routes to the ticket list (both owned by the Tickets module, Task 14). The
// month-navigation state, the last-status-per-ticket derivation from
// statusHistory, the weekday grid, the today highlight and the per-status dot
// counts are all preserved verbatim.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type CalendarStatus = { key: string; short: string; dot: string };

export type CalendarTicket = {
  id: string;
  shop: string;
  status: string;
  dropOff: Date;
  statusHistory: { status: string; changedAt: Date }[];
};

// Ported from reference/v0.4/finnix-film.html:228-235 (DEFAULT_STATUSES). Used as
// the fallback palette so JobCalendar is self-contained; a caller with the live
// `statuses` config table can override it.
export const DEFAULT_STATUSES: CalendarStatus[] = [
  { key: 'จองแล้ว', short: 'จองแล้ว', dot: '#B5AAA1' },
  { key: 'กำลัง QC ก่อนติดตั้ง', short: 'รอ QC', dot: '#E8B23D' },
  { key: 'กำลังติดตั้ง', short: 'กำลังติดตั้ง', dot: '#2F8F82' },
  { key: 'รอส่งมอบ', short: 'รอส่งมอบ', dot: '#6BA24F' },
  { key: 'ส่งมอบแล้ว', short: 'ส่งมอบแล้ว', dot: '#B5AAA1' },
  { key: 'ค้างชำระ', short: 'ค้างชำระ', dot: '#C24B57' },
];

function getStatus(statuses: CalendarStatus[], key: string): CalendarStatus {
  return statuses.find((s) => s.key === key) || statuses[0] || { key, short: key, dot: '#B5AAA1' };
}

export function JobCalendar({
  tickets,
  shopFilter,
  statuses = DEFAULT_STATUSES,
}: {
  tickets: CalendarTicket[];
  shopFilter: string;
  statuses?: CalendarStatus[];
}) {
  const router = useRouter();
  const [calDate, setCalDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = new Date(year, month, 1).getDay();

  const dayMap: Record<number, { ticketId: string; status: string }[]> = {};
  tickets
    .filter((t) => shopFilter === 'all' || t.shop === shopFilter)
    .forEach((t) => {
      const hist = t.statusHistory || [];
      let d0: Date;
      let status: string;
      if (hist.length > 1) {
        const last = hist[hist.length - 1];
        d0 = last.changedAt;
        status = last.status;
      } else {
        d0 = t.dropOff;
        status = t.status;
      }
      if (d0.getFullYear() === year && d0.getMonth() === month) {
        const d = d0.getDate();
        if (!dayMap[d]) dayMap[d] = [];
        dayMap[d].push({ ticketId: t.id, status });
      }
    });

  const weekdayLabels = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  return (
    <div className="card p-5 lg:col-span-2">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setCalDate(new Date(year, month - 1, 1))}
          className="w-6 h-6 rounded-lg flex items-center justify-center"
          style={{ color: 'var(--ink-soft)' }}
        >
          <i className="fa-solid fa-chevron-left text-xs"></i>
        </button>
        <p className="text-sm font-semibold">
          ปฏิทินงาน &middot;{' '}
          {calDate.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}
        </p>
        <button
          onClick={() => setCalDate(new Date(year, month + 1, 1))}
          className="w-6 h-6 rounded-lg flex items-center justify-center"
          style={{ color: 'var(--ink-soft)' }}
        >
          <i className="fa-solid fa-chevron-right text-xs"></i>
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {weekdayLabels.map((w) => (
          <div
            key={w}
            className="text-xs text-center font-medium"
            style={{ color: 'var(--ink-faint)' }}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, idx) => {
          if (d === null) return <div key={idx}></div>;
          const dayTickets = dayMap[d] || [];
          const dayStatuses = statuses
            .map((s) => s.key)
            .filter((s) => dayTickets.some((t) => t.status === s));
          const isToday = isCurrentMonth && d === today.getDate();
          return (
            <div
              key={idx}
              onClick={() => {
                if (dayTickets.length === 1) router.push(`/tickets/${dayTickets[0].ticketId}`);
                else if (dayTickets.length > 1) router.push('/tickets');
              }}
              className="rounded-lg p-1.5 flex flex-col"
              style={{
                border: isToday ? '2px solid var(--primary)' : '1px solid var(--line)',
                background: dayTickets.length
                  ? 'var(--surface)'
                  : isToday
                    ? 'var(--primary-soft)'
                    : 'var(--paper)',
                boxShadow: isToday ? 'var(--shadow-red)' : 'none',
                minHeight: '92px',
                cursor: dayTickets.length ? 'pointer' : 'default',
              }}
            >
              <span
                className="text-[10px] mb-1"
                style={{
                  color: isToday ? 'var(--primary)' : 'var(--ink-soft)',
                  fontWeight: isToday ? 700 : 500,
                }}
              >
                {d}
              </span>
              <div className="flex flex-col gap-px">
                {dayStatuses.map((s) => (
                  <div key={s} className="flex items-center justify-between gap-0.5">
                    <span
                      className="flex items-center gap-0.5 min-w-0"
                      style={{ color: 'var(--ink-soft)' }}
                    >
                      <span
                        className="rounded-full flex-shrink-0"
                        style={{
                          width: '5px',
                          height: '5px',
                          background: getStatus(statuses, s).dot,
                        }}
                      ></span>
                      <span style={{ fontSize: '8px', lineHeight: '10px' }}>
                        {getStatus(statuses, s).short}
                      </span>
                    </span>
                    <span
                      className="font-bold flex-shrink-0"
                      style={{
                        fontSize: '8px',
                        lineHeight: '10px',
                        color: getStatus(statuses, s).dot,
                      }}
                    >
                      {dayTickets.filter((t) => t.status === s).length}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
