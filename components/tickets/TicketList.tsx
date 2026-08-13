'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { Badge, getStatus, type StatusConfig } from '@/components/ui/Badge';
import { fmt, fmtThaiDate } from '@/lib/domain/format';
import { currentMonthValue, daysAgoValue, exportStamp, todayValue } from '@/lib/domain/now';
import { DEFAULT_PERIOD, isInPeriod } from '@/lib/domain/period';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { ticketTotal } from '@/lib/domain/tickets';

import type { Shop, TicketListRow } from './types';

/**
 * Ported from reference/v0.4/finnix-film.html:959-1149.
 *
 * Adaptations for the port:
 *  - filtering/sorting stay client-side over the fetched page's tickets (same UX);
 *  - the "create new" control is hidden unless `canDo('list.createNew')`;
 *  - shop-scoping shows via `accessibleShops` and is enforced for real by RLS;
 *  - navigation uses real routes (`/tickets/new`, `/tickets/[id]`) via anchors,
 *    the App Router equivalent of the prototype's `setView`/`setActiveId`.
 */
export function TicketList({
  tickets,
  statuses,
  canDo,
  accessibleShops,
  shops,
  canSeeAllShops = true,
}: {
  tickets: TicketListRow[];
  statuses: StatusConfig[];
  canDo: (key: string) => boolean;
  accessibleShops: Shop[];
  shops?: Shop[];
  canSeeAllShops?: boolean;
}) {
  const shopList = shops ?? accessibleShops;
  const shopName = (id: string) => shopList.find((s) => s.id === id)?.name ?? id;

  // document.body only exists client-side; guard the print portal on mount.
  const mounted = useIsMounted();

  const [statusFilter, setStatusFilter] = useState('all');
  const [shopFilter, setShopFilter] = useState<string>(
    canSeeAllShops ? 'all' : accessibleShops[0]?.id || 'all',
  );
  const [customerFilter, setCustomerFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD);
  const [periodValue, setPeriodValue] = useState(() => currentMonthValue());
  const [rangeStart, setRangeStart] = useState(() => daysAgoValue(6));
  const [rangeEnd, setRangeEnd] = useState(() => todayValue());

  function inSelectedPeriod(dateObj: Date | null | undefined) {
    return isInPeriod(dateObj, period, periodValue, rangeStart, rangeEnd);
  }

  /**
   * Everything the caller has narrowed to EXCEPT the status filter — shop,
   * customer, search and period. The status chips count over this, so each
   * number answers "how many would I get if I clicked here" and the totals
   * describe the same set of tickets the list below is showing. They used to be
   * counted over every loaded ticket, so switching the period left the chips
   * reporting one figure and the list another.
   */
  let scoped = tickets;
  if (shopFilter !== 'all') scoped = scoped.filter((t) => t.shop === shopFilter);
  if (customerFilter !== 'all') scoped = scoped.filter((t) => t.customer === customerFilter);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    scoped = scoped.filter(
      (t) => t.customer.toLowerCase().includes(q) || t.plate.toLowerCase().includes(q),
    );
  }
  scoped = scoped.filter((t) => inSelectedPeriod(t.dropOffDateObj));

  const visible = statusFilter === 'all' ? scoped : scoped.filter((t) => t.status === statusFilter);

  const customerOptions = [
    ...new Set(
      (shopFilter === 'all' ? tickets : tickets.filter((t) => t.shop === shopFilter)).map(
        (t) => t.customer,
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, 'th'));

  const exportShopIds =
    shopFilter === 'all'
      ? accessibleShops.map((s) => s.id).filter((id) => visible.some((t) => t.shop === id))
      : [shopFilter];
  const exportGroups = exportShopIds.map((id) => ({
    shopId: id,
    items: visible
      .filter((t) => t.shop === id)
      .sort(
        (a, b) =>
          (a.dropOffDateObj ? new Date(a.dropOffDateObj).getTime() : 0) -
          (b.dropOffDateObj ? new Date(b.dropOffDateObj).getTime() : 0),
      ),
  }));

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    if (exportGroups.length === 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'ใบงาน');
    } else {
      exportGroups.forEach((g) => {
        const data = g.items.map((t) => ({
          วันที่รับรถ: fmtThaiDate(t.dropOffDateObj),
          เลขที่ใบงาน: t.id,
          ลูกค้า: t.customer,
          'ทะเบียนรถ/เลขถัง': t.plate,
          สินค้า: t.items.map((i) => i.category).join(', '),
          สถานะ: t.status,
          ยอดสุทธิ: ticketTotal(t),
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const sheetName =
          shopName(g.shopId)
            .replace(/[:\\/?*[\]]/g, '')
            .slice(0, 31) || g.shopId;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
    }
    XLSX.writeFile(wb, `tickets-${shopFilter}-${exportStamp()}.xlsx`);
  }
  function exportPDF() {
    window.print();
  }

  const statusCounts: Record<string, number> = {};
  scoped.forEach((t) => {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  });

  /**
   * One chip per status IN THE STATUSES TABLE, in its configured order.
   *
   * These used to be four hard-coded prototype keys, so a shop that renamed or
   * added statuses got chips for things it no longer used ("รอชำระ" counting a
   * `ค้างชำระ` status that had been replaced) and none at all for the ones it
   * did. The dashboard's status bars already read the live table, which is why
   * the two screens disagreed; both sides now come from the same list.
   */
  const chips = [
    { key: 'all', label: 'ทั้งหมด', count: scoped.length },
    ...statuses.map((s) => ({
      key: s.key,
      label: s.short || s.key,
      count: statusCounts[s.key] || 0,
    })),
  ];

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold">Book งาน</h1>
        <div className="flex items-center gap-2">
          {/* Only roles that may restore see the bin at all. */}
          {canDo('list.restore') && (
            <Link
              href="/tickets/trash"
              className="btn-outline text-sm px-4 py-2 rounded-xl font-medium flex items-center gap-2"
            >
              <i className="fa-solid fa-trash-can"></i>ถังขยะ
            </Link>
          )}
          {canDo('list.createNew') && (
            <Link
              href="/tickets/new"
              className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold hidden sm:flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i>สร้างใหม่
            </Link>
          )}
        </div>
      </div>
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        <div
          className="flex rounded-xl overflow-hidden"
          style={{ border: '1.5px solid var(--line)' }}
        >
          {(
            [
              ['today', 'วันนี้'],
              ['month', 'รายเดือน'],
              ['year', 'รายปี'],
              ['range', 'ช่วงเวลา'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className="text-xs px-3 py-2 font-semibold"
              style={{
                background: period === key ? 'var(--primary)' : 'transparent',
                color: period === key ? '#fff' : 'var(--ink-soft)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {period === 'today' && (
          <span
            className="text-xs px-3 py-2 rounded-lg font-medium"
            style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}
          >
            <i className="fa-regular fa-calendar mr-1.5"></i>
            {new Date().toLocaleDateString('th-TH', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        )}
        {period === 'month' && (
          <input
            type="month"
            value={periodValue}
            onChange={(e) => setPeriodValue(e.target.value)}
            aria-label="เลือกเดือน"
            className="field text-sm px-3 py-2"
          />
        )}
        {period === 'year' && (
          <select
            value={periodValue}
            aria-label="เลือกปี"
            onChange={(e) => setPeriodValue(e.target.value)}
            className="field text-sm px-3 py-2"
          >
            {[2569, 2568, 2567].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
        {period === 'range' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="field text-sm px-3 py-2"
            />
            <i
              className="fa-solid fa-arrow-right text-xs"
              style={{ color: 'var(--ink-faint)' }}
            ></i>
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="field text-sm px-3 py-2"
            />
          </div>
        )}
      </div>
      <div className="card p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          {accessibleShops.length > 1 ? (
            <select
              value={shopFilter}
              aria-label="กรองตามสาขา"
              onChange={(e) => {
                setShopFilter(e.target.value);
                setCustomerFilter('all');
              }}
              className="field flex-1 text-sm px-3.5 py-2.5"
            >
              {canSeeAllShops && <option value="all">ทุกร้าน ({accessibleShops.length})</option>}
              {accessibleShops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <div
              className="field flex-1 text-sm px-3.5 py-2.5"
              style={{ color: 'var(--ink-soft)' }}
            >
              {shopName(accessibleShops[0]?.id || '')}
            </div>
          )}
          <div className="relative flex-1">
            <i
              className="fa-solid fa-magnifying-glass absolute left-3.5 top-3 text-xs"
              style={{ color: 'var(--ink-faint)' }}
            ></i>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหา ชื่อ / ทะเบียนรถ/เลขถัง"
              className="field w-full text-sm pl-9 pr-3.5 py-2.5"
            />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <select
            value={customerFilter}
            aria-label="กรองตามลูกค้า"
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="field flex-1 text-sm px-3.5 py-2.5"
          >
            <option value="all">ทุกลูกค้า</option>
            {customerOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            aria-label="กรองตามสถานะ"
            onChange={(e) => setStatusFilter(e.target.value)}
            className="field flex-1 text-sm px-3.5 py-2.5"
          >
            <option value="all">ทุกสถานะ</option>
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.key}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={exportExcel}
              className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              <i className="fa-solid fa-file-excel" style={{ color: '#1D6F42' }}></i>Excel
            </button>
            <button
              onClick={exportPDF}
              className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              <i className="fa-solid fa-file-pdf" style={{ color: '#C0392B' }}></i>PDF
            </button>
          </div>
        </div>
        <div className="flex gap-2 mb-5 flex-wrap">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setStatusFilter(c.key)}
              className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition ${
                statusFilter === c.key ? 'pill-active' : 'pill-inactive'
              }`}
            >
              {c.label} {c.count}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          {visible.length === 0 && (
            <p
              className="text-sm py-10 text-center flex flex-col items-center gap-2"
              style={{ color: 'var(--ink-faint)' }}
            >
              <i className="fa-regular fa-face-frown text-xl"></i>ไม่มีใบงานตรงกับตัวกรองนี้
            </p>
          )}
          {(shopFilter === 'all'
            ? accessibleShops
            : shopList.filter((s) => s.id === shopFilter)
          ).map((shop) => {
            const shopTickets = visible.filter((t) => t.shop === shop.id);
            if (shopTickets.length === 0) return null;
            return (
              <div key={shop.id}>
                {shopFilter === 'all' && (
                  <p
                    className="text-xs font-bold uppercase tracking-wide mt-3 mb-2 first:mt-0"
                    style={{ color: 'var(--primary)' }}
                  >
                    {shop.name} ({shopTickets.length})
                  </p>
                )}
                <div className="flex flex-col gap-2.5">
                  {shopTickets.map((t) => (
                    <a
                      key={t.id}
                      href={`/tickets/${t.id}`}
                      className="group rounded-2xl flex items-stretch justify-between cursor-pointer gap-3 overflow-hidden transition hover:shadow-md"
                      style={{ border: '1px solid var(--line)' }}
                    >
                      <div
                        className="status-bar"
                        style={{ background: getStatus(statuses, t.status).dot }}
                      ></div>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between flex-1 min-w-0 gap-1.5 sm:gap-3 py-3 pr-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {t.customer} &middot; {t.plate}
                          </p>
                          <p
                            className="text-xs mt-0.5 truncate"
                            style={{ color: 'var(--ink-soft)' }}
                          >
                            {t.items.map((i) => i.category).join(' + ') || 'ยังไม่มีสินค้า'}{' '}
                            &middot; {t.id}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right">
                            <Badge status={t.status} statuses={statuses} />
                            <p
                              className="text-xs mt-1.5 hidden sm:block"
                              style={{ color: 'var(--ink-faint)' }}
                            >
                              {(() => {
                                const all = Object.values(t.techByCategory || {}).flat();
                                return all.length ? all.join(', ') : 'ยังไม่มอบหมาย';
                              })()}{' '}
                              &middot; รับรถ {fmtThaiDate(t.pickupDateObj)}
                            </p>
                          </div>
                          <span className="row-action pr-3" style={{ color: 'var(--primary)' }}>
                            <i className="fa-solid fa-chevron-right text-xs"></i>
                          </span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {canDo('list.createNew') && (
          <Link
            href="/tickets/new"
            className="btn-outline mt-5 w-full rounded-full py-3 text-sm font-semibold flex items-center justify-center gap-2 sm:hidden"
          >
            <i className="fa-solid fa-plus"></i> สร้างใบงานใหม่
          </Link>
        )}
      </div>
      {mounted &&
        createPortal(
          <div className="print-area">
            <h2>
              รายการใบงาน{shopFilter !== 'all' ? ' · ' + shopName(shopFilter) : ''}
              {customerFilter !== 'all' ? ' · ' + customerFilter : ''}
              {statusFilter !== 'all' ? ' · ' + statusFilter : ''}
            </h2>
            <p>วันที่พิมพ์: {new Date().toLocaleDateString('th-TH')}</p>
            {exportGroups.map((g) => (
              <div key={g.shopId} style={{ marginBottom: 16 }}>
                <h3>{shopName(g.shopId)}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>วันที่รับรถ</th>
                      <th>เลขที่ใบงาน</th>
                      <th>ลูกค้า</th>
                      <th>ทะเบียนรถ/เลขถัง</th>
                      <th>สินค้า</th>
                      <th>สถานะ</th>
                      <th style={{ textAlign: 'right' }}>ยอดสุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((t) => (
                      <tr key={t.id}>
                        <td>{fmtThaiDate(t.dropOffDateObj)}</td>
                        <td>{t.id}</td>
                        <td>{t.customer}</td>
                        <td>{t.plate}</td>
                        <td>{t.items.map((i) => i.category).join(', ')}</td>
                        <td>{t.status}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(ticketTotal(t))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p style={{ textAlign: 'right' }}>
              <strong>
                ยอดรวม:{' '}
                {fmt(
                  exportGroups.reduce(
                    (s, g) => s + g.items.reduce((s2, t) => s2 + ticketTotal(t), 0),
                    0,
                  ),
                )}{' '}
                บาท
              </strong>
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
}
