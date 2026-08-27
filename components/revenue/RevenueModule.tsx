'use client';

import Link from 'next/link';
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

/** One ใบงาน whose money is held for another Finnix shop. */
type HeldJob = {
  ticketId: string;
  shop: string;
  soldAt: string;
  customer: string;
  plate: string;
  products: string[];
  amount: number;
};

export function RevenueModule({
  lines,
  accessibleShops = [],
  canSeeAllShops = true,
  canExport = false,
  canSeeCost = false,
  exportAction,
}: {
  lines: SaleLine[];
  accessibleShops?: Shop[];
  canSeeAllShops?: boolean;
  canExport?: boolean;
  /**
   * ต้นทุนและกำไร are behind the same gate as stock prices (`seeStockPrices`).
   * A salesperson reads their own takings; margin is the owner’s figure.
   */
  canSeeCost?: boolean;
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

  const inScope = lines.filter((l) => inShop(l.shop) && inPeriod(l.soldAt));
  /*
    เงินรอคืน Finnix is split off before anything is counted (migration 0031).

    The customer paid this branch for a job that belongs to another Finnix
    shop, so the cash was taken and is on the ticket — but it is not this
    branch's takings. Folding it into ยอดขาย would overstate every figure on
    this page and disagree with the dashboard, which excludes it too.
  */
  const scoped = inScope.filter((l) => !l.held);
  const heldLines = inScope.filter((l) => l.held);
  const categories = [...new Set(scoped.map((l) => l.category))].sort();

  const visible = scoped.filter(
    (l) =>
      (categoryFilter === 'all' || l.category === categoryFilter) &&
      (docFilter === 'all' || (docFilter === 'tax' ? !!l.taxInvoiceNo : !l.taxInvoiceNo)),
  );

  const total = visible.reduce((s, l) => s + l.amount, 0);
  const heldTotal = heldLines.reduce((s, l) => s + l.amount, 0);
  /** One row per held ใบงาน — the report is read by job, not by product line. */
  const heldJobs = [
    ...heldLines
      .reduce((m, l) => {
        const row = m.get(l.ticketId) ?? {
          ticketId: l.ticketId,
          shop: l.shop,
          soldAt: l.soldAt,
          customer: l.customer,
          plate: l.plate,
          products: [] as string[],
          amount: 0,
        };
        row.products.push(l.product);
        row.amount += l.amount;
        return m.set(l.ticketId, row);
      }, new Map<string, HeldJob>())
      .values(),
  ].sort((a, b) => (a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0));
  // A ticket selling three categories is ONE job, counted once.
  const jobCount = new Set(visible.map((l) => l.ticketId)).size;
  const taxTotal = visible.filter((l) => l.taxInvoiceNo).reduce((s, l) => s + l.amount, 0);
  // Cost comes from the lots the jobs actually drew on (migration 0027), so
  // this is a real margin rather than a quantity times an average.
  const costTotal = visible.reduce((s, l) => s + l.cost, 0);
  const margin = total - costTotal;

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
    // A widened row shape: held jobs carry a เงินรอคืน column the sales rows
    // leave empty, so one sheet holds both piles without a second header.
    const rows: Record<string, string | number>[] = visible.map((l) => ({
      วันที่ขาย: l.soldAt,
      ใบงาน: l.ticketId,
      สาขา: shopName(l.shop),
      ลูกค้า: l.customer,
      ทะเบียน: l.plate,
      ชนิดสินค้า: l.category,
      สินค้า: l.product,
      ยอดขาย: l.amount,
      ...(canSeeCost ? { ต้นทุน: l.cost, กำไรขั้นต้น: l.amount - l.cost } : {}),
      เลขที่ใบกำกับภาษี: l.taxInvoiceNo,
    }));
    // Held jobs ride along at the bottom rather than in a second file: the
    // accountant reconciles the drawer against both piles at once.
    for (const j of heldJobs) {
      rows.push({
        วันที่ขาย: j.soldAt,
        ใบงาน: j.ticketId,
        สาขา: shopName(j.shop),
        ลูกค้า: j.customer,
        ทะเบียน: j.plate,
        ชนิดสินค้า: 'เงินรอคืน Finnix',
        สินค้า: j.products.join(', '),
        ยอดขาย: 0,
        ...(canSeeCost ? { ต้นทุน: 0, กำไรขั้นต้น: 0 } : {}),
        เลขที่ใบกำกับภาษี: '',
        เงินรอคืน: j.amount,
      });
    }
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

      <div
        className={`grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 ${
          canSeeCost ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
        }`}
      >
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
        {/* Held money gets a card of its own rather than a line inside ยอดขาย:
            it is a different pile, and the shop settles it separately. */}
        <div className="card p-4">
          <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            เงินรอคืน Finnix
          </p>
          <p className="text-2xl font-extrabold" style={{ color: '#8A5A12' }}>
            {fmt(heldTotal)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
            {heldJobs.length > 0 ? `${heldJobs.length} ใบงาน · ไม่รวมในยอดขาย` : 'ไม่มีในช่วงนี้'}
          </p>
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
        {canSeeCost && (
          <div className="card p-4">
            <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              กำไรขั้นต้น
            </p>
            <p className="text-2xl font-extrabold" style={{ color: '#2F7A4F' }}>
              {fmt(margin)}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
              ต้นทุน {fmt(costTotal)}
              {total > 0 ? ` · ${Math.round((margin / total) * 100)}%` : ''}
            </p>
          </div>
        )}
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

      {/* สรุปเงินรอคืน Finnix — only when the period holds any, so the page does
          not carry an empty table for the branches that never take this work. */}
      {heldJobs.length > 0 && (
        <div className="card p-5 mb-4" style={{ borderLeft: '3px solid #8A5A12' }}>
          <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
            <p className="text-sm font-semibold">เงินรอคืน Finnix ({heldJobs.length} ใบงาน)</p>
            <p className="text-lg font-extrabold" style={{ color: '#8A5A12' }}>
              {fmt(heldTotal)}
            </p>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-soft)' }}>
            ใบงานที่รับเงินแทน Finnix ในช่วงเวลานี้ — เก็บเงินแล้วแต่ไม่นับเป็นยอดขายของสาขา
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--ink-soft)' }}>
                  <th className="text-left font-medium py-2">วันที่</th>
                  <th className="text-left font-medium py-2">ใบงาน</th>
                  <th className="text-left font-medium py-2">ลูกค้า</th>
                  <th className="text-left font-medium py-2">สินค้า</th>
                  <th className="text-right font-medium py-2">ยอดรับแทน</th>
                </tr>
              </thead>
              <tbody>
                {heldJobs.map((j) => (
                  <tr key={j.ticketId} style={{ borderTop: '1px solid var(--line)' }}>
                    <td className="py-2 whitespace-nowrap text-xs">{j.soldAt}</td>
                    <td className="py-2">
                      <Link
                        href={`/tickets/${j.ticketId}`}
                        className="font-medium"
                        style={{ color: 'var(--primary)' }}
                      >
                        {j.ticketId}
                      </Link>
                      <span className="block text-xs" style={{ color: 'var(--ink-faint)' }}>
                        {shopName(j.shop)}
                      </span>
                    </td>
                    <td className="py-2">
                      {j.customer}
                      <span className="block text-xs" style={{ color: 'var(--ink-faint)' }}>
                        {j.plate}
                      </span>
                    </td>
                    <td className="py-2 text-xs">{j.products.join(', ')}</td>
                    <td className="py-2 text-right font-semibold whitespace-nowrap">
                      {fmt(j.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td className="py-2 text-xs font-semibold" colSpan={4}>
                    รวมเงินรอคืน Finnix
                  </td>
                  <td
                    className="py-2 text-right font-extrabold whitespace-nowrap"
                    style={{ color: '#8A5A12' }}
                  >
                    {fmt(heldTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

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
