'use client';

import { useState, useTransition } from 'react';

import { uploadAttachments } from '@/lib/storage/attachments';
import { createPortal, flushSync } from 'react-dom';
import { downloadBase64 } from '@/lib/browser/download';

import { fmt, fmtThaiDate, fmtThaiDateLong, fmtThaiMonthYear } from '@/lib/domain/format';
import { currentMonthValue, dateInputValue, daysAgoValue, todayValue } from '@/lib/domain/now';
import { DEFAULT_PERIOD, isInPeriod } from '@/lib/domain/period';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { FilePreview } from '@/components/ui/FilePreview';
import { OptionManageProvider } from '@/components/ui/optionManage';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { LEGACY_METHOD_SUFFIX } from '@/lib/domain/payAccount';
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
 *     re-renders via `revalidatePath`. The *config* lists (`expenseCategories` /
 *     `paymentSources`, edited inline through `ManagedDropdown`) are optimistic
 *     in local state and written through `updateOptionListAction`. They used to
 *     be local ONLY — an entry added here was gone on the next load.
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
 *   - `attachments` are real files: the browser uploads each receipt straight to
 *     the private `expense-attachments` bucket and the Server Action registers
 *     the paths in `expense_attachments` (migration 0014). They were previously
 *     display-only — the table had no column and pressing บันทึก dropped them,
 *     which the trial run reported as "ไม่แสดงไฟล์แนบ".
 */

/** An expense row flattened for display (prototype shape). */
export type ExpenseView = {
  id: number;
  /**
   * เลขที่เอกสาร — POS-LPG-6908001, issued by the database on insert
   * (migration 0019) and never recomputed. Blank only for a row created before
   * that migration ran.
   */
  docNo?: string;
  shop: string;
  desc: string;
  category: string;
  source: string;
  amount: number;
  status: string; // 'จ่ายแล้ว' | 'รอจ่าย'
  /**
   * เงินรอรับคืน Finnix — the branch paid a bill that belongs to another
   * Finnix shop (migration 0032). The cash did leave, so the row stays in
   * ค่าใช้จ่าย and in the petty-cash balance; it is simply not this branch’s
   * cost and is kept out of the expense totals.
   */
  paidForFinnix?: boolean;
  date?: string;
  dateObj?: Date | string | null;
  due?: string;
  /** กำหนดจ่าย as a date, so a รอจ่าย row can have it edited. */
  dueObj?: Date | string | null;
  attachments?: ExpenseAttachment[];
};

/** A petty-cash entry flattened for display (prototype shape). */
export type PettyCashView = {
  id: number;
  shop: string;
  type: string; // 'เติมเงิน'
  amount: number;
  date?: string;
  /** The date itself, so a top-up can be windowed and sorted like a spend. */
  dateObj?: Date | string | null;
  note?: string;
};

/** A receipt already uploaded to the private bucket, ready to be registered. */
export type UploadedAttachment = {
  /** Key within the `expense-attachments` bucket. */
  path: string;
  /** The original filename, kept for display (storage keys are ASCII-safe). */
  fileName: string;
  mimeType: string;
  size: number;
};

/** An attachment as it comes back for display. */
export type ExpenseAttachment = {
  id: number;
  fileName: string;
  path: string;
  /** Drives the preview: an image renders inline, anything else in a frame. */
  mimeType?: string;
};

/** Payload handed to the add-expense Server Action. `shop` is already a concrete id. */
export type NewExpenseInput = {
  shop: string;
  source: string;
  status: string;
  /**
   * `YYYY-MM-DD`, local. Becomes `paid_at` for a จ่ายแล้ว expense and `due_at`
   * for a รอจ่าย one — the two dates the module already displays.
   */
  date?: string;
  /** จ่ายแทน Finnix — one answer for the whole document (migration 0032). */
  paidForFinnix?: boolean;
  lines: { desc: string; category: string; amount: number }[];
  /** Receipts shared by every line in this submission, as the panel states. */
  attachments?: UploadedAttachment[];
};

/** Payload handed to the top-up Server Action. */
export type TopupInput = {
  shop: string;
  amount: number;
  note: string;
  /**
   * แหล่งเงินที่เอาเงินออกมาเติม. `null` is นอกระบบ — a deliberate answer the
   * person picks, never a default standing in for "nobody said" (0056).
   */
  fromAccountId: number | null;
};

/** A money account, as the top-up form needs it to ask where cash came from. */
export type TopupAccount = { id: number; shop: string; name: string; kind: string };

/** The select value that means นอกระบบ. */
const OUTSIDE = 'outside';

/** Payload handed to the edit Server Action. */
export type UpdateExpenseInput = {
  id: number;
  /** สาขา — editable, because a row entered against the wrong branch is a
   *  correction the shop has to be able to make itself. */
  shop: string;
  desc: string;
  category: string;
  source: string;
  amount: number;
  status: string;
  /** วันที่จ่าย — set for a จ่ายแล้ว row, null for a รอจ่าย one. */
  paidAt: string | null;
  /** กำหนดจ่าย — the mirror of `paidAt`; exactly one of the two is set. */
  dueAt: string | null;
  paidForFinnix?: boolean;
};

/** Payload handed to the Excel-export Server Action. */
export type ExportPayload = {
  fileNameBase: string;
  groups: { sheetName: string; rows: Record<string, string | number>[] }[];
};

type ExpenseLine = { desc: string; category: string; amount: number | string };

export function AccountingModule({
  expenses,
  pettyCash,
  expenseCategories: expenseCategoriesProp = [],
  canDo,
  canAddExpense,
  canTopupCash,
  canExport,
  canManageOptions,
  addExpenseAction,
  topupCashAction,
  updateExpenseAction,
  deleteExpenseAction,
  exportAction,
  attachmentUrlAction,
  attachAction,
  detachAction,
  updateOptionListAction,
  accessibleShops = [],
  canSeeAllShops = true,
  moneyAccounts = [],
}: {
  expenses: ExpenseView[];
  pettyCash: PettyCashView[];
  expenseCategories?: string[];
  paymentSources?: string[];
  canDo?: (capabilityKey: string) => boolean;
  canAddExpense?: boolean;
  canTopupCash?: boolean;
  canExport?: boolean;
  /** `options.manage` — may this caller add/remove หมวดค่าใช้จ่าย / จ่ายจาก entries. */
  canManageOptions?: boolean;
  addExpenseAction?: (input: NewExpenseInput) => Promise<void>;
  topupCashAction?: (input: TopupInput) => Promise<{ ok: boolean; error?: string } | void>;
  updateExpenseAction?: (input: UpdateExpenseInput) => Promise<void>;
  deleteExpenseAction?: (id: number) => Promise<void>;
  exportAction?: (payload: ExportPayload) => Promise<{ fileName: string; base64: string } | null>;
  /** Mints a short-lived signed URL for a stored receipt. */
  attachmentUrlAction?: (path: string) => Promise<{ url?: string; error?: string }>;
  /** Registers newly uploaded receipts on an existing expense (edit row). */
  attachAction?: (
    expenseId: number,
    attachments: UploadedAttachment[],
  ) => Promise<{ ok: boolean; error?: string }>;
  detachAction?: (attachmentId: number) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Persists หมวดค่าใช้จ่าย / จ่ายจาก. Without it the pickers only edit React
   * state, so an entry added here was gone on the next load.
   */
  updateOptionListAction?: (
    listKey: string,
    values: string[],
  ) => Promise<{ ok: boolean; error?: string }>;
  accessibleShops?: Shop[];
  canSeeAllShops?: boolean;
  /** Every money account the caller can see — the top-up form lists its branch's. */
  moneyAccounts?: TopupAccount[];
}) {
  const allowAdd = canAddExpense ?? canDo?.('accounting.addExpense') ?? false;
  const allowTopup = canTopupCash ?? canDo?.('accounting.topupCash') ?? false;
  const allowExport = canExport ?? canDo?.('accounting.export') ?? false;
  const allowManageOptions = canManageOptions ?? canDo?.('options.manage') ?? false;

  const firstShop = accessibleShops[0]?.id || '';
  const shopName = (id: string) => accessibleShops.find((s) => s.id === id)?.name || id;

  // Optimistic locally, persisted through the shared option-list action. Both
  // pickers used to hand ManagedDropdown a bare setState, so "+ เพิ่มตัวเลือกใหม่"
  // added an entry that survived exactly until the page reloaded.
  const [expenseCategories, setExpenseCategoriesState] = useState<string[]>(expenseCategoriesProp);
  function setExpenseCategories(next: string[]) {
    setExpenseCategoriesState(next);
    void updateOptionListAction?.('expense_categories', next);
  }
  /*
    จ่ายจาก = the branch's แหล่งเงิน (migration 0064, ร้านขอ 22 ก.ย. 2569).

    It used to be a free-text list shared by every branch, which reached a
    balance only when a word happened to match an account's name — the
    dashboard was short by every expense paid "from" a label nobody claimed.
    Every account counts here, เงินสดย่อย and บัตรเครดิตบริษัท included: those
    are exactly what bills get paid from. A label saved before stays shown on
    the expense it belongs to.
  */
  const sourcesFor = (shop: string, current = '') => {
    const names = moneyAccounts.filter((a) => a.shop === shop).map((a) => a.name);
    return current && !names.includes(current) ? [current, ...names] : names;
  };
  const isAccountName = (shop: string, name: string) =>
    moneyAccounts.some((a) => a.shop === shop && a.name === name);
  const [isPending, startTransition] = useTransition();

  // Gates the body-level print portal below; document does not exist during SSR.
  const mounted = useIsMounted();

  const [showAdd, setShowAdd] = useState(false);
  const [showTopup, setShowTopup] = useState(false);
  const [shopFilter, setShopFilter] = useState(accessibleShops[0]?.id || 'all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD);
  const [periodValue, setPeriodValue] = useState(() => currentMonthValue());
  const [rangeStart, setRangeStart] = useState(() => daysAgoValue(6));
  const [rangeEnd, setRangeEnd] = useState(() => todayValue());

  const emptyEx = () => ({
    shop: firstShop,
    source: '',
    status: 'จ่ายแล้ว',
    // Today, editable. Expenses are routinely entered a day or two after the
    // money moved, and the action used to stamp `now()` with no way to say
    // otherwise — so a Monday entry for Friday's fuel landed on Monday.
    date: todayValue(),
    // ค่าใช้จ่ายของสาขาเป็นค่าตั้งต้น — จ่ายแทนเป็นข้อยกเว้น จึงต้องตั้งใจเลือก
    paidForFinnix: false,
    lines: [{ desc: '', category: '', amount: 0 }] as ExpenseLine[],
  });
  const emptyTopup = () => ({
    shop: firstShop,
    amount: 0 as number | string,
    note: '',
    from: '',
  });
  const [ex, setEx] = useState(emptyEx);
  // The chosen receipts, held outside `ex` because a File does not survive the
  // JSON round-trip the dirty check uses — it would stringify to `{}` and every
  // attachment would look identical to the pristine form.
  const [exFiles, setExFiles] = useState<File[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    fileName: string;
    mimeType: string;
  } | null>(null);
  const [topup, setTopup] = useState(emptyTopup);
  const [topupError, setTopupError] = useState<string | null>(null);
  /*
    เงินมาจากไหน.

    Every account of the branch being topped up except the petty-cash account
    itself, plus นอกระบบ. A branch with no petty-cash account cannot be topped
    up at all — there is nowhere in the register for the money to arrive — so
    the form says that instead of failing on save.
  */
  const topupShop = shopFilter === 'all' ? topup.shop : shopFilter;
  const topupSources = moneyAccounts.filter((a) => a.shop === topupShop && a.kind !== 'petty');
  const topupHasPetty = moneyAccounts.some((a) => a.shop === topupShop && a.kind === 'petty');
  const isExDirty =
    showAdd && (JSON.stringify(ex) !== JSON.stringify(emptyEx()) || exFiles.length > 0);
  const isTopupDirty = showTopup && JSON.stringify(topup) !== JSON.stringify(emptyTopup());
  useUnsavedChangesGuard(
    isExDirty || isTopupDirty,
    'มีข้อมูลค่าใช้จ่าย/เติมเงินสดย่อยที่ยังไม่ได้บันทึก',
  );

  function inSelectedPeriod(dateObj: Date | string | null | undefined) {
    return isInPeriod(dateObj, period, periodValue, rangeStart, rangeEnd);
  }

  const [showCashDetail, setShowCashDetail] = useState(false);
  /**
   * เงินรอรับคืน Finnix ยุบไว้ก่อน (ร้านขอ 19 ก.ย. 2569).
   *
   * The table under it lists every bill the branch fronted for another Finnix
   * shop, and it sat open above รายการค่าใช้จ่าย — a screen and a half of rows
   * to scroll past before reaching the list the page is actually for. The
   * headline (how many, how much) is what gets read daily; the rows are for the
   * day somebody settles up.
   */
  const [showFinnixDetail, setShowFinnixDetail] = useState(false);
  const [cashPeriod, setCashPeriod] = useState<string>(DEFAULT_PERIOD);
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
      inSelectedPeriod(e.dateObj),
  );
  /*
    เงินรอรับคืน Finnix is split off before the totals (migration 0032).

    The cash left the drawer, so these rows stay in the list and in the
    petty-cash balance — but they are another Finnix shop's costs, and adding
    them to ค่าใช้จ่าย would understate the branch's profit by exactly the
    amount it is waiting to get back.
  */
  const ownExpenses = shopExpenses.filter((e) => !e.paidForFinnix);
  const finnixExpenses = shopExpenses.filter((e) => e.paidForFinnix);
  const paidTotal = ownExpenses
    .filter((e) => e.status === 'จ่ายแล้ว')
    .reduce((s, e) => s + Number(e.amount), 0);
  const pendingTotal = ownExpenses
    .filter((e) => e.status === 'รอจ่าย')
    .reduce((s, e) => s + Number(e.amount), 0);
  const finnixTotal = finnixExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const cashTopups = pettyCash
    .filter((p) => (shopFilter === 'all' || p.shop === shopFilter) && p.type === 'เติมเงิน')
    .reduce((s, p) => s + Number(p.amount), 0);
  /*
    เงินสดย่อย ตามบัญชีจริงของสาขา (0064). จ่ายจาก now holds the petty-cash
    ACCOUNT's name, and a branch may have renamed it; matching only the literal
    word would drop every spend recorded after the rename from this balance.
    The old word still counts, for everything saved before.
  */
  const pettyNames = new Map<string, Set<string>>();
  for (const a of moneyAccounts) {
    if (a.kind !== 'petty') continue;
    if (!pettyNames.has(a.shop)) pettyNames.set(a.shop, new Set());
    pettyNames.get(a.shop)!.add(a.name);
  }
  const isPettySource = (e: { shop: string; source: string }) =>
    e.source === 'เงินสดย่อย' || !!pettyNames.get(e.shop)?.has(e.source);
  const cashSpent = shopExpensesAllCat
    .filter((e) => isPettySource(e) && e.status === 'จ่ายแล้ว')
    .reduce((s, e) => s + Number(e.amount), 0);
  const cashBalance = cashTopups - cashSpent;
  /*
    เงินสดย่อย เข้าและออก ในรายการเดียว.

    The panel used to list only what was spent, which is half a cash book: the
    balance above it moves on top-ups too, and with only the spends on screen
    there was no way to see why the two did not agree. Top-ups are + and
    spends are −, sorted together by date, and the total at the bottom is the
    NET movement for the window — the amount the balance changed by.
  */
  type CashRow = {
    key: string;
    title: string;
    meta: string;
    amount: number;
    at: number;
    shop: string;
    date: string;
    kind: 'เติมเงิน' | 'จ่ายออก';
    category: string;
  };
  const stamp = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

  const cashDetailItems: CashRow[] = [
    ...pettyCash
      .filter((p) => (shopFilter === 'all' || p.shop === shopFilter) && p.type === 'เติมเงิน')
      .filter((p) => inCashPeriod(p.dateObj))
      .map((p) => ({
        key: `topup-${p.id}`,
        title: p.note?.trim() || 'เติมเงินสดย่อย',
        meta: `เติมเงินสดย่อย · ${p.date ?? '-'}`,
        amount: Number(p.amount),
        at: stamp(p.dateObj),
        shop: p.shop,
        date: p.date ?? '-',
        kind: 'เติมเงิน' as const,
        category: '',
      })),
    ...shopExpensesAllCat
      .filter((e) => isPettySource(e) && e.status === 'จ่ายแล้ว' && inCashPeriod(e.dateObj))
      .map((e) => ({
        key: `spend-${e.id}`,
        title: e.desc,
        meta: `${e.category} · ${e.date ?? '-'}`,
        amount: -Number(e.amount),
        at: stamp(e.dateObj),
        shop: e.shop,
        date: e.date ?? '-',
        kind: 'จ่ายออก' as const,
        category: e.category,
      })),
  ].sort((a, b) => b.at - a.at);

  const cashDetailIn = cashDetailItems
    .filter((r) => r.amount > 0)
    .reduce((s, r) => s + r.amount, 0);
  const cashDetailOut = cashDetailItems
    .filter((r) => r.amount < 0)
    .reduce((s, r) => s - r.amount, 0);
  const cashDetailTotal = cashDetailIn - cashDetailOut;
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
          a.desc.localeCompare(b.desc, 'th'),
      ),
  }));

  async function exportExcel() {
    if (!exportAction) return;
    const payload: ExportPayload = {
      fileNameBase: `expenses-${shopFilter}`,
      groups: exportGroups.map((g) => ({
        sheetName: shopName(g.shopId),
        rows: g.items.map((e) => ({
          เลขที่เอกสาร: e.docNo ?? '',
          วันที่: e.date ?? '',
          กลุ่มค่าใช้จ่าย: e.category,
          รายละเอียด: e.desc,
          จ่ายจาก: e.source,
          สถานะ: e.status,
          // The sheet has to say which pile a row is in; the two totals
          // underneath it are not the same money.
          ประเภท: e.paidForFinnix ? 'จ่ายแทน Finnix' : 'ค่าใช้จ่ายของสาขา',
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

  /*
    รายงานเงินสดย่อย (ร้านขอ 22 ก.ย. 2569) — the cash book on screen, as a file.

    Oldest first, the way a cash book is read and checked against the tin, with
    money in and money out in their own columns and the window's totals at the
    foot. The same rows the panel shows, for the same branch and window.
  */
  const cashPeriodLabel =
    cashPeriod === 'today'
      ? fmtThaiDate(new Date())
      : cashPeriod === 'month'
        ? 'เดือน ' + fmtThaiMonthYear(new Date(cashPeriodValue + '-01T00:00:00'))
        : cashPeriod === 'year'
          ? 'ปี ' + cashPeriodValue
          : cashRangeStart + ' ถึง ' + cashRangeEnd;
  const cashBookRows = [...cashDetailItems].sort((a, b) => a.at - b.at);
  const [printPetty, setPrintPetty] = useState(false);

  async function exportPettyExcel() {
    if (!exportAction) return;
    const rows: Record<string, string | number>[] = cashBookRows.map((r) => ({
      วันที่: r.date,
      สาขา: shopName(r.shop),
      รายการ: r.title,
      ประเภท: r.kind,
      กลุ่มค่าใช้จ่าย: r.category,
      รับเข้า: r.amount > 0 ? r.amount : '',
      จ่ายออก: r.amount < 0 ? -r.amount : '',
    }));
    rows.push(
      {
        วันที่: '',
        สาขา: '',
        รายการ: 'รวม',
        ประเภท: '',
        กลุ่มค่าใช้จ่าย: '',
        รับเข้า: cashDetailIn,
        จ่ายออก: cashDetailOut,
      },
      {
        วันที่: '',
        สาขา: '',
        รายการ: 'เคลื่อนไหวสุทธิ',
        ประเภท: '',
        กลุ่มค่าใช้จ่าย: '',
        รับเข้า: cashDetailTotal,
        จ่ายออก: '',
      },
    );
    const res = await exportAction({
      fileNameBase: `petty-cash-${shopFilter}`,
      groups: [{ sheetName: 'เงินสดย่อย', rows }],
    });
    if (res) downloadBase64(res.base64, res.fileName);
  }
  function exportPettyPDF() {
    // The print sheet swaps to the cash book for this one print, then back.
    flushSync(() => setPrintPetty(true));
    window.print();
    setPrintPetty(false);
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

  /**
   * Uploads the chosen receipts to the private bucket and returns what the
   * Server Action needs to register them.
   *
   * The upload happens from the browser rather than through the Server Action:
   * a Server Action body is capped (1 MB by default) and a phone photo of a slip
   * routinely exceeds that, so the file goes straight to storage and only its
   * path travels through the action. Storage RLS (migration 0014) re-checks the
   * caller's `accounting.addExpense` on the way in.
   */
  async function uploadExpenseFiles(shop: string): Promise<UploadedAttachment[]> {
    return uploadFiles(shop, exFiles);
  }

  /** Thin wrapper so both call sites name the bucket once. */
  async function uploadFiles(shop: string, files: File[]): Promise<UploadedAttachment[]> {
    return uploadAttachments('expense-attachments', shop, files);
  }

  function addExpense() {
    if (!addExpenseAction) return;
    const targetShop = shopFilter === 'all' ? ex.shop : shopFilter;
    const lines = ex.lines
      .filter((l) => l.desc.trim() || l.category || Number(l.amount) > 0)
      .map((l) => ({ desc: l.desc, category: l.category, amount: Number(l.amount || 0) }));
    if (lines.length === 0) return;
    // Money that has left came out of somewhere; with no แหล่งเงิน it would
    // leave no balance at all. A bill still to be paid need not say yet.
    if (ex.status === 'จ่ายแล้ว' && !sourcesFor(targetShop).includes(ex.source)) {
      setAddError('เลือก "จ่ายจาก" เป็นแหล่งเงินของสาขานี้ก่อนบันทึก');
      return;
    }
    setAddError(null);
    startTransition(async () => {
      try {
        // Upload first: if a file fails, nothing has been written yet and the
        // user still has the form in front of them.
        const attachments = await uploadExpenseFiles(targetShop);
        await addExpenseAction({
          shop: targetShop,
          source: ex.source,
          status: ex.status,
          date: ex.date,
          paidForFinnix: ex.paidForFinnix,
          lines,
          attachments,
        });
        setShowAdd(false);
        setEx(emptyEx());
        setExFiles([]);
      } catch (e) {
        setAddError(e instanceof Error ? e.message : 'บันทึกค่าใช้จ่ายไม่สำเร็จ');
      }
    });
  }

  /**
   * Open a stored receipt IN PLACE. The bucket is private, so the URL is minted
   * per click by a Server Action and expires in a minute; it then feeds a
   * preview overlay rather than a download — checking a slip against a figure is
   * a two-second glance, and a tab-per-receipt (or a Downloads folder full of
   * `20.pdf`) was the wrong shape for it. The overlay still offers "เปิดแท็บใหม่"
   * for anyone who does want the file.
   */
  function openAttachment(a: ExpenseAttachment) {
    if (!attachmentUrlAction) return;
    setOpeningPath(a.path);
    startTransition(async () => {
      try {
        const res = await attachmentUrlAction(a.path);
        if (res.url) setPreview({ url: res.url, fileName: a.fileName, mimeType: a.mimeType ?? '' });
      } finally {
        setOpeningPath(null);
      }
    });
  }

  /** Upload receipts onto an expense that already exists (the edit row). */
  async function attachToExpense(expenseId: number, shop: string, files: File[]) {
    if (!attachAction || files.length === 0) return;
    setAddError(null);
    try {
      const uploaded = await uploadFiles(shop, files);
      const res = await attachAction(expenseId, uploaded);
      if (!res.ok) setAddError(res.error || 'แนบไฟล์ไม่สำเร็จ');
      // No refresh call: the action revalidates /accounting, and Next re-renders
      // the route on its own once a Server Action invoked from a client returns.
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'แนบไฟล์ไม่สำเร็จ');
    }
  }

  function removeAttachment(a: ExpenseAttachment) {
    if (!detachAction) return;
    if (!window.confirm(`ลบไฟล์แนบ "${a.fileName}" ออกจากรายการนี้?`)) return;
    startTransition(async () => {
      const res = await detachAction(a.id);
      if (!res.ok) setAddError(res.error || 'ลบไฟล์แนบไม่สำเร็จ');
    });
  }

  function addTopup() {
    if (!topupCashAction) return;
    if (!topup.from) {
      setTopupError('เลือกก่อนว่าเงินที่เติมมาจากแหล่งไหน');
      return;
    }
    if (!(Number(topup.amount) > 0)) {
      setTopupError('จำนวนเงินต้องมากกว่า 0');
      return;
    }
    setTopupError(null);
    startTransition(async () => {
      const res = await topupCashAction({
        shop: topupShop,
        amount: Number(topup.amount),
        note: topup.note || 'เติมเงินสดย่อย',
        fromAccountId: topup.from === OUTSIDE ? null : Number(topup.from),
      });
      if (res && !res.ok) {
        setTopupError(res.error || 'บันทึกการเติมเงินไม่สำเร็จ');
        return;
      }
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
      const paid = form.status === 'จ่ายแล้ว';
      await updateExpenseAction({
        id: form.id,
        shop: form.shop,
        desc: form.desc,
        category: form.category,
        source: form.source,
        amount: Number(form.amount),
        status: form.status,
        // `expenses.paid_at` is a DATE. Sending a UTC timestamp made Postgres
        // cast it back one day in Asia/Bangkok — pick 1 Aug, store 31 Jul.
        // A row carries the date of what it IS: จ่ายแล้ว dates the payment,
        // รอจ่าย dates the deadline. Switching status used to leave the old
        // date behind on the other column.
        paidAt: paid ? dateInputValue(form.dateObj) || null : null,
        dueAt: paid ? null : dateInputValue(form.dueObj) || null,
        paidForFinnix: !!form.paidForFinnix,
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
    <OptionManageProvider canManage={allowManageOptions}>
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
            aria-label="กรองตามสาขา"
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
          {/*
            พิมพ์ค้นหาได้ (ร้านขอ 19 ก.ย. 2569): the list is already past twenty
            groups and keeps growing, which is more than anyone can scroll
            accurately. The forms below got the typed picker earlier; this is
            the same list, so it gets the same control.
          */}
          <div style={{ minWidth: 200 }}>
            <SearchableSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: 'all', label: 'ทุกกลุ่มค่าใช้จ่าย' },
                ...expenseCategories.map((c) => ({ value: c, label: c })),
              ]}
              label="กรองตามกลุ่มค่าใช้จ่าย"
              placeholder="ทุกกลุ่มค่าใช้จ่าย"
              className="field w-full text-sm px-3 py-2"
              emptyText="ไม่พบกลุ่มค่าใช้จ่ายที่ค้นหา"
            />
          </div>
          <select
            value={statusFilter}
            aria-label="กรองตามสถานะ"
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
              {fmtThaiDateLong(new Date())}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
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
          {/* Money the branch is owed, not money it spent — its own card so it
              is never read as part of the cost of running the shop. */}
          <div className="card p-4">
            <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              เงินรอรับคืน Finnix
            </p>
            <p className="text-xl font-bold mt-1" style={{ color: '#8A5A12' }}>
              {fmt(finnixTotal)}
            </p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>
              {finnixExpenses.length > 0
                ? `${finnixExpenses.length} รายการ · ไม่รวมในค่าใช้จ่าย`
                : 'ไม่มีในช่วงนี้'}
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
        {/* สรุปเงินรอรับคืน Finnix — only when the period holds any. */}
        {finnixExpenses.length > 0 && (
          <div className="card p-5 mb-4" style={{ borderLeft: '3px solid #8A5A12' }}>
            {/* The whole heading is the toggle: the count and the total stay
                readable folded, which is all this panel is consulted for most
                days. */}
            <button
              type="button"
              onClick={() => setShowFinnixDetail(!showFinnixDetail)}
              aria-expanded={showFinnixDetail}
              className="w-full text-left"
            >
              <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <i
                    className={`fa-solid fa-chevron-${showFinnixDetail ? 'up' : 'down'} text-xs`}
                    style={{ color: '#8A5A12', opacity: 0.7 }}
                  ></i>
                  เงินรอรับคืน Finnix ({finnixExpenses.length} รายการ)
                </p>
                <p className="text-lg font-extrabold" style={{ color: '#8A5A12' }}>
                  {fmt(finnixTotal)}
                </p>
              </div>
              <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ค่าใช้จ่ายที่จ่ายแทน Finnix ในช่วงเวลานี้ —
                จ่ายออกไปแล้วแต่ไม่นับเป็นค่าใช้จ่ายของสาขา
                {!showFinnixDetail && ' · กดเพื่อดูรายการ'}
              </p>
            </button>
            {showFinnixDetail && (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--ink-soft)' }}>
                      <th className="text-left font-medium py-2">วันที่</th>
                      <th className="text-left font-medium py-2">เลขที่เอกสาร</th>
                      <th className="text-left font-medium py-2">รายการ</th>
                      <th className="text-left font-medium py-2">หมวด</th>
                      <th className="text-left font-medium py-2">สถานะ</th>
                      <th className="text-right font-medium py-2">ยอดจ่ายแทน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finnixExpenses.map((e) => (
                      <tr key={e.id} style={{ borderTop: '1px solid var(--line)' }}>
                        <td className="py-2 whitespace-nowrap text-xs">{e.date}</td>
                        <td className="py-2 text-xs">
                          {e.docNo || '—'}
                          <span className="block" style={{ color: 'var(--ink-faint)' }}>
                            {shopName(e.shop)}
                          </span>
                        </td>
                        <td className="py-2">{e.desc}</td>
                        <td className="py-2 text-xs">{e.category}</td>
                        <td className="py-2 text-xs">{e.status}</td>
                        <td className="py-2 text-right font-semibold whitespace-nowrap">
                          {fmt(e.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                      <td className="py-2 text-xs font-semibold" colSpan={5}>
                        รวมเงินรอรับคืน Finnix
                      </td>
                      <td
                        className="py-2 text-right font-extrabold whitespace-nowrap"
                        style={{ color: '#8A5A12' }}
                      >
                        {fmt(finnixTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {showCashDetail && (
          <div className="card p-5 mb-4 fade-page">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <p className="text-sm font-semibold">
                รายการที่รับ-จ่ายจากเงินสดย่อย
                {shopFilter !== 'all' ? ' · ' + shopName(shopFilter) : ''}
              </p>
              {allowExport && (
                <div className="flex gap-2">
                  <button
                    onClick={exportPettyExcel}
                    aria-label="ส่งออกเงินสดย่อยเป็น Excel"
                    className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-file-excel" style={{ color: '#1D6F42' }}></i>Excel
                  </button>
                  <button
                    onClick={exportPettyPDF}
                    aria-label="พิมพ์เงินสดย่อยเป็น PDF"
                    className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-file-pdf" style={{ color: '#C0392B' }}></i>PDF
                  </button>
                </div>
              )}
            </div>
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
                  {fmtThaiDateLong(new Date())}
                </span>
              )}
              {cashPeriod === 'month' && (
                <input
                  type="month"
                  value={cashPeriodValue}
                  onChange={(e) => setCashPeriodValue(e.target.value)}
                  aria-label="เลือกเดือน"
                  className="field text-sm px-3 py-2"
                />
              )}
              {cashPeriod === 'year' && (
                <select
                  value={cashPeriodValue}
                  aria-label="เลือกปีของเงินสดย่อย"
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
                ไม่มีรายการรับ-จ่ายเงินสดย่อยในช่วงเวลานี้
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {cashDetailItems.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-center justify-between py-2"
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                        {r.meta}
                      </p>
                    </div>
                    {/* Signed, because a cash book that shows 520 for money in and
                        520 for money out is unreadable. */}
                    <span
                      className="text-sm font-semibold flex-shrink-0"
                      style={{ color: r.amount > 0 ? '#3F6B33' : 'var(--ink)' }}
                    >
                      {r.amount > 0 ? '+' : '−'}
                      {fmt(Math.abs(r.amount))}
                    </span>
                  </div>
                ))}
                <div
                  className="flex justify-between pt-2 text-sm"
                  style={{ borderTop: '1.5px solid var(--line-strong)', color: 'var(--ink-soft)' }}
                >
                  <span>
                    เติมเข้า {fmt(cashDetailIn)} &middot; จ่ายออก {fmt(cashDetailOut)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold">
                  <span>เคลื่อนไหวสุทธิ</span>
                  <span style={{ color: cashDetailTotal < 0 ? '#B23A48' : '#3F6B33' }}>
                    {cashDetailTotal > 0 ? '+' : cashDetailTotal < 0 ? '−' : ''}
                    {fmt(Math.abs(cashDetailTotal))}
                  </span>
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
                    aria-label="สาขาที่เติมเงินสดย่อย"
                    // The source list belongs to the branch, so a pick made for
                    // another branch must not survive the switch.
                    onChange={(e) => setTopup({ ...topup, shop: e.target.value, from: '' })}
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
              <div className="sm:col-span-2">
                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  เงินมาจาก
                </label>
                <select
                  value={topup.from}
                  aria-label="เงินที่เติมมาจากแหล่งไหน"
                  onChange={(e) => setTopup({ ...topup, from: e.target.value })}
                  className="field w-full text-sm px-3 py-2"
                >
                  <option value="">เลือกแหล่งเงินที่เอาเงินออกมาเติม...</option>
                  {topupSources.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                  <option value={OUTSIDE}>นอกระบบ — เช่น เงินที่กรรมการสำรองให้</option>
                </select>
                {!topupHasPetty && (
                  <p className="text-xs mt-1.5" style={{ color: '#B23A48' }}>
                    สาขานี้ยังไม่มีแหล่งเงินประเภทเงินสดย่อย — เพิ่มที่หน้าการจัดการเงิน/บัญชีก่อน
                  </p>
                )}
              </div>
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
            {topupError && (
              <p className="text-xs mb-2" style={{ color: '#B23A48' }} role="alert">
                {topupError}
              </p>
            )}
            <button
              onClick={addTopup}
              disabled={isPending || !topupHasPetty}
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
                  aria-label="สาขาของค่าใช้จ่าย"
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
                <div
                  key={idx}
                  className="rounded-xl p-3"
                  style={{ border: '1px solid var(--line)' }}
                >
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
                        aria-label={`รายละเอียดรายการที่ ${idx + 1}`}
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
                <select
                  aria-label="จ่ายจาก"
                  value={
                    sourcesFor(shopFilter === 'all' ? ex.shop : shopFilter).includes(ex.source)
                      ? ex.source
                      : ''
                  }
                  onChange={(e) => setEx({ ...ex, source: e.target.value })}
                  className="field w-full text-sm px-3 py-2"
                >
                  <option value="">เลือกแหล่งเงินที่จ่าย...</option>
                  {sourcesFor(shopFilter === 'all' ? ex.shop : shopFilter).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  สถานะ
                </label>
                <select
                  value={ex.status}
                  aria-label="สถานะการจ่าย"
                  onChange={(e) => setEx({ ...ex, status: e.target.value })}
                  className="field w-full text-sm px-3 py-2"
                >
                  <option>จ่ายแล้ว</option>
                  <option>รอจ่าย</option>
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  {ex.status === 'จ่ายแล้ว' ? 'วันที่จ่าย' : 'กำหนดจ่าย'}
                </label>
                <input
                  type="date"
                  value={ex.date}
                  aria-label={ex.status === 'จ่ายแล้ว' ? 'วันที่จ่าย' : 'กำหนดจ่าย'}
                  onChange={(e) => setEx({ ...ex, date: e.target.value })}
                  className="field w-full text-sm px-3 py-2"
                />
              </div>
              {/*
                เงินก้อนนี้เป็นของใคร. Asked on the form rather than fixed up later,
                because it decides whether the amount is a cost or a receivable —
                and it is one answer for the whole document, like the ticket.
              */}
              <div className="sm:col-span-2">
                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  ค่าใช้จ่ายนี้เป็นของใคร
                </label>
                <div className="flex gap-2 mt-1">
                  {(
                    [
                      [false, 'ค่าใช้จ่ายของสาขา', 'fa-store'],
                      [true, 'จ่ายแทน Finnix', 'fa-hand-holding-dollar'],
                    ] as const
                  ).map(([kind, label, icon]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setEx({ ...ex, paidForFinnix: kind })}
                      aria-pressed={ex.paidForFinnix === kind}
                      className={`text-xs px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5 flex-1 justify-center ${
                        ex.paidForFinnix === kind ? 'btn-primary' : 'btn-outline'
                      }`}
                    >
                      <i className={`fa-solid ${icon}`}></i>
                      {label}
                    </button>
                  ))}
                </div>
                <p
                  className="text-xs mt-1.5"
                  style={{ color: ex.paidForFinnix ? '#8A5A12' : 'var(--ink-faint)' }}
                >
                  {ex.paidForFinnix
                    ? 'ยอดนี้ไม่นับเป็นค่าใช้จ่ายของสาขา แต่จะขึ้นเป็น เงินรอรับคืน Finnix'
                    : 'นับรวมเป็นค่าใช้จ่ายของสาขาตามปกติ'}
                </p>
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
                    aria-label="แนบไฟล์หลักฐานการจ่าย"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length) setExFiles((prev) => [...prev, ...files]);
                      e.target.value = '';
                    }}
                    className="text-xs flex-1"
                  />
                </div>
                {exFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {exFiles.map((file, fi) => (
                      <span
                        key={`${file.name}-${fi}`}
                        className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
                        style={{ background: 'var(--paper)', color: 'var(--primary)' }}
                      >
                        <i className="fa-solid fa-paperclip"></i>
                        {file.name}
                        <button
                          type="button"
                          aria-label={`เอา ${file.name} ออก`}
                          style={{ color: '#B23A48' }}
                          onClick={() => setExFiles((prev) => prev.filter((_, fi2) => fi2 !== fi))}
                        >
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {addError && (
              <p
                className="text-sm mb-3 px-3 py-2 rounded-lg"
                style={{ background: '#FBEAEC', color: '#B23A48' }}
                role="alert"
              >
                <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
                {addError}
              </p>
            )}
            <button
              onClick={addExpense}
              disabled={isPending}
              className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold"
              style={{ opacity: isPending ? 0.7 : 1 }}
            >
              {isPending && exFiles.length > 0 ? 'กำลังอัปโหลดไฟล์แนบ...' : 'บันทึกข้อมูล'}
              {!isPending && ex.lines.length > 1
                ? ` (${ex.lines.length} รายการ, รวม ${fmt(exLinesTotal)})`
                : ''}
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
                    {/* A row entered against the wrong branch is a correction the
                        shop has to be able to make itself. */}
                    <div>
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        สาขา
                      </label>
                      <select
                        value={editExForm.shop}
                        aria-label="แก้ไขสาขาของรายการค่าใช้จ่าย"
                        onChange={(e2) => setEditExForm({ ...editExForm, shop: e2.target.value })}
                        className="field text-sm px-2.5 py-1.5 w-full"
                      >
                        {accessibleShops.map((sh) => (
                          <option key={sh.id} value={sh.id}>
                            {sh.name}
                          </option>
                        ))}
                        {/* A branch this user cannot see still shows on its own row,
                            so saving never silently moves the expense elsewhere. */}
                        {!accessibleShops.some((sh) => sh.id === editExForm.shop) && (
                          <option value={editExForm.shop}>{shopName(editExForm.shop)}</option>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        กลุ่มค่าใช้จ่าย
                      </label>
                      {/* The placeholder is the picker's accessible name too, so
                          a bare "เลือก..." left both of these reading the same
                          to anyone not looking at the caption above. */}
                      <ManagedDropdown
                        value={editExForm.category}
                        onChange={(v) => setEditExForm({ ...editExForm, category: v })}
                        options={expenseCategories}
                        setOptions={setExpenseCategories}
                        placeholder="เลือกกลุ่มค่าใช้จ่าย..."
                      />
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        จ่ายจาก
                      </label>
                      <select
                        aria-label="แก้ไขจ่ายจาก"
                        value={editExForm.source}
                        onChange={(e) => setEditExForm({ ...editExForm, source: e.target.value })}
                        className="field w-full text-sm px-3 py-2"
                      >
                        <option value="">เลือกแหล่งเงินที่จ่าย...</option>
                        {sourcesFor(editExForm.shop, editExForm.source).map((m) => (
                          <option key={m} value={m}>
                            {isAccountName(editExForm.shop, m) ? m : m + LEGACY_METHOD_SUFFIX}
                          </option>
                        ))}
                      </select>
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
                        aria-label="แก้ไขสถานะการจ่าย"
                        onChange={(e2) => setEditExForm({ ...editExForm, status: e2.target.value })}
                        className="field text-sm px-2.5 py-1.5 w-full"
                      >
                        <option>จ่ายแล้ว</option>
                        <option>รอจ่าย</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        {editExForm.status === 'จ่ายแล้ว' ? 'วันที่จ่าย' : 'กำหนดจ่าย'}
                      </label>
                      {/* One field, two columns: a paid row dates the payment and a
                          pending one dates the deadline. Before this, กำหนดจ่าย could
                          not be edited at all. */}
                      <input
                        type="date"
                        aria-label={editExForm.status === 'จ่ายแล้ว' ? 'วันที่จ่าย' : 'กำหนดจ่าย'}
                        value={dateInputValue(
                          editExForm.status === 'จ่ายแล้ว' ? editExForm.dateObj : editExForm.dueObj,
                        )}
                        onChange={(e2) => {
                          const d = e2.target.value
                            ? new Date(e2.target.value + 'T00:00:00')
                            : null;
                          setEditExForm(
                            editExForm.status === 'จ่ายแล้ว'
                              ? {
                                  ...editExForm,
                                  dateObj: d,
                                  date: d ? fmtThaiDate(d) : '-',
                                }
                              : {
                                  ...editExForm,
                                  dueObj: d,
                                  due: d ? fmtThaiDate(d) : undefined,
                                },
                          );
                        }}
                        className="field text-sm px-2.5 py-1.5 w-full"
                      />
                    </div>
                    {/* The same choice the add form asks for, so a row entered as an
                        ordinary cost can be corrected to จ่ายแทน afterwards. */}
                    <div className="sm:col-span-2">
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        ค่าใช้จ่ายนี้เป็นของใคร
                      </label>
                      <div className="flex gap-2 mt-1">
                        {(
                          [
                            [false, 'ค่าใช้จ่ายของสาขา'],
                            [true, 'จ่ายแทน Finnix'],
                          ] as const
                        ).map(([kind, label]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setEditExForm({ ...editExForm, paidForFinnix: kind })}
                            aria-pressed={!!editExForm.paidForFinnix === kind}
                            className={`text-xs px-3 py-1.5 rounded-lg font-semibold flex-1 ${
                              !!editExForm.paidForFinnix === kind ? 'btn-primary' : 'btn-outline'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/*
                    Receipts, in the edit row. Opening a saved expense used to
                    show no attachments at all and offer no way to add one, so a
                    slip that arrived after the entry had nowhere to go.
                  */}
                  <div className="mb-2">
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      ไฟล์แนบ
                    </label>
                    <div className="flex flex-wrap gap-1.5 mt-1 mb-1.5">
                      {(e.attachments ?? []).length === 0 && (
                        <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                          ยังไม่มีไฟล์แนบ
                        </span>
                      )}
                      {(e.attachments ?? []).map((a) => (
                        <span
                          key={a.id}
                          className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
                          style={{ background: 'var(--surface)', color: 'var(--primary)' }}
                        >
                          <button
                            onClick={() => openAttachment(a)}
                            className="flex items-center gap-1.5"
                            title={`ดู ${a.fileName}`}
                          >
                            <i
                              className={`fa-solid ${
                                openingPath === a.path ? 'fa-spinner fa-spin' : 'fa-paperclip'
                              }`}
                            ></i>
                            <span className="truncate" style={{ maxWidth: 160 }}>
                              {a.fileName}
                            </span>
                          </button>
                          {detachAction && (
                            <button
                              onClick={() => removeAttachment(a)}
                              aria-label={`ลบไฟล์แนบ ${a.fileName}`}
                              style={{ color: '#B23A48' }}
                            >
                              <i className="fa-solid fa-xmark"></i>
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    {attachAction && (
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        multiple
                        aria-label="แนบไฟล์เพิ่มในรายการนี้"
                        className="text-xs"
                        onChange={(e2) => {
                          const files = Array.from(e2.target.files || []);
                          e2.target.value = '';
                          if (files.length) void attachToExpense(e.id, e.shop, files);
                        }}
                      />
                    )}
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
                    <p className="text-sm font-medium truncate">{e.desc}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                      {/* The reference someone quotes when they ring up about
                          this expense, so it leads the line. */}
                      {e.docNo && (
                        <>
                          <span style={{ fontFamily: 'monospace' }}>{e.docNo}</span>
                          {' · '}
                        </>
                      )}
                      {/* ค่าใช้จ่ายนี้เป็นกลุ่มไหน และจ่ายออกจากแหล่งเงินไหน — two
                          different questions that were the same shade of grey,
                          a middot apart (ร้านขอ 19 ก.ย. 2569). */}
                      <span style={{ color: 'var(--expense-group)', fontWeight: 500 }}>
                        {e.category}
                      </span>
                      {' · '}
                      <span style={{ color: 'var(--money-source)', fontWeight: 500 }}>
                        {e.source}
                      </span>
                      {' · '}
                      {e.date}
                    </p>
                    {/*
                    The bucket is private, so each chip fetches a short-lived
                    signed URL on click rather than rendering a link the browser
                    could not follow (and that would leak if copied).
                  */}
                    {e.attachments && e.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {e.attachments.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => openAttachment(a)}
                            disabled={openingPath === a.path}
                            className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
                            style={{ background: 'var(--paper)', color: 'var(--primary)' }}
                            title={`เปิด ${a.fileName}`}
                          >
                            <i
                              className={`fa-solid ${
                                openingPath === a.path ? 'fa-spinner fa-spin' : 'fa-paperclip'
                              }`}
                            ></i>
                            <span className="truncate" style={{ maxWidth: 160 }}>
                              {a.fileName}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 flex items-center gap-2">
                    <span className="text-sm font-semibold">{fmt(e.amount)}</span>
                    <StatusPill
                      label={e.status}
                      colorMap={{
                        จ่ายแล้ว: { bg: '#E6EFDC', text: '#3F6B33', dot: '#6BA24F' },
                        รอจ่าย: { bg: '#FBF1DA', text: '#8A5A12', dot: '#E8B23D' },
                      }}
                    />
                    {allowAdd && (
                      <div className="flex items-center gap-1 row-action">
                        <button
                          onClick={() => startEditExpense(e)}
                          aria-label={`แก้ไขรายการ ${e.desc}`}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                          style={{ background: 'var(--paper)', color: 'var(--primary)' }}
                        >
                          <i className="fa-solid fa-pen"></i>
                        </button>
                        <button
                          onClick={() => deleteExpense(e.id)}
                          aria-label={`ลบรายการ ${e.desc}`}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                          style={{ background: 'var(--paper)', color: '#B23A48' }}
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
        {/* See WholesaleList: `typeof document` is false on the server and true on
          the first client render, which is a hydration mismatch. */}
        {mounted &&
          createPortal(
            printPetty ? (
              <div className="print-area">
                <h2>
                  รายการรับ-จ่ายเงินสดย่อย
                  {shopFilter !== 'all' ? ' · ' + shopName(shopFilter) : ''} · {cashPeriodLabel}
                </h2>
                <p>วันที่พิมพ์: {fmtThaiDate(new Date())}</p>
                <table>
                  <thead>
                    <tr>
                      <th>วันที่</th>
                      {shopFilter === 'all' && <th>สาขา</th>}
                      <th>รายการ</th>
                      <th>ประเภท</th>
                      <th>กลุ่มค่าใช้จ่าย</th>
                      <th style={{ textAlign: 'right' }}>รับเข้า</th>
                      <th style={{ textAlign: 'right' }}>จ่ายออก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashBookRows.map((r) => (
                      <tr key={r.key}>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>
                        {shopFilter === 'all' && <td>{shopName(r.shop)}</td>}
                        <td>{r.title}</td>
                        <td>{r.kind}</td>
                        <td>{r.category || '-'}</td>
                        <td style={{ textAlign: 'right' }}>{r.amount > 0 ? fmt(r.amount) : ''}</td>
                        <td style={{ textAlign: 'right' }}>{r.amount < 0 ? fmt(-r.amount) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ textAlign: 'right' }}>
                  เติมเข้า {fmt(cashDetailIn)} · จ่ายออก {fmt(cashDetailOut)}
                </p>
                <p style={{ textAlign: 'right' }}>
                  <strong>เคลื่อนไหวสุทธิ: {fmt(cashDetailTotal)} บาท</strong>
                </p>
              </div>
            ) : (
              <div className="print-area">
                <h2>
                  รายการค่าใช้จ่าย{shopFilter !== 'all' ? ' · ' + shopName(shopFilter) : ''}
                  {categoryFilter !== 'all' ? ' · ' + categoryFilter : ''}
                  {period === 'today'
                    ? ' · ' + fmtThaiDate(new Date())
                    : period === 'month'
                      ? ' · เดือน ' + fmtThaiMonthYear(new Date(periodValue + '-01T00:00:00'))
                      : period === 'year'
                        ? ' · ปี ' + periodValue
                        : period === 'range'
                          ? ' · ' + rangeStart + ' ถึง ' + rangeEnd
                          : ''}
                </h2>
                <p>วันที่พิมพ์: {fmtThaiDate(new Date())}</p>
                {exportGroups.map((g) => (
                  <div key={g.shopId} style={{ marginBottom: 16 }}>
                    <h3>{shopName(g.shopId)}</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>วันที่</th>
                          <th>กลุ่มค่าใช้จ่าย</th>
                          <th>เลขที่เอกสาร</th>
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
                            <td style={{ whiteSpace: 'nowrap' }}>{e.docNo || '-'}</td>
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
              </div>
            ),
            document.body,
          )}

        {/* Same viewer the ticket slips and QC photos use. */}
        {preview && (
          <FilePreview
            url={preview.url}
            fileName={preview.fileName}
            mimeType={preview.mimeType}
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </OptionManageProvider>
  );
}
