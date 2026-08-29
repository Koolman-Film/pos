'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';

import { PeriodShopFilter } from '@/components/ui/PeriodShopFilter';
import { fmt } from '@/lib/domain/format';
import { currentMonthValue, daysAgoValue, exportStamp, todayValue } from '@/lib/domain/now';
import { DEFAULT_PERIOD, isInPeriod } from '@/lib/domain/period';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { orderTotal, orderPaid } from '@/lib/domain/orders';

import {
  customerName,
  shopName,
  type Shop,
  type WsCustomer,
  type WsOrder,
  type WsStatusMap,
} from './types';

/**
 * Ported from reference/v0.4/finnix-film.html:2526-2648.
 *
 * The prototype held `orders` in React state and mutated it with `setOrders`;
 * here the list is server-rendered and navigation moves between the list and
 * `/wholesale/[id]` (with `/wholesale/new` for a fresh PO). Inline status
 * changes are mirrored locally for responsiveness and persisted through the
 * optional `onUpdateStatus` server action.
 *
 * `orderTotal` / `orderPaid` come from `lib/domain/orders.ts` — the same domain
 * functions the detail view and the Excel/print exports use.
 */
export function WholesaleList({
  orders,
  customers,
  canDo,
  caps,
  wsStatuses,
  accessibleShops,
  canSeeAllShops = true,
  onUpdateStatus,
  stockWarning,
}: {
  orders: WsOrder[];
  customers: WsCustomer[];
  /** Function form (prototype/tests) or serializable `caps` map (Server Component). */
  canDo?: (capabilityKey: string) => boolean;
  caps?: Record<string, boolean>;
  wsStatuses: WsStatusMap;
  accessibleShops: Shop[];
  canSeeAllShops?: boolean;
  onUpdateStatus?: (orderId: string, status: string) => Promise<void> | void;
  /**
   * สินค้าที่ตัดสต็อกไม่สำเร็จตอนบันทึก PO ใบล่าสุด.
   *
   * Shown here because saving a PO redirects to this list. The save itself
   * succeeds either way — losing the sale over a stock lookup would be the
   * worse failure — so this is the only place the shop finds out.
   */
  stockWarning?: string;
}) {
  const can = canDo ?? ((k: string) => !!caps?.[k]);
  const router = useRouter();
  const [list, setList] = useState<WsOrder[]>(orders);

  function updateOrderStatus(id: string, newStatus: string) {
    setList((prev) => prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o)));
    if (onUpdateStatus) onUpdateStatus(id, newStatus);
  }

  // Gates the body-level print portal below; document does not exist during SSR.
  const mounted = useIsMounted();

  const [filter, setFilter] = useState('all');
  const [custFilter, setCustFilter] = useState('all');
  const [shopFilter, setShopFilter] = useState(
    canSeeAllShops ? 'all' : accessibleShops[0]?.id || 'all',
  );
  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD);
  const [periodValue, setPeriodValue] = useState(() => currentMonthValue());
  const [rangeStart, setRangeStart] = useState(() => daysAgoValue(6));
  const [rangeEnd, setRangeEnd] = useState(() => todayValue());
  const [productFilter, setProductFilter] = useState('all');

  let visible = filter === 'all' ? list : list.filter((o) => o.status === filter);
  if (custFilter !== 'all') visible = visible.filter((o) => o.customerId === Number(custFilter));
  if (shopFilter !== 'all') visible = visible.filter((o) => o.shop === shopFilter);
  if (productFilter !== 'all')
    visible = visible.filter((o) => o.items.some((it) => it.name === productFilter));
  // The period bar was rendered but never consulted, so every PO showed
  // regardless of the selected window. POs are dated by `orders.created_at`.
  visible = visible.filter((o) =>
    isInPeriod(o.createdAt, period, periodValue, rangeStart, rangeEnd),
  );

  const productScoped = list.filter(
    (o) =>
      (shopFilter === 'all' || o.shop === shopFilter) &&
      (custFilter === 'all' || o.customerId === Number(custFilter)),
  );
  const productOptions = [
    ...new Set(productScoped.flatMap((o) => o.items.map((it) => it.name)).filter(Boolean)),
  ];
  const groupCustIds = [...new Set(visible.map((o) => o.customerId))];
  const exportGroups = groupCustIds
    .map((id) => ({ customerId: id, orders: visible.filter((o) => o.customerId === id) }))
    .sort((a, b) =>
      customerName(a.customerId, customers).localeCompare(
        customerName(b.customerId, customers),
        'th',
      ),
    );

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    if (exportGroups.length === 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'ขายส่ง');
    } else {
      exportGroups.forEach((g) => {
        const data = g.orders.map((o) => ({
          'เลขที่ PO': o.id,
          สาขา: shopName(o.shop, accessibleShops),
          สถานะ: o.status,
          ยอดสุทธิ: orderTotal(o),
          ชำระแล้ว: orderPaid(o),
          คงเหลือ: orderTotal(o) - orderPaid(o),
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const sheetName =
          customerName(g.customerId, customers)
            .replace(/[:\\/?*[\]]/g, '')
            .slice(0, 31) || 'ลูกค้า';
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
    }
    XLSX.writeFile(wb, `wholesale-orders-${exportStamp()}.xlsx`);
  }
  function exportPDF() {
    window.print();
  }

  return (
    <div className="fade-page">
      {stockWarning && (
        <p
          className="text-sm mb-4 px-4 py-3 rounded-xl flex items-start gap-2"
          style={{ background: '#FBF1DA', color: '#8A5A12' }}
          role="status"
        >
          <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
          <span>{stockWarning}</span>
        </p>
      )}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold">ขายส่ง</h1>
        {can('wholesale.createNew') && (
          <button
            onClick={() => router.push('/wholesale/new')}
            className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i>สร้าง PO ใหม่
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
      <div className="card p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex gap-2 flex-wrap">
            <select
              value={custFilter}
              aria-label="กรองตามลูกค้า"
              onChange={(e) => setCustFilter(e.target.value)}
              className="field text-sm px-3.5 py-2"
            >
              <option value="all">ทุกลูกค้า</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={productFilter}
              aria-label="กรองตามสินค้า"
              onChange={(e) => setProductFilter(e.target.value)}
              className="field text-sm px-3.5 py-2"
            >
              <option value="all">ทุกสินค้า</option>
              {productOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {can('wholesale.export') && (
            <div className="flex gap-2">
              <button
                onClick={exportExcel}
                className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5"
              >
                <i className="fa-solid fa-file-excel" style={{ color: '#1D6F42' }}></i>Excel
              </button>
              <button
                onClick={exportPDF}
                className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5"
              >
                <i className="fa-solid fa-file-pdf" style={{ color: '#C0392B' }}></i>PDF
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2 mb-5 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`text-xs px-3.5 py-1.5 rounded-full font-semibold ${
              filter === 'all' ? 'pill-active' : 'pill-inactive'
            }`}
          >
            ทั้งหมด {list.length}
          </button>
          {Object.keys(wsStatuses).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`text-xs px-3.5 py-1.5 rounded-full font-semibold ${
                filter === s ? 'pill-active' : 'pill-inactive'
              }`}
            >
              {s} {list.filter((o) => o.status === s).length}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          {(shopFilter === 'all'
            ? accessibleShops
            : accessibleShops.filter((s) => s.id === shopFilter)
          ).map((shop) => {
            const shopOrders = visible.filter((o) => o.shop === shop.id);
            if (shopOrders.length === 0) return null;
            return (
              <div key={shop.id}>
                {shopFilter === 'all' && (
                  <p
                    className="text-xs font-bold uppercase tracking-wide mt-3 mb-2 first:mt-0"
                    style={{ color: 'var(--primary)' }}
                  >
                    {shop.name} ({shopOrders.length})
                  </p>
                )}
                <div className="flex flex-col gap-2.5">
                  {shopOrders.map((o) => {
                    const st = wsStatuses[o.status] || {};
                    return (
                      <div
                        key={o.id}
                        onClick={() => router.push(`/wholesale/${o.id}`)}
                        className="group rounded-2xl flex items-stretch justify-between cursor-pointer gap-3 overflow-hidden hover:shadow-md transition"
                        style={{ border: '1px solid var(--line)' }}
                      >
                        <div
                          className="status-bar"
                          style={{ background: st.dot || '#B5AAA1' }}
                        ></div>
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between flex-1 min-w-0 gap-1.5 sm:gap-3 py-3 pr-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">
                              {customerName(o.customerId, customers)}
                            </p>
                            <p
                              className="text-xs mt-0.5 truncate"
                              style={{ color: 'var(--ink-soft)' }}
                            >
                              {o.id}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                              <select
                                value={o.status}
                                aria-label="สถานะของ PO"
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  updateOrderStatus(o.id, e.target.value);
                                }}
                                className="text-xs font-semibold px-2.5 py-1 rounded-full border-none cursor-pointer"
                                style={{
                                  background: st.bg || '#F1EDE7',
                                  color: st.text || '#6B5F55',
                                }}
                              >
                                {Object.keys(wsStatuses).map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                              <p className="text-xs mt-1.5" style={{ color: 'var(--ink-faint)' }}>
                                {fmt(orderTotal(o))} บาท
                              </p>
                              <p
                                className="text-xs mt-0.5"
                                style={{
                                  color: orderTotal(o) - orderPaid(o) <= 0 ? '#4C7A3E' : '#B23A48',
                                }}
                              >
                                {orderTotal(o) - orderPaid(o) <= 0
                                  ? 'ชำระครบแล้ว'
                                  : `ค้างชำระ ${fmt(orderTotal(o) - orderPaid(o))}`}
                              </p>
                            </div>
                            <span className="row-action pr-2" style={{ color: 'var(--primary)' }}>
                              <i className="fa-solid fa-chevron-right text-xs"></i>
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* `mounted`, not `typeof document`: the latter is false on the server but
          true on the first client render, so hydration finds a .print-area the
          server never sent and React logs a mismatch. */}
      {mounted &&
        createPortal(
          <div className="print-area">
            <h2>
              รายการขายส่ง
              {custFilter !== 'all' ? ' — ' + customerName(Number(custFilter), customers) : ''}
            </h2>
            <p>วันที่พิมพ์: {new Date().toLocaleDateString('th-TH')}</p>
            {exportGroups.map((g) => (
              <div key={g.customerId} style={{ marginBottom: 16 }}>
                <h3>{customerName(g.customerId, customers)}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>เลขที่ PO</th>
                      <th>สาขา</th>
                      <th>สถานะ</th>
                      <th style={{ textAlign: 'right' }}>ยอดสุทธิ</th>
                      <th style={{ textAlign: 'right' }}>ชำระแล้ว</th>
                      <th style={{ textAlign: 'right' }}>คงเหลือ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.orders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.id}</td>
                        <td>{shopName(o.shop, accessibleShops)}</td>
                        <td>{o.status}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(orderTotal(o))}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(orderPaid(o))}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(orderTotal(o) - orderPaid(o))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
