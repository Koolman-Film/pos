'use client';

import { useState } from 'react';

import { PeriodShopFilter, type Shop } from '@/components/ui/PeriodShopFilter';
import { fmt, fmtThaiDate } from '@/lib/domain/format';
import { currentMonthValue, daysAgoValue, exportStamp, todayValue } from '@/lib/domain/now';
import { DEFAULT_PERIOD, isInPeriod, periodCaption } from '@/lib/domain/period';

import type { SaleLine } from '@/app/(app)/revenue/data';

/**
 * โมดูลรายได้ — รายการการขายแยกตามชนิดสินค้า.
 *
 * The shop reads its takings by ชนิดสินค้า: which line earns, not which ticket.
 * So the unit here is one PRODUCT LINE, and a ticket that sold film and audio
 * appears once under each. Summing the lines gives the same figure the dashboard
 * shows for the period, because both count a ticket on its วันที่รับงาน — with
 * ประกัน on its own วันที่ขาย, which is the point of it being its own record.
 *
 * The ใบกำกับภาษี column is the reason this module exists rather than a filter on
 * Book งาน: the accountant needs to see, for a month, which sales carry a tax
 * invoice and which do not.
 */

/** Reconstruct the download of a base64 xlsx returned by the Server Action. */
function downloadBase64(base64: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function RevenueModule({
  lines,
  accessibleShops = [],
  canSeeAllShops = true,
  canExport = false,
  exportAction,
}: {
  lines: SaleLine[];
  accessibleShops?: Shop[];
  canSeeAllShops?: boolean;
  canExport?: boolean;
  exportAction?: (payload: {
    fileNameBase: string;
    groups: { sheetName: string; rows: Record<string, string | number>[] }[];
  }) => Promise<{ fileName: string; base64: string } | null>;
}) {
  const [shopFilter, setShopFilter] = useState(
    canSeeAllShops ? 'all' : (accessibleShops[0]?.id ?? 'all'),
  );
  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD);
  const [periodValue, setPeriodValue] = useState(() => currentMonthValue());
  const [rangeStart, setRangeStart] = useState(() => daysAgoValue(6));
  const [rangeEnd, setRangeEnd] = useState(() => todayValue());
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [docFilter, setDocFilter] = useState('all');

  const shopName = (id: string) => accessibleShops.find((s) => s.id === id)?.name ?? id;

  const inShop = (s: string) => shopFilter === 'all' || s === shopFilter;
  const inPeriod = (d: string) =>
    // A line with no date cannot be placed in a period; `isInPeriod` treats a
    // null as "always in", which would smear undated rows across every month.
    d ? isInPeriod(new Date(`${d}T00:00:00`), period, periodValue, rangeStart, rangeEnd) : false;

  const scoped = lines.filter((l) => inShop(l.shop) && inPeriod(l.soldAt));
  const categories = [...new Set(scoped.map((l) => l.category))].sort();

  const visible = scoped.filter(
    (l) =>
      (categoryFilter === 'all' || l.category === categoryFilter) &&
      (docFilter === 'all' || (docFilter === 'tax' ? !!l.taxInvoiceNo : !l.taxInvoiceNo)),
  );

  const total = visible.reduce((s, l) => s + l.amount, 0);
  // A ticket selling three categories is ONE job, counted once.
  const jobCount = new Set(visible.map((l) => l.ticketId)).size;
  const taxTotal = visible.filter((l) => l.taxInvoiceNo).reduce((s, l) => s + l.amount, 0);

  const byCategory = categories
    .map((c) => {
      const rows = scoped.filter((l) => l.category === c);
      return {
        category: c,
        amount: rows.reduce((s, l) => s + l.amount, 0),
        jobs: new Set(rows.map((l) => l.ticketId)).size,
      };
    })
    .sort((a, b) => b.amount - a.amount);
  const scopedTotal = byCategory.reduce((s, c) => s + c.amount, 0);

  async function exportExcel() {
    if (!exportAction) return;
    const rows = visible.map((l) => ({
      วันที่ขาย: l.soldAt,
      ใบงาน: l.ticketId,
      สาขา: shopName(l.shop),
      ลูกค้า: l.customer,
      ทะเบียน: l.plate,
      ชนิดสินค้า: l.category,
      สินค้า: l.product,
      ยอดขาย: l.amount,
      เลขที่ใบกำกับภาษี: l.taxInvoiceNo,
    }));
    const result = await exportAction({
      fileNameBase: `รายได้-${exportStamp()}`,
      groups: [{ sheetName: 'รายการขาย', rows }],
    });
    if (result) downloadBase64(result.base64, result.fileName);
  }

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold">รายได้</h1>
        {canExport && (
          <button
            onClick={exportExcel}
            className="btn-outline text-sm px-3.5 py-2 rounded-xl font-semibold flex items-center gap-2"
          >
            <i className="fa-solid fa-file-excel" style={{ color: '#1D6F42' }}></i>Excel
          </button>
        )}
      </div>

      <PeriodShopFilter
        shopFilter={shopFilter}
        setShopFilter={setShopFilter}
        period={period}
        setPeriod={setPeriod}
        periodValue={periodValue}
        setPeriodValue={setPeriodValue}
        rangeStart={rangeStart}
        setRangeStart={setRangeStart}
        rangeEnd={rangeEnd}
        setRangeEnd={setRangeEnd}
        allowAllShops={canSeeAllShops}
        shopOptions={accessibleShops}
      />

      <p className="text-xs mb-4" style={{ color: 'var(--ink-soft)' }}>
        {periodCaption(period, periodValue, rangeStart, rangeEnd, new Date())}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="card p-4">
          <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            ยอดขายรวม
          </p>
          <p className="text-2xl font-extrabold" style={{ color: 'var(--revenue)' }}>
            {fmt(total)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            จำนวนใบงาน
          </p>
          <p className="text-2xl font-extrabold">{jobCount}</p>
        </div>
        <div className="card p-4">
          {/* The accountant's figure: how much of the period was invoiced. */}
          <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            ยอดที่ออกใบกำกับภาษี
          </p>
          <p className="text-2xl font-extrabold">{fmt(taxTotal)}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
            {total > 0 ? `${Math.round((taxTotal / total) * 100)}% ของยอดขาย` : '—'}
          </p>
        </div>
      </div>

      {/* แยกตามชนิดสินค้า — the headline the shop asked for. */}
      <div className="card p-5 mb-4">
        <p className="text-sm font-semibold mb-3">ยอดขายแยกตามชนิดสินค้า</p>
        {byCategory.length === 0 && (
          <p className="text-xs py-4 text-center" style={{ color: 'var(--ink-faint)' }}>
            ไม่มีการขายในช่วงเวลานี้
          </p>
        )}
        {byCategory.map((c) => (
          <button
            key={c.category}
            onClick={() => setCategoryFilter(categoryFilter === c.category ? 'all' : c.category)}
            className="w-full text-left mb-2.5"
          >
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium">
                {c.category}
                <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--ink-soft)' }}>
                  {c.jobs} ใบงาน
                </span>
                {categoryFilter === c.category && (
                  <span className="ml-1.5 text-xs" style={{ color: 'var(--primary)' }}>
                    (กำลังกรอง)
                  </span>
                )}
              </span>
              <span className="font-bold">{fmt(c.amount)}</span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: 'var(--paper)' }}
            >
              <div
                style={{
                  width: scopedTotal > 0 ? `${(c.amount / scopedTotal) * 100}%` : '0%',
                  height: '100%',
                  background: 'var(--primary)',
                }}
              />
            </div>
          </button>
        ))}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <p className="text-sm font-semibold">รายการขาย ({visible.length})</p>
          <div className="flex gap-2 flex-wrap">
            <select
              aria-label="กรองตามชนิดสินค้า"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="field text-xs px-2.5 py-1.5"
            >
              <option value="all">ทุกชนิดสินค้า</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              aria-label="กรองตามใบกำกับภาษี"
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
              className="field text-xs px-2.5 py-1.5"
            >
              <option value="all">ทุกรายการ</option>
              <option value="tax">ออกใบกำกับภาษีแล้ว</option>
              <option value="none">ยังไม่ออกใบกำกับภาษี</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--ink-soft)' }}>
                <th className="text-left font-medium py-2">วันที่ขาย</th>
                <th className="text-left font-medium py-2">ใบงาน</th>
                <th className="text-left font-medium py-2">ลูกค้า</th>
                <th className="text-left font-medium py-2">ชนิดสินค้า</th>
                <th className="text-left font-medium py-2">สินค้า</th>
                <th className="text-right font-medium py-2">ยอดขาย</th>
                <th className="text-left font-medium py-2">ใบกำกับภาษี</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-xs" style={{ color: 'var(--ink-faint)' }}>
                    ไม่มีรายการในเงื่อนไขนี้
                  </td>
                </tr>
              )}
              {visible.map((l, i) => (
                <tr
                  key={`${l.ticketId}-${l.category}-${l.product}-${i}`}
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <td className="py-2 whitespace-nowrap">
                    {l.soldAt ? fmtThaiDate(new Date(`${l.soldAt}T00:00:00`)) : '-'}
                  </td>
                  <td className="py-2">
                    <a href={`/tickets/${l.ticketId}`} style={{ color: 'var(--primary)' }}>
                      {l.ticketId}
                    </a>
                  </td>
                  <td className="py-2">
                    {l.customer}
                    <div className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                      {l.plate}
                    </div>
                  </td>
                  <td className="py-2">{l.category}</td>
                  <td className="py-2">{l.product}</td>
                  <td className="py-2 text-right font-semibold">{fmt(l.amount)}</td>
                  <td className="py-2 text-xs">
                    {l.taxInvoiceNo ? (
                      <span style={{ color: '#2F7A4F' }}>
                        <i className="fa-solid fa-circle-check mr-1"></i>
                        {l.taxInvoiceNo}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--ink-faint)' }}>ยังไม่ออก</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
