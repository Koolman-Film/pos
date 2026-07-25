'use client';

import { useState, useTransition } from 'react';
import { createPortal } from 'react-dom';

import { fmt, fmtThaiDate } from '@/lib/domain/format';
import { currentMonthValue, daysAgoValue, todayValue } from '@/lib/domain/now';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { StatusPill } from '@/components/ui/StatusPill';
import type { Shop } from '@/components/ui/PeriodShopFilter';

/**
 * Ported from reference/v0.4/finnix-film.html:3528-3901 (the Accounting module),
 * covering both the expenses list and the petty-cash sections.
 *
 * Divergences from the prototype, all forced by the port's architecture — they
 * mirror the CommissionModule precedent:
 *   - The prototype held `expenses`/`pettyCash` in client state and mutated the
 *     arrays directly. Here the expense/petty-cash rows arrive as props from the
 *     Server Component page (the source of truth is the `expenses` and
 *     `petty_cash` tables); every mutation calls a Server Action and the page
 *     re-renders via `revalidatePath`. Only the *config* lists (`expenseCategories`
 *     / `paymentSources`, edited inline through `ManagedDropdown`) are kept as
 *     in-session local state — persisting those is the Permissions module's job.
 *   - The gate: the plan's test passes `canDo` as a function, but a Server
 *     Component cannot hand a closure to a Client Component (only serializable
 *     props cross the boundary — see the Sidebar/Commission precedent). So the
 *     page passes the pre-evaluated `canAddExpense` / `canTopupCash` / `canExport`
 *     booleans; `canDo` remains accepted for the test. Effective gate is
 *     `canAddExpense ?? canDo?.('accounting.addExpense') ?? false`, etc.
 *   - Excel export runs through a Server Action (`exportAction`) that re-checks
 *     `accounting.export` server-side (correction C2) and builds the workbook
 *     with `xlsx` on the server, returning base64 the client downloads. PDF
 *     export stays `window.print()` (pure client DOM, nothing to authorize).
 *   - StatusPill receives the prototype's KEYED colour map (correction C1).
 *   - `attachments` are display-only in the add form: the `expenses` table has no
 *     attachments column, so they are not persisted (flagged for the plan owner).
 */

/** An expense row flattened for display (prototype shape). */
export type ExpenseView = {
  id: number;
  shop: string;
  desc: string;
  category: string;
  source: string;
  amount: number;
  status: string; // 'จ่ายแล้ว' | 'รอจ่าย'
  date?: string;
  dateObj?: Date | string | null;
  due?: string;
  attachments?: string[];
};

/** A petty-cash entry flattened for display (prototype shape). */
export type PettyCashView = {
  id: number;
  shop: string;
  type: string; // 'เติมเงิน'
  amount: number;
  date?: string;
  note?: string;
};

/** Payload handed to the add-expense Server Action. `shop` is already a concrete id. */
export type NewExpenseInput = {
  shop: string;
  source: string;
  status: string;
  lines: { desc: string; category: string; amount: number }[];
};

/** Payload handed to the top-up Server Action. */
export type TopupInput = { shop: string; amount: number; note: string };

/** Payload handed to the edit Server Action. */
export type UpdateExpenseInput = {
  id: number;
  desc: string;
  category: string;
  source: string;
  amount: number;
  status: string;
  paidAt: string | null;
};

/** Payload handed to the Excel-export Server Action. */
export type ExportPayload = {
  fileNameBase: string;
  groups: { sheetName: string; rows: Record<string, string | number>[] }[];
};

type ExpenseLine = { desc: string; category: string; amount: number | string };

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

function isInPeriod(
  dateObj: Date | string | null | undefined,
  per: string,
  perVal: string,
  rStart: string,
  rEnd: string
): boolean {
  if (!dateObj) return true;
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (per === 'today') return d.getTime() === today.getTime();
  if (per === 'month') {
    const [y, m] = (perVal || '').split('-').map(Number);
    return y && m ? d.getFullYear() === y && d.getMonth() === m - 1 : true;
  }
  if (per === 'year') {
    const rawY = Number(perVal);
    const y = rawY && rawY > 2400 ? rawY - 543 : today.getFullYear();
    return d.getFullYear() === y;
  }
  if (per === 'range') {
    const s = rStart ? new Date(rStart) : null;
    const e = rEnd ? new Date(rEnd) : null;
    if (s) s.setHours(0, 0, 0, 0);
    if (e) e.setHours(23, 59, 59, 999);
    return (!s || d >= s) && (!e || d <= e);
  }
  return true;
}

export function AccountingModule({
  expenses,
  pettyCash,
  expenseCategories: expenseCategoriesProp = [],
  paymentSources: paymentSourcesProp = [],
  canDo,
  canAddExpense,
  canTopupCash,
  canExport,
  addExpenseAction,
  topupCashAction,
  updateExpenseAction,
  deleteExpenseAction,
  exportAction,
  accessibleShops = [],
  canSeeAllShops = true,
}: {
  expenses: ExpenseView[];
  pettyCash: PettyCashView[];
  expenseCategories?: string[];
  paymentSources?: string[];
  canDo?: (capabilityKey: string) => boolean;
  canAddExpense?: boolean;
  canTopupCash?: boolean;
  canExport?: boolean;
  addExpenseAction?: (input: NewExpenseInput) => Promise<void>;
  topupCashAction?: (input: TopupInput) => Promise<void>;
  updateExpenseAction?: (input: UpdateExpenseInput) => Promise<void>;
  deleteExpenseAction?: (id: number) => Promise<void>;
  exportAction?: (payload: ExportPayload) => Promise<{ fileName: string; base64: string } | null>;
  accessibleShops?: Shop[];
  canSeeAllShops?: boolean;
}) {
  const allowAdd = canAddExpense ?? canDo?.('accounting.addExpense') ?? false;
  const allowTopup = canTopupCash ?? canDo?.('accounting.topupCash') ?? false;
  const allowExport = canExport ?? canDo?.('accounting.export') ?? false;

  const firstShop = accessibleShops[0]?.id || '';
  const shopName = (id: string) => accessibleShops.find((s) => s.id === id)?.name || id;

  const [expenseCategories, setExpenseCategories] = useState<string[]>(expenseCategoriesProp);
  const [paymentSources, setPaymentSources] = useState<string[]>(paymentSourcesProp);
  const [, startTransition] = useTransition();

  const [showAdd, setShowAdd] = useState(false);
  const [showTopup, setShowTopup] = useState(false);
  const [shopFilter, setShopFilter] = useState(accessibleShops[0]?.id || 'all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [period, setPeriod] = useState('today');
  const [periodValue, setPeriodValue] = useState(() => currentMonthValue());
  const [rangeStart, setRangeStart] = useState(() => daysAgoValue(6));
  const [rangeEnd, setRangeEnd] = useState(() => todayValue());

  const emptyEx = () => ({
    shop: firstShop,
    source: '',
    status: 'จ่ายแล้ว',
    attachments: [] as string[],
    lines: [{ desc: '', category: '', amount: 0 }] as ExpenseLine[],
  });
  const emptyTopup = () => ({ shop: firstShop, amount: 0 as number | string, note: '' });
  const [ex, setEx] = useState(emptyEx);
  const [topup, setTopup] = useState(emptyTopup);
  const isExDirty = showAdd && JSON.stringify(ex) !== JSON.stringify(emptyEx());
  const isTopupDirty = showTopup && JSON.stringify(topup) !== JSON.stringify(emptyTopup());
  useUnsavedChangesGuard(
    isExDirty || isTopupDirty,
    'มีข้อมูลค่าใช้จ่าย/เติมเงินสดย่อยที่ยังไม่ได้บันทึก'
  );

  function inSelectedPeriod(dateObj: Date | string | null | undefined) {
    return isInPeriod(dateObj, period, periodValue, rangeStart, rangeEnd);
  }

  const [showCashDetail, setShowCashDetail] = useState(false);
  const [cashPeriod, setCashPeriod] = useState('today');
  const [cashPeriodValue, setCashPeriodValue] = useState(() => currentMonthValue());
  const [cashRangeStart, setCashRangeStart] = useState(() => daysAgoValue(6));
  const [cashRangeEnd, setCashRangeEnd] = useState(() => todayValue());
  function inCashPeriod(dateObj: Date | string | null | undefined) {
    return isInPeriod(dateObj, cashPeriod, cashPeriodValue, cashRangeStart, cashRangeEnd);
  }

  const shopExpensesAllCat = expenses.filter((e) => shopFilter === 'all' || e.shop === shopFilter);
  const shopExpenses = shopExpensesAllCat.filter(
    (e) =>
      (categoryFilter === 'all' || e.category === categoryFilter) &&
      (statusFilter === 'all' || e.status === statusFilter) &&
      inSelectedPeriod(e.dateObj)
  );
  const paidTotal = shopExpenses
    .filter((e) => e.status === 'จ่ายแล้ว')
    .reduce((s, e) => s + Number(e.amount), 0);
  const pendingTotal = shopExpenses
    .filter((e) => e.status === 'รอจ่าย')
    .reduce((s, e) => s + Number(e.amount), 0);
  const cashTopups = pettyCash
    .filter((p) => (shopFilter === 'all' || p.shop === shopFilter) && p.type === 'เติมเงิน')
    .reduce((s, p) => s + Number(p.amount), 0);
  const cashSpent = shopExpensesAllCat
    .filter((e) => e.source === 'เงินสดย่อย' && e.status === 'จ่ายแล้ว')
    .reduce((s, e) => s + Number(e.amount), 0);
  const cashBalance = cashTopups - cashSpent;
  const cashDetailItems = shopExpensesAllCat
    .filter((e) => e.source === 'เงินสดย่อย' && e.status === 'จ่ายแล้ว' && inCashPeriod(e.dateObj))
    .sort(
      (a, b) =>
        (b.dateObj ? new Date(b.dateObj).getTime() : 0) -
        (a.dateObj ? new Date(a.dateObj).getTime() : 0)
    );
  const cashDetailTotal = cashDetailItems.reduce((s, e) => s + Number(e.amount), 0);
  const exportShopIds =
    shopFilter === 'all'
      ? accessibleShops.map((s) => s.id).filter((id) => shopExpenses.some((e) => e.shop === id))
      : [shopFilter];
  const exportGroups = exportShopIds.map((id) => ({
    shopId: id,
    items: shopExpenses
      .filter((e) => e.shop === id)
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category, 'th') ||
          (a.date || '').localeCompare(b.date || '', 'th') ||
          a.desc.localeCompare(b.desc, 'th')
      ),
  }));

  async function exportExcel() {
    if (!exportAction) return;
    const payload: ExportPayload = {
      fileNameBase: `expenses-${shopFilter}`,
      groups: exportGroups.map((g) => ({
        sheetName: shopName(g.shopId),
        rows: g.items.map((e) => ({
          วันที่: e.date ?? '',
          กลุ่มค่าใช้จ่าย: e.category,
          รายละเอียด: e.desc,
          จ่ายจาก: e.source,
          สถานะ: e.status,
          ยอดเงิน: e.amount,
        })),
      })),
    };
    const res = await exportAction(payload);
    if (res) downloadBase64(res.base64, res.fileName);
  }
  function exportPDF() {
    window.print();
  }

  function updateExLine(idx: number, field: keyof ExpenseLine, val: string) {
    const lines = [...ex.lines];
    lines[idx] = { ...lines[idx], [field]: val };
    setEx({ ...ex, lines });
  }
  function addExLine() {
    setEx({ ...ex, lines: [...ex.lines, { desc: '', category: '', amount: 0 }] });
  }
  function removeExLine(idx: number) {
    setEx({ ...ex, lines: ex.lines.filter((_, i) => i !== idx) });
  }
  const exLinesTotal = ex.lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  function addExpense() {
    if (!addExpenseAction) return;
    const targetShop = shopFilter === 'all' ? ex.shop : shopFilter;
    const lines = ex.lines
      .filter((l) => l.desc.trim() || l.category || Number(l.amount) > 0)
      .map((l) => ({ desc: l.desc, category: l.category, amount: Number(l.amount || 0) }));
    if (lines.length === 0) return;
    startTransition(async () => {
      await addExpenseAction({ shop: targetShop, source: ex.source, status: ex.status, lines });
      setShowAdd(false);
      setEx(emptyEx());
    });
  }

  function addTopup() {
    if (!topupCashAction) return;
    const targetShop = shopFilter === 'all' ? topup.shop : shopFilter;
    startTransition(async () => {
      await topupCashAction({
        shop: targetShop,
        amount: Number(topup.amount),
        note: topup.note || 'เติมเงินสดย่อย',
      });
      setShowTopup(false);
      setTopup(emptyTopup());
    });
  }

  const [editingExId, setEditingExId] = useState<number | null>(null);
  const [editExForm, setEditExForm] = useState<ExpenseView | null>(null);
  function startEditExpense(e: ExpenseView) {
    setEditingExId(e.id);
    setEditExForm({ ...e });
  }
  function saveEditExpense() {
    if (!editExForm) return;
    if (!updateExpenseAction) {
      setEditingExId(null);
      setEditExForm(null);
      return;
    }
    const form = editExForm;
    startTransition(async () => {
      await updateExpenseAction({
        id: form.id,
        desc: form.desc,
        category: form.category,
        source: form.source,
        amount: Number(form.amount),
        status: form.status,
        paidAt: form.dateObj ? new Date(form.dateObj).toISOString() : null,
      });
      setEditingExId(null);
      setEditExForm(null);
    });
  }
  function deleteExpense(id: number) {
    if (!deleteExpenseAction) return;
    if (window.confirm('ยืนยันการลบรายการค่าใช้จ่ายนี้?')) {
      startTransition(async () => {
        await deleteExpenseAction(id);
      });
    }
  }

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <h1 className="text-xl font-bold">บัญชี / ค่าใช้จ่าย</h1>
        <div className="flex gap-2 flex-wrap">
          {allowTopup && (
            <button
              onClick={() => {
                setShowTopup(!showTopup);
                setShowAdd(false);
              }}
              className={`text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2 ${
                showTopup ? 'btn-primary' : 'btn-outline'
              }`}
            >
              <i className="fa-solid fa-wallet"></i>เติมเงินสดย่อย
            </button>
          )}
          {allowAdd && (
            <button
              onClick={() => {
                setShowAdd(!showAdd);
                setShowTopup(false);
              }}
              className={`text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2 ${
                showAdd ? 'btn-primary' : 'btn-outline'
              }`}
            >
              <i className="fa-solid fa-plus"></i>เพิ่มรายการ
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end mb-4 flex-wrap gap-2">
        <select
          value={shopFilter}
          onChange={(e) => setShopFilter(e.target.value)}
          className="field text-sm px-3 py-2"
        >
          {canSeeAllShops && <option value="all">ทุกสาขา</option>}
          {accessibleShops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="field text-sm px-3 py-2"
        >
          <option value="all">ทุกกลุ่มค่าใช้จ่าย</option>
          {expenseCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="field text-sm px-3 py-2"
        >
          <option value="all">ทุกสถานะ</option>
          <option value="จ่ายแล้ว">จ่ายแล้ว</option>
          <option value="รอจ่าย">รอจ่าย</option>
        </select>
        {allowExport && (
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
      <div className="card p-3 mb-5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl overflow-hidden" style={{ border: '1.5px solid var(--line)' }}>
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
            className="field text-sm px-3 py-2"
          />
        )}
        {period === 'year' && (
          <select
            value={periodValue}
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
            <i className="fa-solid fa-arrow-right text-xs" style={{ color: 'var(--ink-faint)' }}></i>
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="field text-sm px-3 py-2"
            />
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="card p-4">
          <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            จ่ายแล้ว
          </p>
          <p className="text-xl font-bold mt-1">{fmt(paidTotal)}</p>
        </div>
        <div className="card p-4" style={{ background: '#FBF1DA', borderColor: 'transparent' }}>
          <p className="text-xs" style={{ color: '#8A5A12' }}>
            รอจ่าย
          </p>
          <p className="text-xl font-bold mt-1" style={{ color: '#8A5A12' }}>
            {fmt(pendingTotal)}
          </p>
        </div>
        <div
          onClick={() => setShowCashDetail(!showCashDetail)}
          className="card p-4 cursor-pointer card-hover"
          style={{ background: 'var(--primary-soft)', borderColor: 'transparent' }}
        >
          <div className="flex items-start justify-between">
            <p className="text-xs" style={{ color: 'var(--primary)' }}>
              เงินสดย่อยคงเหลือ
            </p>
            <i
              className={`fa-solid fa-chevron-${showCashDetail ? 'up' : 'down'} text-xs`}
              style={{ color: 'var(--primary)', opacity: 0.6 }}
            ></i>
          </div>
          <p className="text-xl font-bold mt-1" style={{ color: 'var(--primary)' }}>
            {fmt(cashBalance)}
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--primary)', opacity: 0.7 }}>
            เติมแล้ว {fmt(cashTopups)} &minus; จ่ายไป {fmt(cashSpent)}
          </p>
        </div>
      </div>
      {showCashDetail && (
        <div className="card p-5 mb-4 fade-page">
          <p className="text-sm font-semibold mb-3">
            รายการที่จ่ายจากเงินสดย่อย{shopFilter !== 'all' ? ' · ' + shopName(shopFilter) : ''}
          </p>
          <div
            className="card p-3 mb-4 flex flex-wrap items-center gap-2"
            style={{ background: 'var(--paper)' }}
          >
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
                  onClick={() => setCashPeriod(key)}
                  className="text-xs px-3 py-2 font-semibold"
                  style={{
                    background: cashPeriod === key ? 'var(--primary)' : 'transparent',
                    color: cashPeriod === key ? '#fff' : 'var(--ink-soft)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {cashPeriod === 'today' && (
              <span
                className="text-xs px-3 py-2 rounded-lg font-medium"
                style={{ background: 'var(--surface)', color: 'var(--ink-soft)' }}
              >
                <i className="fa-regular fa-calendar mr-1.5"></i>
                {new Date().toLocaleDateString('th-TH', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            )}
            {cashPeriod === 'month' && (
              <input
                type="month"
                value={cashPeriodValue}
                onChange={(e) => setCashPeriodValue(e.target.value)}
                className="field text-sm px-3 py-2"
              />
            )}
            {cashPeriod === 'year' && (
              <select
                value={cashPeriodValue}
                onChange={(e) => setCashPeriodValue(e.target.value)}
                className="field text-sm px-3 py-2"
              >
                {[2569, 2568, 2567].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            )}
            {cashPeriod === 'range' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={cashRangeStart}
                  onChange={(e) => setCashRangeStart(e.target.value)}
                  className="field text-sm px-3 py-2"
                />
                <i
                  className="fa-solid fa-arrow-right text-xs"
                  style={{ color: 'var(--ink-faint)' }}
                ></i>
                <input
                  type="date"
                  value={cashRangeEnd}
                  onChange={(e) => setCashRangeEnd(e.target.value)}
                  className="field text-sm px-3 py-2"
                />
              </div>
            )}
          </div>
          {cashDetailItems.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--ink-faint)' }}>
              ไม่มีรายการที่จ่ายจากเงินสดย่อยในช่วงเวลานี้
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {cashDetailItems.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between py-2"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{e.desc}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                      {e.category} &middot; {e.date}
                    </p>
                  </div>
                  <span className="text-sm font-semibold flex-shrink-0">{fmt(e.amount)}</span>
                </div>
              ))}
              <div
                className="flex justify-between pt-2 text-sm font-bold"
                style={{ borderTop: '1.5px solid var(--line-strong)' }}
              >
                <span>ยอดรวม</span>
                <span>{fmt(cashDetailTotal)}</span>
              </div>
            </div>
          )}
        </div>
      )}
      {showTopup && (
        <div className="card p-5 mb-4 fade-page">
          <p className="text-sm font-semibold mb-3">
            เติมเงินสดย่อย{shopFilter !== 'all' ? ' · ' + shopName(shopFilter) : ''}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {shopFilter === 'all' && (
              <div className="sm:col-span-2">
                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  สาขา
                </label>
                <select
                  value={topup.shop}
                  onChange={(e) => setTopup({ ...topup, shop: e.target.value })}
                  className="field w-full text-sm px-3 py-2"
                >
                  {accessibleShops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                จำนวนเงินที่เติม
              </label>
              <input
                type="number"
                value={topup.amount}
                onChange={(e) => setTopup({ ...topup, amount: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                หมายเหตุ
              </label>
              <input
                value={topup.note}
                onChange={(e) => setTopup({ ...topup, note: e.target.value })}
                placeholder="เช่น อนุมัติโดยแอดมิน"
                className="field w-full text-sm px-3 py-2"
              />
            </div>
          </div>
          <button
            onClick={addTopup}
            className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold"
          >
            บันทึกการเติมเงิน
          </button>
        </div>
      )}
      {showAdd && (
        <div className="card p-5 mb-4 fade-page">
          <p className="text-sm font-semibold mb-3">
            เพิ่มรายการค่าใช้จ่าย{shopFilter !== 'all' ? ' · ' + shopName(shopFilter) : ''}
          </p>
          {shopFilter === 'all' && (
            <div className="mb-3">
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                สาขา
              </label>
              <select
                value={ex.shop}
                onChange={(e) => setEx({ ...ex, shop: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              >
                {accessibleShops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-3 mb-3">
            {ex.lines.map((l, idx) => (
              <div key={idx} className="rounded-xl p-3" style={{ border: '1px solid var(--line)' }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold" style={{ color: 'var(--primary)' }}>
                    รายการที่ {idx + 1}
                  </p>
                  {ex.lines.length > 1 && (
                    <button
                      onClick={() => removeExLine(idx)}
                      className="text-xs px-2 py-1 rounded-lg flex items-center gap-1"
                      style={{ color: '#B23A48' }}
                    >
                      <i className="fa-solid fa-trash"></i>ลบ
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="sm:col-span-2">
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      รายละเอียด
                    </label>
                    <input
                      value={l.desc}
                      onChange={(e) => updateExLine(idx, 'desc', e.target.value)}
                      className="field w-full text-sm px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      กลุ่มค่าใช้จ่าย
                    </label>
                    <ManagedDropdown
                      value={l.category}
                      onChange={(v) => updateExLine(idx, 'category', v)}
                      options={expenseCategories}
                      setOptions={setExpenseCategories}
                      placeholder="เลือกกลุ่มค่าใช้จ่าย..."
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      ยอดเงิน
                    </label>
                    <input
                      type="number"
                      value={l.amount}
                      onChange={(e) => updateExLine(idx, 'amount', e.target.value)}
                      className="field w-full text-sm px-3 py-2"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={addExLine}
            className="btn-outline w-full text-sm rounded-xl py-2 mb-3 flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-plus"></i>เพิ่มอีกรายการ
          </button>
          <div className="flex justify-between text-sm mb-3 px-1">
            <span style={{ color: 'var(--ink-soft)' }}>
              ยอดรวมทั้งหมด ({ex.lines.length} รายการ)
            </span>
            <span className="font-semibold" style={{ color: 'var(--primary)' }}>
              {fmt(exLinesTotal)}
            </span>
          </div>
          <p className="text-xs mb-2" style={{ color: 'var(--ink-faint)' }}>
            <i className="fa-solid fa-circle-info mr-1"></i>ทุกรายการด้านบนใช้ &quot;จ่ายจาก&quot;
            &quot;สถานะ&quot; และไฟล์แนบเดียวกันตามที่กรอกด้านล่าง
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                จ่ายจาก
              </label>
              <ManagedDropdown
                value={ex.source}
                onChange={(v) => setEx({ ...ex, source: v })}
                options={paymentSources}
                setOptions={setPaymentSources}
                placeholder="เลือกแหล่งจ่ายเงิน..."
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                สถานะ
              </label>
              <select
                value={ex.status}
                onChange={(e) => setEx({ ...ex, status: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              >
                <option>จ่ายแล้ว</option>
                <option>รอจ่าย</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                แนบไฟล์หลักฐานการจ่าย (ใบเสร็จ/สลิป, เลือกได้หลายไฟล์)
              </label>
              <div className="field flex items-center gap-2 px-3 py-2 mt-1">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length)
                      setEx({
                        ...ex,
                        attachments: [...(ex.attachments || []), ...files.map((f) => f.name)],
                      });
                    e.target.value = '';
                  }}
                  className="text-xs flex-1"
                />
              </div>
              {(ex.attachments || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {ex.attachments.map((fn, fi) => (
                    <span
                      key={fi}
                      className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
                      style={{ background: 'var(--paper)', color: 'var(--primary)' }}
                    >
                      <i className="fa-solid fa-paperclip"></i>
                      {fn}
                      <i
                        className="fa-solid fa-xmark cursor-pointer"
                        style={{ color: '#B23A48' }}
                        onClick={() =>
                          setEx({
                            ...ex,
                            attachments: ex.attachments.filter((_, fi2) => fi2 !== fi),
                          })
                        }
                      ></i>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={addExpense}
            className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold"
          >
            บันทึกข้อมูล
            {ex.lines.length > 1 ? ` (${ex.lines.length} รายการ, รวม ${fmt(exLinesTotal)})` : ''}
          </button>
        </div>
      )}
      <div className="card p-5 sm:p-6">
        <p className="text-sm font-semibold mb-3">รายการค่าใช้จ่าย</p>
        <div className="flex flex-col gap-2">
          {shopExpenses.map((e) =>
            editingExId === e.id && editExForm ? (
              <div
                key={e.id}
                className="rounded-2xl p-3.5 mb-2"
                style={{ border: '1px solid var(--primary)', background: 'var(--primary-soft)' }}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <input
                    value={editExForm.desc}
                    onChange={(e2) => setEditExForm({ ...editExForm, desc: e2.target.value })}
                    placeholder="รายละเอียด"
                    className="field text-sm px-2.5 py-1.5 sm:col-span-2"
                  />
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      กลุ่มค่าใช้จ่าย
                    </label>
                    <ManagedDropdown
                      value={editExForm.category}
                      onChange={(v) => setEditExForm({ ...editExForm, category: v })}
                      options={expenseCategories}
                      setOptions={setExpenseCategories}
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      จ่ายจาก
                    </label>
                    <ManagedDropdown
                      value={editExForm.source}
                      onChange={(v) => setEditExForm({ ...editExForm, source: v })}
                      options={paymentSources}
                      setOptions={setPaymentSources}
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      ยอดเงิน
                    </label>
                    <input
                      type="number"
                      value={editExForm.amount}
                      onChange={(e2) =>
                        setEditExForm({ ...editExForm, amount: Number(e2.target.value) })
                      }
                      className="field text-sm px-2.5 py-1.5 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      สถานะ
                    </label>
                    <select
                      value={editExForm.status}
                      onChange={(e2) => setEditExForm({ ...editExForm, status: e2.target.value })}
                      className="field text-sm px-2.5 py-1.5 w-full"
                    >
                      <option>จ่ายแล้ว</option>
                      <option>รอจ่าย</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      วันที่
                    </label>
                    <input
                      type="date"
                      value={
                        editExForm.dateObj
                          ? new Date(editExForm.dateObj).toISOString().slice(0, 10)
                          : ''
                      }
                      onChange={(e2) => {
                        const d = e2.target.value ? new Date(e2.target.value + 'T00:00:00') : null;
                        setEditExForm({
                          ...editExForm,
                          dateObj: d,
                          date: d ? fmtThaiDate(d) : '-',
                        });
                      }}
                      className="field text-sm px-2.5 py-1.5 w-full"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingExId(null);
                      setEditExForm(null);
                    }}
                    className="btn-outline flex-1 rounded-lg py-1.5 text-xs"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={saveEditExpense}
                    className="btn-primary flex-1 rounded-lg py-1.5 text-xs font-semibold"
                  >
                    บันทึก
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={e.id}
                className="group flex items-center justify-between py-2.5"
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-2">
                    {e.desc}
                    {e.attachments && e.attachments.length > 0 && (
                      <i
                        className="fa-solid fa-paperclip text-xs"
                        style={{ color: 'var(--ink-faint)' }}
                        title={e.attachments.join(', ')}
                      ></i>
                    )}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                    {e.category} &middot; {e.source} &middot; {e.date}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 flex items-center gap-2">
                  <span className="text-sm font-semibold">{fmt(e.amount)}</span>
                  <StatusPill
                    label={e.status}
                    colorMap={{
                      จ่ายแล้ว: { bg: '#E6EFDC', text: '#4C7A3E', dot: '#6BA24F' },
                      รอจ่าย: { bg: '#FBF1DA', text: '#8A5A12', dot: '#E8B23D' },
                    }}
                  />
                  {allowAdd && (
                    <div className="flex items-center gap-1 row-action">
                      <button
                        onClick={() => startEditExpense(e)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                        style={{ background: 'var(--paper)', color: 'var(--primary)' }}
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                      <button
                        onClick={() => deleteExpense(e.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                        style={{ background: 'var(--paper)', color: '#B23A48' }}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="print-area">
            <h2>
              รายการค่าใช้จ่าย{shopFilter !== 'all' ? ' · ' + shopName(shopFilter) : ''}
              {categoryFilter !== 'all' ? ' · ' + categoryFilter : ''}
              {period === 'today'
                ? ' · ' + fmtThaiDate(new Date())
                : period === 'month'
                  ? ' · เดือน ' + periodValue
                  : period === 'year'
                    ? ' · ปี ' + periodValue
                    : period === 'range'
                      ? ' · ' + rangeStart + ' ถึง ' + rangeEnd
                      : ''}
            </h2>
            <p>วันที่พิมพ์: {new Date().toLocaleDateString('th-TH')}</p>
            {exportGroups.map((g) => (
              <div key={g.shopId} style={{ marginBottom: 16 }}>
                <h3>{shopName(g.shopId)}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>วันที่</th>
                      <th>กลุ่มค่าใช้จ่าย</th>
                      <th>รายละเอียด</th>
                      <th>จ่ายจาก</th>
                      <th>สถานะ</th>
                      <th style={{ textAlign: 'right' }}>ยอดเงิน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((e) => (
                      <tr key={e.id}>
                        <td>{e.date}</td>
                        <td>{e.category}</td>
                        <td>{e.desc}</td>
                        <td>{e.source}</td>
                        <td>{e.status}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p style={{ textAlign: 'right' }}>
              <strong>
                ยอดรวม: {fmt(shopExpenses.reduce((s, e) => s + Number(e.amount), 0))} บาท
              </strong>
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}
