'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';

import { PeriodShopFilter } from '@/components/ui/PeriodShopFilter';
import { fmt, fmtQty, fmtThaiDate, fmtThaiDayString } from '@/lib/domain/format';
import {
  currentMonthValue,
  daysAgoValue,
  exportStamp,
  previousMonthValue,
  todayValue,
} from '@/lib/domain/now';
import { DEFAULT_PERIOD, isInPeriod, periodCaption } from '@/lib/domain/period';
import { amountTerms, matchesSearch } from '@/lib/domain/search';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { useSearchFromUrl } from '@/lib/hooks/useSearchFromUrl';
import {
  isOpenOrderStatus,
  orderCollectible,
  orderTotal,
  orderPaid,
  needsPriceApproval,
} from '@/lib/domain/orders';
import { deliveryProgress, hasUndelivered } from '@/lib/domain/deliveries';
import { isWsFlag, matchesWsFlag, WS_FLAG_LABELS, type WsFlag } from '@/lib/alerts/wholesale';

import { pendingCheques } from './cheques';
import {
  buildSalesReport,
  payInk,
  paymentStatusText,
  type SalesReportGroupBy,
} from './salesReport';
import { WholesaleReport } from './WholesaleReport';

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
 * `/wholesale/[id]` (with `/wholesale/new` for a fresh PO). สถานะเป็นป้าย
 * อ่านอย่างเดียว ตั้งแต่ 0081 ที่ฐานข้อมูลคำนวณมันจากกิจกรรมของ PO เอง
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
  stockWarning,
  initialStatus,
  initialApproval,
  initialFlag,
  initialSale,
  initialSearch,
}: {
  orders: WsOrder[];
  customers: WsCustomer[];
  /** Function form (prototype/tests) or serializable `caps` map (Server Component). */
  canDo?: (capabilityKey: string) => boolean;
  caps?: Record<string, boolean>;
  wsStatuses: WsStatusMap;
  accessibleShops: Shop[];
  canSeeAllShops?: boolean;
  /**
   * สินค้าที่ตัดสต็อกไม่สำเร็จตอนบันทึก PO ใบล่าสุด.
   *
   * Shown here because saving a PO redirects to this list. The save itself
   * succeeds either way — losing the sale over a stock lookup would be the
   * worse failure — so this is the only place the shop finds out.
   */
  stockWarning?: string;
  /**
   * สถานะที่เปิดมาจากลิงก์ — e.g. the dashboard’s ขอตัดหนี้สูญ counter.
   *
   * Clicking a number that says 3 and landing on a list of 40 leaves the
   * reader to find those three by eye, which is the job the number was
   * supposed to have done. It seeds the filter rather than locking it, so the
   * control still says what is being filtered and can still be cleared.
   */
  initialStatus?: string;
  /** `pending` opens filtered to POs waiting on ผู้บริหาร (ส่วนลด or ปรับราคา). */
  initialApproval?: string;
  /**
   * `?flag=` from an alert — cheques, bounced, returns, overdue, dueSoon. The
   * same predicates the alert counted with, so "3" opens three rows.
   */
  initialFlag?: string;
  /** `?sale=` — a rep's own alert opens on their own POs. */
  initialSale?: string;
  /** `?q=` — the header search, sent to this page. */
  initialSearch?: string;
}) {
  const can = canDo ?? ((k: string) => !!caps?.[k]);
  const router = useRouter();
  // ไม่มีอะไรแก้รายการในหน้านี้อีกแล้ว ตั้งแต่สถานะกลายเป็นป้ายอ่านอย่างเดียว (0081)
  const [list] = useState<WsOrder[]>(orders);

  // Gates the body-level print portal below; document does not exist during SSR.
  const mounted = useIsMounted();

  const [filter, setFilter] = useState(initialStatus || 'all');
  /*
    เปิดมาจากตัวเลขบนแดชบอร์ด.

    Those counters are "as of now" — they count every PO the caller can see,
    not only the ones inside the period this list happens to be showing. So
    while a drill-down is active the period filter stands aside, or the two
    disagree the moment a PO is older than this month: the dashboard says 2 and
    the list it opens shows 1, which is worse than not linking at all.

    The chip below says the list is in this mode, and clicking it puts the
    period filter back.
  */
  const [flag, setFlag] = useState<WsFlag | null>(isWsFlag(initialFlag) ? initialFlag : null);
  const [drillDown, setDrillDown] = useState<'approval' | 'status' | 'flag' | null>(
    initialApproval === 'pending'
      ? 'approval'
      : isWsFlag(initialFlag)
        ? 'flag'
        : initialStatus
          ? 'status'
          : null,
  );
  // The day the flags are judged against, read once rather than on every render.
  const [flagToday] = useState(() => todayValue());
  const approvalFilter = drillDown === 'approval';

  function clearDrillDown() {
    setDrillDown(null);
    setFlag(null);
    setFilter('all');
  }
  const [custFilter, setCustFilter] = useState('all');
  const [shopFilter, setShopFilter] = useState(
    canSeeAllShops ? 'all' : accessibleShops[0]?.id || 'all',
  );
  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD);
  const [periodValue, setPeriodValue] = useState(() => currentMonthValue());
  const [rangeStart, setRangeStart] = useState(() => daysAgoValue(6));
  const [rangeEnd, setRangeEnd] = useState(() => todayValue());
  const [productFilter, setProductFilter] = useState('all');
  /*
    รายงานเป็นอีกมุมของชุดข้อมูลเดียวกัน ไม่ใช่หน้าที่สอง (ร้านขอ 6 พ.ย. 2569).

    ตัวกรองทุกตัวด้านบนใช้ร่วมกัน — สาขา ช่วงเวลา ลูกค้า สินค้า เซลล์ สถานะ —
    ถ้าแยกเป็นหน้าของตัวเอง มันจะมีตัวกรองชุดที่สองที่ตั้งไม่ตรงกันได้ แล้ว
    ตัวเลขสองหน้าก็จะไม่ตรงกันโดยที่ไม่มีใครผิด
  */
  const [view, setView] = useState<'list' | 'report'>('list');
  const [groupBy, setGroupBy] = useState<SalesReportGroupBy>('customer');
  const [saleFilter, setSaleFilter] = useState(initialSale || 'all');
  const [search, setSearch] = useSearchFromUrl(initialSearch);

  /*
    ตัวเลขบนปุ่มสถานะ ต้องนับจากสิ่งที่กรองอยู่ (ร้านแจ้ง 21 ก.ย. 2569).

    The chips used to count every PO in every branch and every period, while
    the rows below were narrowed to the branch, period, customer, product and
    seller chosen above — so "รออนุมัติราคา 1" could open an empty list, the
    one PO being in another branch or another year. `scoped` is every filter
    EXCEPT the status one; the chips count it, so each number is exactly what
    pressing that chip shows. Book งาน's chips already work this way.
  */
  let scoped = list;
  // `needsPriceApproval` is the dashboard counter’s own predicate, imported
  // rather than restated: a count of 2 opening a list of 5 is worse than
  // having had no link at all.
  if (approvalFilter) scoped = scoped.filter(needsPriceApproval);
  if (drillDown === 'flag' && flag) {
    scoped = scoped.filter((o) => matchesWsFlag(o, flag, flagToday));
  }
  if (custFilter !== 'all') scoped = scoped.filter((o) => o.customerId === Number(custFilter));
  if (shopFilter !== 'all') scoped = scoped.filter((o) => o.shop === shopFilter);
  if (productFilter !== 'all')
    scoped = scoped.filter((o) => o.items.some((it) => it.name === productFilter));
  // `unassigned` is its own choice, not a gap in the list: POs raised before
  // the field existed have no seller, and "which of mine are missing a name"
  // is a question somebody has to be able to ask.
  if (saleFilter === 'unassigned') scoped = scoped.filter((o) => !o.salesBy);
  else if (saleFilter !== 'all') scoped = scoped.filter((o) => o.salesBy === saleFilter);
  /*
    ค้นหา — by anything on the PO: its number, the customer and their phone,
    the rep, what was sold, the notes, the total (lib/domain/search.ts). Across
    every date, like a drill-down: someone searching wants one PO, and a
    period that hides it makes the search look broken.
  */
  const searching = search.trim() !== '';
  if (searching) {
    scoped = scoped.filter((o) => {
      const customer = customers.find((c) => c.id === o.customerId);
      return matchesSearch(search, [
        o.id,
        customer?.name,
        customer?.phone,
        o.salesBy,
        o.status,
        o.note,
        o.customerNote,
        o.deliveryNote,
        o.items.map((it) => it.name),
        amountTerms(orderTotal(o)),
      ]);
    });
  }
  // The period bar was rendered but never consulted, so every PO showed
  // regardless of the selected window. POs are dated by `orders.created_at`.
  if (!drillDown && !searching) {
    scoped = scoped.filter((o) =>
      isInPeriod(o.createdAt, period, periodValue, rangeStart, rangeEnd),
    );
  }
  // ... and the status last, so the chips above can count `scoped`.
  /*
    ยังค้างส่ง — คำถามที่ห้าสถานะตอบไม่ได้ (0077).

    PO ที่ส่งไปแล้ว 80 จาก 200 ยังเป็น "รอจัดส่ง" เหมือน PO ที่ยังไม่ได้ส่งเลย
    และ PO ที่ส่งครบแล้วแต่ยังไม่ปิดก็อยู่ปนกันในนั้น คนที่ต้องไล่ว่าวันนี้ต้อง
    ส่งอะไรบ้าง จึงไม่มีทางกรองออกมาดูได้
  */
  const UNDELIVERED = 'ยังค้างส่ง';
  const owes = (o: WsOrder) =>
    isOpenOrderStatus(o.status) && hasUndelivered(o.items, o.deliveries ?? []);
  const visible =
    filter === 'all'
      ? scoped
      : filter === UNDELIVERED
        ? scoped.filter(owes)
        : scoped.filter((o) => o.status === filter);

  const productScoped = list.filter(
    (o) =>
      (shopFilter === 'all' || o.shop === shopFilter) &&
      (custFilter === 'all' || o.customerId === Number(custFilter)),
  );
  const productOptions = [
    ...new Set(productScoped.flatMap((o) => o.items.map((it) => it.name)).filter(Boolean)),
  ];
  /*
    พนักงานขายที่เลือกได้ และสรุปรายคน.

    Scoped to the branch in view, because two branches may each have a person
    of the same name and they are not the same person. Built from the POs on
    screen rather than from the staff list, so a seller who has left still
    appears against the POs they sold — their history did not leave with them.
  */
  const branchScoped = list.filter((o) => shopFilter === 'all' || o.shop === shopFilter);
  const sellerNames = [
    ...new Set(branchScoped.map((o) => o.salesBy).filter((n): n is string => !!n)),
  ].sort((a, b) => a.localeCompare(b, 'th'));
  const hasUnassigned = branchScoped.some((o) => !o.salesBy);

  /*
    Summed over what is ON SCREEN — the same period, branch and customer the
    reader is looking at. A per-person total computed over everything would
    disagree with the rows underneath it, and the rows are what people check.
  */
  const sellerTotals = sellerNames
    .map((name) => {
      const mine = visible.filter((o) => o.salesBy === name);
      return {
        name,
        count: mine.length,
        revenue: mine.reduce((n, o) => n + orderTotal(o), 0),
        // ค้างรับ = มูลค่าของที่ส่งไปแล้ว หักเงินที่รับมาแล้ว — กติกาเดียวกับ
        // การ์ดบนแดชบอร์ด และมาจากฟังก์ชันตัวเดียวกัน (0077)
        due: mine.reduce((n, o) => n + orderCollectible(o), 0),
      };
    })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.revenue - a.revenue);

  /*
    เช็คที่รอยืนยัน.

    Computed over the rows on screen, like every other summary here, so the
    period and branch the reader chose apply to it too. Rendered only when
    there is something in it: a branch paid in cash sees nothing new.
  */
  const cheques = pendingCheques(visible, todayValue());

  const groupCustIds = [...new Set(visible.map((o) => o.customerId))];
  const exportGroups = groupCustIds
    .map((id) => ({ customerId: id, orders: visible.filter((o) => o.customerId === id) }))
    .sort((a, b) =>
      customerName(a.customerId, customers).localeCompare(
        customerName(b.customerId, customers),
        'th',
      ),
    );

  const report = buildSalesReport(visible, { groupBy, customers, today: flagToday });
  const periodText = periodCaption(period, periodValue, rangeStart, rangeEnd, new Date()).replace(
    'สรุปข้อมูล',
    'ช่วงที่ดูอยู่:',
  );

  function exportExcel() {
    if (view === 'report') return exportReportExcel();
    const wb = XLSX.utils.book_new();
    if (exportGroups.length === 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'ขายส่ง');
    } else {
      exportGroups.forEach((g) => {
        const data = g.orders.map((o) => ({
          'เลขที่ PO': o.id,
          สาขา: shopName(o.shop, accessibleShops),
          // Exported even when blank, so a column that is empty for one branch
          // still lines up with the same column for another.
          พนักงานขาย: o.salesBy || '',
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
  /*
    ชีตเดียว ไม่ใช่ชีตละกลุ่ม.

    รายงานนี้ถูกเอาไปทำต่อ — กรองเอง รวมเอง ทำ pivot — ซึ่งทำกับตารางเดียวที่มี
    คอลัมน์กลุ่มอยู่ในแถวได้ แต่ทำกับยี่สิบชีตไม่ได้ (ไฟล์ของหน้ารายการแยกชีต
    ตามลูกค้า เพราะมันคือสำเนาของสิ่งที่เห็นบนจอ คนละงานกัน)
  */
  function exportReportExcel() {
    const groupHead = groupBy === 'customer' ? 'ลูกค้า' : 'พนักงานขาย';
    const otherHead = groupBy === 'customer' ? 'พนักงานขาย' : 'ลูกค้า';
    const data = report.groups.flatMap((g) =>
      g.rows.map((r) => ({
        [groupHead]: g.label,
        'เลขที่ PO': r.orderId,
        สาขา: shopName(r.shop, accessibleShops),
        วันที่เปิด: r.openedOn,
        วันที่ส่งของ: r.deliveredAt,
        [otherHead]: r.counterpart,
        // ชื่อคอลัมน์ตรงกับบนจอ ไม่งั้นไฟล์กับหน้าจอกลายเป็นสองภาษา
        สินค้า: r.items.map((it) => `${it.name} × ${fmtQty(it.qty)}`).join(', '),
        สถานะ: r.status,
        กำหนดชำระ: r.dueAt,
        เลยกำหนด: r.overdue ? 'ใช่' : '',
        ยอดสุทธิ: r.total,
        ชำระแล้ว: r.paid,
        รอยืนยันเงินเข้า: r.reported,
        ค้างชำระ: r.outstanding,
        คงค้างสุทธิ: r.netOutstanding,
      })),
    );
    /*
      การชำระเงินอยู่คนละชีต ไม่ใช่แถวเพิ่มในชีตแรก.

      PO ที่จ่ายมาสามงวดจะกลายเป็นสามแถว แล้วยอดสุทธิของมันจะถูกนับสามรอบใน
      pivot แรกที่ใครก็ตามลากขึ้นมา — ชีตแรกจึงต้องเป็นหนึ่งแถวต่อหนึ่งใบเสมอ
    */
    const payments = report.groups.flatMap((g) =>
      g.rows.flatMap((r) =>
        r.payments.map((p) => ({
          [groupHead]: g.label,
          'เลขที่ PO': r.orderId,
          สาขา: shopName(r.shop, accessibleShops),
          วันที่ชำระ: p.paidAt,
          วิธีการชำระ: p.method,
          จำนวนที่ชำระ: p.amount,
          สถานะ: paymentStatusText(p),
        })),
      ),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'สรุปการขาย');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payments), 'การชำระเงิน');
    XLSX.writeFile(wb, `wholesale-sales-report-${exportStamp()}.xlsx`);
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
        <div className="flex items-center gap-2">
          {/* Only roles that may restore see the bin at all. */}
          {can('wholesale.restore') && (
            <button
              onClick={() => router.push('/wholesale/trash')}
              className="btn-outline text-sm px-4 py-2 rounded-xl font-medium flex items-center gap-2"
            >
              <i className="fa-solid fa-trash-can"></i>ถังขยะ
            </button>
          )}
          {can('wholesale.createNew') && (
            <button
              onClick={() => router.push('/wholesale/new')}
              className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i>สร้าง PO ใหม่
            </button>
          )}
        </div>
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
            <div className="relative">
              <i
                className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: 'var(--ink-faint)' }}
              ></i>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหา เลขที่ PO / ลูกค้า / เบอร์โทร / เซลล์ / สินค้า"
                aria-label="ค้นหา PO"
                className="field text-sm pl-9 pr-3.5 py-2"
                style={{ minWidth: 240 }}
              />
            </div>
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
            {/* Only where somebody has been recorded — a branch that sells
                through whoever is on the counter gets no empty control. */}
            {(sellerNames.length > 0 || hasUnassigned) && (
              <select
                value={saleFilter}
                aria-label="กรองตามพนักงานขาย"
                onChange={(e) => setSaleFilter(e.target.value)}
                className="field text-sm px-3.5 py-2"
              >
                <option value="all">ทุกพนักงานขาย</option>
                {sellerNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
                {hasUnassigned && <option value="unassigned">ไม่ระบุ</option>}
              </select>
            )}
          </div>
          {/*
            สลับมุมมอง ไม่ใช่เปลี่ยนหน้า — ตัวกรองด้านบนยังเป็นชุดเดิมทั้งหมด
          */}
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex gap-1">
              {(
                [
                  ['list', 'รายการ'],
                  ['report', 'รายงานสรุป'],
                ] as const
              ).map(([key, text]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`text-xs px-3.5 py-2 rounded-lg font-semibold ${
                    view === key ? 'pill-active' : 'pill-inactive'
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
            {view === 'report' && (
              <select
                aria-label="จัดกลุ่มรายงานตาม"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as SalesReportGroupBy)}
                className="field text-xs px-2.5 py-2"
              >
                <option value="customer">แยกตามลูกค้า</option>
                <option value="sales">แยกตามพนักงานขาย</option>
              </select>
            )}
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
        {view === 'list' && (
          <div className="flex gap-2 mb-5 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`text-xs px-3.5 py-1.5 rounded-full font-semibold ${
                filter === 'all' ? 'pill-active' : 'pill-inactive'
              }`}
            >
              ทั้งหมด {scoped.length}
            </button>
            {Object.keys(wsStatuses).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`text-xs px-3.5 py-1.5 rounded-full font-semibold ${
                  filter === s ? 'pill-active' : 'pill-inactive'
                }`}
              >
                {s} {scoped.filter((o) => o.status === s).length}
              </button>
            ))}
            {/* ขึ้นเฉพาะเมื่อมีของค้างส่งจริง ชิปที่กดแล้วได้ศูนย์ไม่ได้ช่วยใคร */}
            {scoped.some(owes) && (
              <button
                onClick={() => setFilter(UNDELIVERED)}
                className={`text-xs px-3.5 py-1.5 rounded-full font-semibold ${
                  filter === UNDELIVERED ? 'pill-active' : 'pill-inactive'
                }`}
              >
                <i className="fa-solid fa-truck-fast mr-1.5"></i>
                {UNDELIVERED} {scoped.filter(owes).length}
              </button>
            )}
          </div>
        )}
        {/*
          บอกว่ากำลังกรองอะไรอยู่ และกดออกได้.

          A list that silently shows 2 of 40 rows because of something the
          previous screen decided is a list the reader cannot trust. The chip
          is the whole explanation, and clicking it is the way out.
        */}
        {drillDown && (
          <button
            onClick={clearDrillDown}
            className="text-xs px-3.5 py-1.5 rounded-full font-semibold mb-5 flex items-center gap-2"
            style={{ background: '#FBF1DA', color: '#8A5A12' }}
          >
            <i className="fa-solid fa-filter"></i>
            กำลังกรอง:{' '}
            {approvalFilter
              ? 'รอผู้บริหารอนุมัติ'
              : drillDown === 'flag' && flag
                ? WS_FLAG_LABELS[flag]
                : filter}{' '}
            ({visible.length}) · ทุกช่วงเวลา<i className="fa-solid fa-xmark"></i>
          </button>
        )}
        {cheques.rows.length > 0 && (
          <div className="card p-4 mb-4">
            <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
              <p className="text-xs font-semibold" style={{ color: 'var(--ink-soft)' }}>
                <i className="fa-solid fa-money-check mr-1.5"></i>เช็ค/เงินที่แจ้งแล้ว
                รอยืนยันเงินเข้า
              </p>
              <span className="text-sm font-semibold">{fmt(cheques.total)}</span>
            </div>
            {/* The number that means somebody has to pick up the phone. */}
            {cheques.overdueTotal > 0 && (
              <p className="text-xs mb-2" style={{ color: '#B23A48' }}>
                เลยวันที่หน้าเช็คแล้วยังไม่ยืนยัน {fmt(cheques.overdueTotal)}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {cheques.rows.map((c, idx) => (
                <div
                  key={`${c.orderId}-${idx}`}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="truncate">
                    {customerName(c.customerId, customers)}
                    <span className="text-xs ml-1.5" style={{ color: 'var(--ink-faint)' }}>
                      {c.orderId}
                      {c.chequeNo ? ` · เช็ค ${c.chequeNo}` : ''}
                      {c.chequeBank ? ` ${c.chequeBank}` : ''}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-3 flex-shrink-0">
                    <span
                      className="text-xs"
                      style={{ color: c.overdue ? '#B23A48' : 'var(--ink-soft)' }}
                    >
                      {c.due ? fmtThaiDayString(c.due) : 'ไม่ระบุวันที่'}
                    </span>
                    <span className="font-semibold">{fmt(c.amount)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/*
          สรุปรายพนักงานขาย.

          Above the rows and summed over exactly what is below them, so the two
          always agree. Sorted by ยอดขาย because "who is ahead" is the question
          it exists to answer.
        */}
        {sellerTotals.length > 0 && (
          <div className="card p-4 mb-4">
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ink-soft)' }}>
              <i className="fa-solid fa-user-tie mr-1.5"></i>สรุปรายพนักงานขาย
            </p>
            <div className="flex flex-col gap-1.5">
              {sellerTotals.map((t) => (
                <div key={t.name} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {t.name}
                    <span className="text-xs ml-1.5" style={{ color: 'var(--ink-faint)' }}>
                      {t.count} PO
                    </span>
                  </span>
                  <span className="flex items-baseline gap-3 flex-shrink-0">
                    <span className="font-semibold">{fmt(t.revenue)}</span>
                    {/* ค้างรับ beside the sales figure, because a big number
                        with a big balance behind it is a different result. */}
                    {/*
                      บอกว่าเป็นยอดของที่ส่งแล้ว ไม่ใช่ยอดทั้งบิล.

                      ตัวเลขนี้คิดจากของที่ออกไปจริง (0077) ส่วน "ค้างชำระ" ที่
                      แต่ละแถว PO คือยอดคงเหลือของบิลทั้งใบ — คนละคำถามกัน และ
                      ถ้าไม่บอกไว้ คนที่บวกแถวเองจะได้ไม่เท่ากับสรุปแล้วงงว่า
                      ตัวไหนผิด
                    */}
                    {t.due > 0 && (
                      <span className="text-xs" style={{ color: '#B23A48' }}>
                        ค้างรับ (ส่งของแล้ว) {fmt(t.due)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/*
          ไม่มีอะไรให้แสดง ต้องบอกว่าทำไม (ร้านแจ้ง 2 ต.ค. 2569).

          ตัวกรองช่วงเวลาตั้งต้นเป็นเดือนปัจจุบัน เปิดโมดูลวันที่ 1 ของเดือนจึง
          เจอหน้าที่จบลงตรงแถวชิปสถานะ ไม่มีรายการ ไม่มีคำอธิบาย ซึ่งอ่านได้
          อย่างเดียวว่าระบบพัง — ทั้งที่ของอยู่ครบในเดือนก่อน

          ปุ่มที่ให้มาคือทางออกจากตัวกรองที่กำลังซ่อนของอยู่ ไม่ใช่แค่คำบอกเล่า
        */}
        {visible.length === 0 && (
          <div className="card p-6 text-center">
            <p className="text-sm font-semibold">
              {list.length === 0 ? 'ยังไม่มี PO ขายส่ง' : 'ไม่มี PO ที่ตรงกับที่กรองอยู่'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>
              {list.length === 0
                ? 'กด “สร้าง PO ใหม่” เพื่อเปิดใบแรก'
                : periodCaption(period, periodValue, rangeStart, rangeEnd, new Date()).replace(
                    'สรุปข้อมูล',
                    'ช่วงที่ดูอยู่:',
                  )}
            </p>
            {list.length > 0 && (
              <div className="flex gap-2 justify-center mt-3 flex-wrap">
                {filter !== 'all' && (
                  <button
                    onClick={() => setFilter('all')}
                    className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
                  >
                    ล้างตัวกรองสถานะ
                  </button>
                )}
                <button
                  onClick={() => {
                    setPeriod('month');
                    setPeriodValue(previousMonthValue(periodValue));
                  }}
                  className="btn-outline text-xs px-3 py-2 rounded-lg font-medium"
                >
                  <i className="fa-solid fa-chevron-left mr-1.5"></i>ดูเดือนก่อนหน้า
                </button>
              </div>
            )}
          </div>
        )}
        {view === 'report' && (
          <WholesaleReport
            report={report}
            groupBy={groupBy}
            shops={
              shopFilter === 'all'
                ? accessibleShops
                : accessibleShops.filter((s) => s.id === shopFilter)
            }
            caption={periodText}
          />
        )}
        {view === 'list' && (
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
                                {/* Only where the branch records sellers at all,
                                  so branches that do not are unchanged. */}
                                {(sellerNames.length > 0 || hasUnassigned) && (
                                  <span style={{ color: 'var(--ink-faint)' }}>
                                    {' · '}
                                    <i className="fa-solid fa-user-tie mr-1"></i>
                                    {o.salesBy || 'ไม่ระบุ'}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <div className="text-right">
                                {/*
                                สถานะเป็นป้าย ไม่ใช่ช่องให้เลือกอีกต่อไป (0081).

                                ระบบคำนวณจากสิ่งที่เกิดขึ้นกับ PO จริง ๆ —
                                อนุมัติราคา ส่งของ รับเงิน — ช่องที่เลือกทับได้
                                จึงให้ได้แค่สถานะที่ขัดกับความจริงจนกว่าจะมี
                                กิจกรรมถัดไปมาเขียนทับอยู่ดี

                                สองการตัดสินใจที่ยังเป็นของคน (อนุมัติราคา,
                                ตัดหนี้สูญ) มีปุ่มของตัวเองอยู่ในหน้า PO
                              */}
                                <span
                                  className="text-xs font-semibold px-2.5 py-1 rounded-full inline-block"
                                  style={{
                                    background: st.bg || '#F1EDE7',
                                    color: st.text || '#6B5F55',
                                  }}
                                >
                                  {o.status}
                                </span>
                                <p className="text-xs mt-1.5" style={{ color: 'var(--ink-faint)' }}>
                                  {fmt(orderTotal(o))} บาท
                                </p>
                                <p
                                  className="text-xs mt-0.5"
                                  style={{
                                    color:
                                      orderTotal(o) - orderPaid(o) <= 0 ? '#4C7A3E' : '#B23A48',
                                  }}
                                >
                                  {orderTotal(o) - orderPaid(o) <= 0
                                    ? 'ชำระครบแล้ว'
                                    : `ค้างชำระ ${fmt(orderTotal(o) - orderPaid(o))}`}
                                </p>
                                {/*
                                ส่งไปแล้วเท่าไหร่ (0077).

                                PO ที่ส่งไปแล้วบางส่วนเคยหน้าตาเหมือน PO ที่ยัง
                                ไม่ได้ส่งเลยทุกประการ — สถานะเดียวกัน ยอดเดียวกัน
                                คนที่ต้องไล่ว่าวันนี้ต้องส่งอะไร จึงต้องเปิดทีละใบ

                                ขึ้นเฉพาะใบที่ส่งไปแล้วบางส่วน: ใบที่ยังไม่ส่งเลย
                                หรือส่งครบแล้ว สถานะบอกครบอยู่แล้ว
                              */}
                                {(() => {
                                  const p = deliveryProgress(o.items, o.deliveries ?? []);
                                  const sent = p.reduce((n, x) => n + x.sent, 0);
                                  const ordered = p.reduce((n, x) => n + x.ordered, 0);
                                  if (sent <= 0 || sent >= ordered) return null;
                                  return (
                                    <p className="text-xs mt-0.5" style={{ color: '#8A5A12' }}>
                                      <i className="fa-solid fa-truck-fast mr-1"></i>
                                      ส่งแล้ว {sent}/{ordered}
                                    </p>
                                  );
                                })()}
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
        )}
      </div>
      {/* `mounted`, not `typeof document`: the latter is false on the server but
          true on the first client render, so hydration finds a .print-area the
          server never sent and React logs a mismatch. */}
      {mounted &&
        createPortal(
          // `sales-report` เปิดทั้งกระดาษแนวนอนและสีให้รายงาน — มุมมองรายการยัง
          // เป็น A4 แนวตั้งขาวดำเหมือนเดิม เพราะมันเป็นคนละเอกสาร
          <div className={view === 'report' ? 'print-area sales-report' : 'print-area'}>
            <h2>
              {view === 'report' ? 'รายงานสรุปการขาย — ขายส่ง' : 'รายการขายส่ง'}
              {custFilter !== 'all' ? ' — ' + customerName(Number(custFilter), customers) : ''}
            </h2>
            <p>วันที่พิมพ์: {fmtThaiDate(new Date())}</p>
            {/*
              กระดาษต้องเป็นสิ่งเดียวกับที่อยู่บนจอ.

              ปุ่ม PDF คือ window.print() ของมุมมองที่เปิดอยู่ ถ้ากระดาษพิมพ์
              รายการออกมาเสมอ คนที่กดพิมพ์ตอนดูรายงานจะได้เอกสารที่ไม่ใช่สิ่งที่
              เขากำลังอ่าน แล้วก็ไม่มีทางพิมพ์รายงานได้เลย
            */}
            {view === 'report' && (
              <>
                <p>{periodText}</p>
                {/*
                  สามหัวข้อบนกระดาษ ตรงกับบนจอ (ร้านขอ 7 พ.ย. 2569).

                  การสั่งซื้อ · การชำระเงิน · จำนวนเงินคงค้างชำระ — สามเรื่องนี้
                  ถูกอ่านคนละเวลาและคนละคน การเรียงเป็นคอลัมน์ยาวแถวเดียวบังคับ
                  ให้ทุกคนอ่านทุกช่องเพื่อหาช่องของตัวเอง
                */}
                {report.groups.map((g) => (
                  <div key={g.key} style={{ marginBottom: 16 }}>
                    <h3 className="report-group">
                      {g.label} — {g.orders} ใบ · ค้างชำระ {fmt(g.outstanding)} จากยอดขาย{' '}
                      {fmt(g.total)}
                    </h3>
                    <table className="report-table">
                      <thead>
                        <tr className="section-head">
                          <th className="sec-order" colSpan={4}>
                            1. การสั่งซื้อ
                          </th>
                          <th className="sec-pay" colSpan={4}>
                            2. การชำระเงิน
                          </th>
                          <th className="sec-bal" colSpan={2}>
                            3. จำนวนเงินคงค้างชำระ
                          </th>
                        </tr>
                        <tr>
                          <th className="nw sec-order">เลขที่ PO</th>
                          <th className="nw sec-order">วันที่ส่งของ</th>
                          <th className="sec-order">สินค้า</th>
                          <th className="nw sec-order" style={{ textAlign: 'right' }}>
                            จำนวนเงิน
                          </th>
                          <th className="nw sec-pay">วันที่ชำระ</th>
                          <th className="sec-pay">วิธีการชำระ</th>
                          <th className="nw sec-pay" style={{ textAlign: 'right' }}>
                            จำนวนที่ชำระ
                          </th>
                          <th className="nw sec-pay">สถานะ</th>
                          <th className="nw sec-bal" style={{ textAlign: 'right' }}>
                            รอยืนยันเงินเข้า
                          </th>
                          <th className="nw sec-bal" style={{ textAlign: 'right' }}>
                            คงค้างสุทธิ
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.flatMap((r) => {
                          const span = Math.max(1, r.payments.length);
                          const payCells = (p: (typeof r.payments)[number]) => (
                            <>
                              <td className="nw">{p.paidAt ? fmtThaiDayString(p.paidAt) : '—'}</td>
                              <td>{p.method}</td>
                              <td className="nw" style={{ textAlign: 'right' }}>
                                {fmt(p.amount)}
                              </td>
                              {/* เขียว = เงินเข้าแล้ว · เหลือง = ยังรอ ·
                                  แดง = เช็คเด้ง ชุดเดียวกับบนจอ */}
                              <td className={'nw ' + payInk(p)}>{paymentStatusText(p)}</td>
                            </>
                          );
                          return [
                            <tr key={r.orderId}>
                              <td className="nw sec-order" rowSpan={span}>
                                {r.orderId}
                                {accessibleShops.length > 1 && (
                                  <span style={{ display: 'block' }}>
                                    {shopName(r.shop, accessibleShops)}
                                  </span>
                                )}
                                {/* อีกมิติหนึ่งเกาะมากับเลขที่ PO — ร้านไม่ได้ขอ
                                    เป็นคอลัมน์ แต่ทิ้งไปแปลว่ารายงานที่จัดกลุ่ม
                                    ตามลูกค้า ตอบไม่ได้ว่าใบไหนเซลล์คนไหนขาย */}
                                <span style={{ display: 'block' }}>
                                  {groupBy === 'customer' ? 'พนักงานขาย' : 'ลูกค้า'}:{' '}
                                  {r.counterpart}
                                </span>
                              </td>
                              <td className="nw sec-order" rowSpan={span}>
                                {r.deliveredAt ? fmtThaiDayString(r.deliveredAt) : 'ยังไม่ส่ง'}
                              </td>
                              <td className="sec-order" rowSpan={span}>
                                {r.items.length === 0
                                  ? '—'
                                  : r.items.map((it, i) => (
                                      <span key={i} style={{ display: 'block' }}>
                                        {it.name} × {fmtQty(it.qty)}
                                      </span>
                                    ))}
                              </td>
                              <td
                                className="nw sec-order"
                                rowSpan={span}
                                style={{ textAlign: 'right' }}
                              >
                                {fmt(r.total)}
                              </td>
                              {r.payments.length === 0 ? (
                                <td className="sec-pay" colSpan={4}>
                                  ยังไม่มีการชำระเงิน
                                </td>
                              ) : (
                                payCells(r.payments[0])
                              )}
                              <td
                                className={'nw sec-bal' + (r.reported > 0.005 ? ' ink-wait' : '')}
                                rowSpan={span}
                                style={{ textAlign: 'right' }}
                              >
                                {r.reported > 0.005 ? fmt(r.reported) : '—'}
                              </td>
                              <td
                                className={
                                  'nw sec-bal' + (r.netOutstanding > 0.005 ? ' ink-due' : '')
                                }
                                rowSpan={span}
                                style={{ textAlign: 'right' }}
                              >
                                {fmt(r.netOutstanding)}
                                {r.outstanding > 0.005 && r.dueAt && (
                                  <span
                                    className={r.overdue ? 'ink-due' : ''}
                                    style={{ display: 'block' }}
                                  >
                                    กำหนด {fmtThaiDayString(r.dueAt)}
                                    {r.overdue ? ' (เลยกำหนด)' : ''}
                                  </span>
                                )}
                              </td>
                            </tr>,
                            ...r.payments
                              .slice(1)
                              .map((p, i) => <tr key={`${r.orderId}-p${i}`}>{payCells(p)}</tr>),
                          ];
                        })}
                        {/* แถวรวมของกลุ่ม — ตัวเลขทุกตัวมีคำกำกับว่าคือยอดอะไร
                            และยังอยู่ในแถบสีของหัวข้อตัวเอง แถบสีที่ขาดตรงแถว
                            สุดท้าย ทำให้ยอดรวมดูเหมือนหลุดออกมาจากกลุ่ม */}
                        <tr>
                          <th className="sec-order" colSpan={3} style={{ textAlign: 'left' }}>
                            รวม {g.orders} ใบ
                          </th>
                          <th className="nw sec-order" style={{ textAlign: 'right' }}>
                            {fmt(g.total)}
                          </th>
                          <th className="sec-pay" colSpan={2} style={{ textAlign: 'right' }}>
                            ชำระแล้ว
                          </th>
                          <th className="nw sec-pay" style={{ textAlign: 'right' }}>
                            {fmt(g.paid)}
                          </th>
                          <th className="sec-pay"></th>
                          <th className="nw sec-bal" style={{ textAlign: 'right' }}>
                            {fmt(g.reported)}
                          </th>
                          <th className="nw sec-bal" style={{ textAlign: 'right' }}>
                            {fmt(g.netOutstanding)}
                          </th>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}
                {/*
                  ยอดรวมทั้งรายงาน — ตัวเลขเปล่า ๆ ใต้ตารางยาว บังคับให้คนนับ
                  คอลัมน์ขึ้นไปหาหัวตาราง ซึ่งอยู่คนละหน้ากระดาษไปแล้ว
                  (ร้านแจ้ง 7 พ.ย. 2569) ตารางนี้จึงพกชื่อยอดมาเอง
                */}
                <table className="report-table">
                  <tbody>
                    <tr>
                      <th style={{ textAlign: 'left' }}>รวมทั้งรายงาน ({report.orders} ใบ)</th>
                      {/* ชิดขวาเท่ากับตัวเลขที่อยู่ใต้มัน — ป้ายที่ลอยอยู่คนละ
                          ฝั่งของช่อง ไม่ได้บอกว่ากำกับตัวเลขตัวไหน */}
                      <th className="nw" style={{ textAlign: 'right' }}>
                        ยอดขายรวม
                      </th>
                      <th className="nw" style={{ textAlign: 'right' }}>
                        ชำระแล้ว
                      </th>
                      <th className="nw" style={{ textAlign: 'right' }}>
                        รอยืนยันเงินเข้า
                      </th>
                      <th className="nw" style={{ textAlign: 'right' }}>
                        ค้างชำระ
                      </th>
                      <th className="nw" style={{ textAlign: 'right' }}>
                        ค้างสุทธิ
                      </th>
                    </tr>
                    <tr>
                      <td></td>
                      <td className="nw" style={{ textAlign: 'right' }}>
                        {fmt(report.total)}
                      </td>
                      <td className="nw" style={{ textAlign: 'right' }}>
                        {fmt(report.paid)}
                      </td>
                      <td className="nw" style={{ textAlign: 'right' }}>
                        {fmt(report.reported)}
                      </td>
                      <td className="nw" style={{ textAlign: 'right' }}>
                        {fmt(report.outstanding)}
                      </td>
                      <td className="nw" style={{ textAlign: 'right' }}>
                        {fmt(report.netOutstanding)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {report.overdueOutstanding > 0 && (
                  <p>ในยอดค้างชำระนี้ เลยกำหนดชำระแล้ว {fmt(report.overdueOutstanding)}</p>
                )}
              </>
            )}
            {view === 'list' &&
              exportGroups.map((g) => (
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
                          <td style={{ textAlign: 'right' }}>
                            {fmt(orderTotal(o) - orderPaid(o))}
                          </td>
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
