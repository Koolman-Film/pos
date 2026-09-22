'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

import { PeriodShopFilter, type Shop } from '@/components/ui/PeriodShopFilter';
import { fmt, fmtThaiDate } from '@/lib/domain/format';
import { currentMonthValue, daysAgoValue, exportStamp, todayValue } from '@/lib/domain/now';
import { DEFAULT_PERIOD, isInPeriod, periodCaption } from '@/lib/domain/period';
import { useIsMounted } from '@/lib/hooks/useIsMounted';

import type { SaleLine } from '@/app/(app)/revenue/data';

import { groupRevenueReport, type ReportRow } from './revenueReport';

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
  car: string;
  bookingChannel: string;
  payment?: SaleLine['payment'];
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
  const [channelFilter, setChannelFilter] = useState('all');

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
      (channelFilter === 'all' || l.channel === channelFilter) &&
      (docFilter === 'all' || (docFilter === 'tax' ? !!l.taxInvoiceNo : !l.taxInvoiceNo)),
  );

  /*
    ปลีก / ส่ง.

    Wholesale used to appear in no figure on this page at all, so adding it
    would have moved every total with nothing on screen to say why. Both
    figures are computed over the period and branch in view, and over `scoped`
    rather than `visible`, so the split keeps reading as the whole period even
    while the table below is filtered down to one of them.
  */
  const retailTotal = scoped.filter((l) => l.channel === 'ปลีก').reduce((n, l) => n + l.amount, 0);
  const wholesaleTotal = scoped
    .filter((l) => l.channel === 'ส่ง')
    .reduce((n, l) => n + l.amount, 0);
  const wholesaleOrders = new Set(scoped.filter((l) => l.channel === 'ส่ง').map((l) => l.ticketId))
    .size;
  // Counted apart from `jobCount`, which counts distinct ids across both
  // channels: standing next to a PO count, "8 ใบงาน" has to mean ใบงาน.
  const retailJobs = new Set(scoped.filter((l) => l.channel === 'ปลีก').map((l) => l.ticketId))
    .size;
  /** Whether this branch sells wholesale at all — Central Audio does, most do not. */
  const hasWholesale = wholesaleOrders > 0;

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
          car: l.car ?? '',
          bookingChannel: l.bookingChannel ?? '',
          // The first line carries the ticket's amounts; that is the one kept.
          payment: l.payment,
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
  /*
    ยอดที่ออกใบกำกับภาษี — การ์ดถูกซ่อนไว้ก่อน (ร้านขอ 19 ก.ย. 2569): the shop
    does not need the figure on this screen yet. Which sales carry a tax
    invoice is still answerable here — the กรองตามเอกสาร filter and the
    เลขที่ใบกำกับภาษี column below are untouched.
  */
  /*
    กำไรขั้นต้น — การ์ดถูกซ่อนไว้ก่อน (ร้านขอ 19 ก.ย. 2569).

    The figure divided two readings of the same words: cost as the lots a job
    drew on (migration 0027, what the per-line ต้นทุน in the export still is),
    or cost as the ต้นทุนขาย category in ค่าใช้จ่าย. Until the shop decides which
    one it means, the screen says neither — a margin nobody agrees the
    definition of is worse than no margin at all.
  */

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

  /*
    รายงาน = what the filters leave on screen, laid out สาขา → แหล่งเงิน →
    วันที่: a table per แหล่งเงิน with its totals, a total per branch and for
    the whole report (components/revenue/revenueReport.ts). The PDF and the
    Excel file are the same report (ร้านขอ 22 ก.ย. 2569).
  */
  const report = groupRevenueReport(
    visible,
    accessibleShops.map((s) => s.id),
  );
  const mounted = useIsMounted();
  /*
    The printed report is built only for the print it is asked for: it repeats
    every row on the page, and a second full copy sitting in the document the
    rest of the time is weight for nothing.
  */
  const [printing, setPrinting] = useState(false);
  function exportPDF() {
    flushSync(() => setPrinting(true));
    window.print();
    setPrinting(false);
  }

  async function exportExcel() {
    if (!exportAction) return;
    const rowOf = (r: ReportRow): Record<string, string | number> => {
      const l = r.line;
      return {
        วันที่ขาย: l.soldAt,
        ใบงาน: l.ticketId,
        ลูกค้า: l.customer,
        ทะเบียน: l.plate,
        'ยี่ห้อ/รุ่น': l.car ?? '',
        จองผ่าน: l.bookingChannel ?? '',
        ช่องทาง: l.channel,
        ชนิดสินค้า: l.category,
        สินค้า: l.product,
        ยอดขาย: l.amount,
        ...(canSeeCost ? { ต้นทุน: l.cost, กำไรขั้นต้น: l.amount - l.cost } : {}),
        วิธีชำระ: l.payment?.methods ?? '',
        สถานะชำระ: l.payment?.status ?? '',
        // The document's money, on the first of its lines in the report only.
        ชำระแล้ว: r.paid,
        ค้างชำระ: r.due,
        เลขที่ใบกำกับภาษี: l.taxInvoiceNo,
      };
    };
    const totalRow = (
      label: string,
      t: { amount: number; paid: number; due: number },
    ): Record<string, string | number> => ({
      วันที่ขาย: '',
      ใบงาน: '',
      ลูกค้า: label,
      ยอดขาย: t.amount,
      ชำระแล้ว: t.paid,
      ค้างชำระ: t.due,
    });
    const groups: { sheetName: string; rows: Record<string, string | number>[] }[] = [
      ...report.sections.map((sec) => ({
        sheetName: shopName(sec.shopId),
        rows: [
          ...sec.tables.flatMap((t) => [
            ...t.rows.map(rowOf),
            totalRow(`รวม แหล่งเงิน ${t.source}`, t),
          ]),
          totalRow(`รวมทั้งสาขา ${shopName(sec.shopId)}`, sec),
        ],
      })),
      {
        sheetName: 'สรุปรวม',
        rows: [
          ...report.sections.flatMap((sec) =>
            sec.tables.map((t) => ({
              สาขา: shopName(sec.shopId),
              แหล่งเงิน: t.source,
              ยอดขาย: t.amount,
              ชำระแล้ว: t.paid,
              ค้างชำระ: t.due,
            })),
          ),
          {
            สาขา: 'ยอดรวมทั้งหมด',
            แหล่งเงิน: '',
            ยอดขาย: report.amount,
            ชำระแล้ว: report.paid,
            ค้างชำระ: report.due,
          },
        ],
      },
    ];
    // เงินรอคืน Finnix: collected here, not this branch's takings — its own
    // sheet, in the file the accountant reconciles the drawer with, but in none
    // of the totals above.
    if (heldJobs.length) {
      groups.push({
        sheetName: 'เงินรอคืน Finnix',
        rows: heldJobs.map((j) => ({
          วันที่ขาย: j.soldAt,
          ใบงาน: j.ticketId,
          สาขา: shopName(j.shop),
          ลูกค้า: j.customer,
          ทะเบียน: j.plate,
          'ยี่ห้อ/รุ่น': j.car,
          จองผ่าน: j.bookingChannel,
          สินค้า: j.products.join(', '),
          วิธีชำระ: j.payment?.methods ?? '',
          สถานะชำระ: j.payment?.status ?? '',
          เงินรอคืน: j.amount,
        })),
      });
    }
    const result = await exportAction({ fileNameBase: `รายได้-${exportStamp()}`, groups });
    if (result) downloadBase64(result.base64, result.fileName);
  }

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold">รายได้</h1>
        {canExport && (
          <div className="flex gap-2">
            <button
              onClick={exportExcel}
              className="btn-outline text-sm px-3.5 py-2 rounded-xl font-semibold flex items-center gap-2"
            >
              <i className="fa-solid fa-file-excel" style={{ color: '#1D6F42' }}></i>Excel
            </button>
            {/* PDF (ร้านขอ 22 ก.ย. 2569) — the same report as the Excel file. */}
            <button
              onClick={exportPDF}
              className="btn-outline text-sm px-3.5 py-2 rounded-xl font-semibold flex items-center gap-2"
            >
              <i className="fa-solid fa-file-pdf" style={{ color: '#C0392B' }}></i>PDF
            </button>
          </div>
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
        {/* ปลีก/ส่ง takes the place of the plain job count wherever the branch
            sells both, because "how much of this is wholesale" is the question
            the count was standing in for. */}
        {hasWholesale ? (
          <div className="card p-4">
            <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              ปลีก / ส่ง
            </p>
            <p className="text-lg font-extrabold">
              {fmt(retailTotal)}
              <span style={{ color: 'var(--ink-faint)' }}> / </span>
              <span style={{ color: '#2F6F8F' }}>{fmt(wholesaleTotal)}</span>
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
              {retailJobs} ใบงาน · {wholesaleOrders} PO
            </p>
          </div>
        ) : (
          <div className="card p-4">
            <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              จำนวนใบงาน
            </p>
            <p className="text-2xl font-extrabold">{jobCount}</p>
          </div>
        )}
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
                  {/* The count is of distinct ids, and once wholesale is in the
                      figure some of those ids are POs. Calling them all ใบงาน
                      would misdescribe the number it is sitting next to. */}
                  {c.jobs} {hasWholesale ? 'รายการ' : 'ใบงาน'}
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
            {/* Only where both channels exist — a branch that sells one way
                gets no control that cannot change anything. */}
            {hasWholesale && (
              <select
                aria-label="กรองตามช่องทางการขาย"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="field text-xs px-2.5 py-1.5"
              >
                <option value="all">ทุกช่องทาง</option>
                <option value="ปลีก">ขายปลีก</option>
                <option value="ส่ง">ขายส่ง</option>
              </select>
            )}
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
                <th className="text-left font-medium py-2">ใบงาน/PO</th>
                {hasWholesale && <th className="text-left font-medium py-2">ช่องทาง</th>}
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
                  <td
                    colSpan={hasWholesale ? 8 : 7}
                    className="py-4 text-xs"
                    style={{ color: 'var(--ink-faint)' }}
                  >
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
                    <a
                      href={`${l.channel === 'ส่ง' ? '/wholesale' : '/tickets'}/${l.ticketId}`}
                      style={{ color: 'var(--primary)' }}
                    >
                      {l.ticketId}
                    </a>
                  </td>
                  {hasWholesale && (
                    <td className="py-2 text-xs">
                      {l.channel === 'ส่ง' ? (
                        <span style={{ color: '#2F6F8F' }}>ขายส่ง</span>
                      ) : (
                        <span style={{ color: 'var(--ink-faint)' }}>ขายปลีก</span>
                      )}
                    </td>
                  )}
                  <td className="py-2">
                    {l.customer}
                    {/* ทะเบียนรถ for retail; a wholesale sale has no vehicle and
                        carries the พนักงานขาย in the same place instead. */}
                    <div className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                      {l.channel === 'ส่ง' && l.plate ? `ขายโดย ${l.plate}` : l.plate}
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
      {mounted &&
        printing &&
        createPortal(
          <div className="print-area">
            <h2>
              รายงานรายได้{shopFilter !== 'all' ? ' · ' + shopName(shopFilter) : ''}
              {categoryFilter !== 'all' ? ' · ' + categoryFilter : ''}
              {channelFilter !== 'all' ? ' · ขาย' + channelFilter : ''} ·{' '}
              {periodCaption(period, periodValue, rangeStart, rangeEnd, new Date()).replace(
                'สรุปข้อมูล',
                '',
              )}
            </h2>
            <p>วันที่พิมพ์: {fmtThaiDate(new Date())}</p>
            {report.sections.map((sec) => (
              <div key={sec.shopId} style={{ marginBottom: 18 }}>
                <h3>{shopName(sec.shopId)}</h3>
                {sec.tables.map((t) => (
                  <div key={t.source} style={{ marginBottom: 12 }}>
                    <p style={{ fontWeight: 'bold', margin: '8px 0 4px' }}>แหล่งเงิน: {t.source}</p>
                    <table>
                      <thead>
                        <tr>
                          <th>วันที่ขาย</th>
                          <th>ใบงาน</th>
                          <th>ลูกค้า / ทะเบียน</th>
                          <th>ยี่ห้อ/รุ่น</th>
                          <th>จองผ่าน</th>
                          <th>ชนิดสินค้า</th>
                          <th>สินค้า</th>
                          <th style={{ textAlign: 'right' }}>ยอดขาย</th>
                          <th>สถานะชำระ</th>
                          <th style={{ textAlign: 'right' }}>ชำระแล้ว</th>
                          <th style={{ textAlign: 'right' }}>ค้างชำระ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r, i) => (
                          <tr key={`${r.line.ticketId}-${i}`}>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {fmtThaiDate(new Date(`${r.line.soldAt}T00:00:00`))}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>{r.line.ticketId}</td>
                            <td>
                              {r.line.customer}
                              {r.line.plate ? ` · ${r.line.plate}` : ''}
                            </td>
                            <td>{r.line.car || '-'}</td>
                            <td>{r.line.bookingChannel || '-'}</td>
                            <td>{r.line.category}</td>
                            <td>{r.line.product}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(r.line.amount)}</td>
                            <td>{r.line.payment?.status ?? '-'}</td>
                            <td style={{ textAlign: 'right' }}>{r.paid ? fmt(r.paid) : ''}</td>
                            <td style={{ textAlign: 'right' }}>{r.due ? fmt(r.due) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={7} style={{ fontWeight: 'bold' }}>
                            รวม แหล่งเงิน {t.source}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                            {fmt(t.amount)}
                          </td>
                          <td></td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(t.paid)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(t.due)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ))}
                <p style={{ textAlign: 'right', margin: '4px 0 0' }}>
                  <strong>
                    รวมทั้งสาขา {shopName(sec.shopId)}: ยอดขาย {fmt(sec.amount)} · ชำระแล้ว{' '}
                    {fmt(sec.paid)} · ค้างชำระ {fmt(sec.due)} บาท
                  </strong>
                </p>
              </div>
            ))}
            <p style={{ textAlign: 'right', fontSize: 14 }}>
              <strong>
                ยอดรวมทั้งหมด: ยอดขาย {fmt(report.amount)} · ชำระแล้ว {fmt(report.paid)} · ค้างชำระ{' '}
                {fmt(report.due)} บาท
              </strong>
            </p>
            <p style={{ fontSize: 11 }}>
              ชำระแล้ว / ค้างชำระ เป็นยอดของทั้งใบงานหรือ PO นับครั้งเดียวต่อเอกสาร
              จึงไม่จำเป็นต้องเท่ากับยอดขายของช่วงนี้ เช่น ประกันที่ขายต่างเดือนกับใบงาน
            </p>
            {heldJobs.length > 0 && (
              <p style={{ fontSize: 11 }}>
                เงินรอคืน Finnix ในช่วงนี้ {heldJobs.length} ใบงาน รวม{' '}
                {fmt(heldJobs.reduce((s, j) => s + j.amount, 0))} บาท — ไม่รวมในยอดข้างบน
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
