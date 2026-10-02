import { sumReceipts, type SalesReceipt } from '@/components/dashboard/cashSales';
import {
  buildMoneySources,
  byAccountOrder,
  type MoneyAccount,
  type MoneyMovement,
  type MoneyTransfer,
} from '@/components/dashboard/moneyFlow';

/**
 * รายงานการเงินรายวัน — one day, one page, for the owners.
 *
 * Four questions, each answered from rules that already exist elsewhere so the
 * page can never quote a figure another screen disagrees with:
 *
 *   ① ยอดขายที่เก็บเงินได้ แยก ปลีก / ส่ง แล้วแยกชนิดสินค้า — the dashboard's
 *     receipts (components/dashboard/cashSales.ts): a payment counts on the day
 *     the money came in, split across what it paid for. เงินรอคืน Finnix is
 *     collected but not this branch's sales, so it is reported beside ①, not in it.
 *   ② เงินรับเข้า แยกแหล่งเงิน and ③ ค่าใช้จ่าย แยกแหล่งเงิน — the movements
 *     โมดูลการเงิน counts, attached to an account by the same "first account in
 *     the branch that claims the label" rule as `buildMoneySources`. A label no
 *     account claims is still listed, flagged, rather than dropped.
 *   ④ ยอดคงเหลือ — `buildMoneySources` itself, run up to the end of the day
 *     before and up to the end of the day, so the closing column is the figure
 *     /money would have shown that evening.
 *
 * Transfers between accounts are neither ② nor ③: the business is no richer when
 * cash is banked. They appear only in ④, where they move a balance.
 */

export type DailyShop = { id: string; name: string };

/**
 * รายการที่อยู่เบื้องหลังตัวเลข "จำนวน" หนึ่งตัว (ร้านขอ 2 ต.ค. 2569).
 *
 * ตัวเลขอย่าง "1 งาน" หรือ "3 รายการ" ตอบได้แค่ว่ามีกี่อัน ไม่ได้ตอบว่าอันไหน
 * และคำถามถัดไปของคนอ่านคืออันไหนเสมอ — เดิมต้องออกจากหน้านี้ไปเปิดอีกโมดูล
 * แล้วไล่หาเอง ซึ่งแปลว่าเลิกอ่านรายงานกลางคัน
 *
 * สร้างตอนประกอบรายงาน ไม่ใช่ตอนกด เพราะข้อมูลทั้งหมดอยู่ในมืออยู่แล้ว ณ
 * จังหวะนั้น การไปถามใหม่ทีหลังคือการถามสิ่งที่เพิ่งนับไปเมื่อกี้
 */
export type CountItem = {
  /** บรรทัดบน — เลขที่ใบงาน/PO หรือชื่อรายการเงิน. */
  label: string;
  /** บรรทัดล่าง — ลูกค้า วิธีจ่าย หรือหมวดค่าใช้จ่าย. ว่างได้. */
  note?: string;
  amount: number;
  /** เปิดเอกสารต้นทางได้ไหม และที่ไหน. */
  href?: string;
};

/** `count` is how many ใบงาน / PO paid toward it — one job paying twice is one job. */
export type CategoryAmount = { name: string; amount: number; count: number; items: CountItem[] };

export type ChannelSales = {
  channel: SalesReceipt['channel'];
  total: number;
  count: number;
  categories: CategoryAmount[];
  items: CountItem[];
};

/**
 * A retail job, as much of it as "is it still owed money on this day" needs.
 *
 * `history` is `ticket_status_history`, each change dated to the shop's day.
 * `status` is the job's status now.
 */
export type OutstandingJob = {
  id: string;
  shop: string;
  /** รับแทน Finnix — the money is another shop's, so it is not this one's debt. */
  held: boolean;
  /** วันที่รับงาน, `YYYY-MM-DD`. A job booked after the day did not exist yet. */
  dropOff: string;
  /** Items net of discount, plus ประกัน sold on the job by the day. */
  total: number;
  payments: { amount: number; on: string }[];
  history: { status: string; on: string }[];
  status: string;
};

export type Outstanding = { count: number; amount: number; items: CountItem[] };

/**
 * สถานะของงาน ณ สิ้นวัน `day`.
 *
 * On the current day the job's own status is the answer. For a day in the past
 * it is the last change recorded on or before it. The form that edits a whole
 * ใบงาน saves a new status without writing history, so a past day can only be
 * as right as the history is; a job with no history at all has only its
 * current status to go on.
 */
export function statusOn(job: OutstandingJob, day: string, today: string): string | null {
  if (day >= today) return job.status;
  let found: string | null = null;
  for (const h of job.history) if (h.on <= day) found = h.status;
  if (found !== null) return found;
  return job.history.length === 0 ? job.status : null;
}

/**
 * งานขายค้างชำระ ณ สิ้นวัน — retail jobs still owed money that were, on that
 * day, in one of `statuses`: work in hand or handed over unpaid. A job only
 * booked, or already delivered and closed, is not what the owners chase.
 */
export function outstandingOn(
  jobs: OutstandingJob[],
  statuses: readonly string[],
  day: string,
  today: string,
): Outstanding {
  const wanted = new Set(statuses);
  let count = 0;
  let amount = 0;
  const items: CountItem[] = [];
  for (const j of jobs) {
    if (j.held || !j.dropOff || j.dropOff > day) continue;
    const status = statusOn(j, day, today);
    if (status === null || !wanted.has(status)) continue;
    const paid = j.payments.filter((p) => p.on && p.on <= day).reduce((n, p) => n + p.amount, 0);
    const due = satang(j.total - paid);
    if (due <= 0) continue;
    count += 1;
    amount = satang(amount + due);
    // สถานะ ณ วันนั้น ไม่ใช่สถานะวันนี้ — รายงานของเมื่อวานต้องอ่านเหมือนเมื่อวาน
    items.push({ label: j.id, note: status, amount: due, href: `/tickets/${j.id}` });
  }
  return { count, amount, items: items.sort((a, b) => b.amount - a.amount) };
}

export type SourceRow = {
  /** `a<id>` for an account, `l<shop>:<label>` for a label nobody claims. */
  key: string;
  shop: string;
  accountId: number | null;
  name: string;
  amount: number;
  count: number;
  items: CountItem[];
};

export type BalanceRow = {
  accountId: number;
  shop: string;
  name: string;
  kind: string;
  opening: number;
  inflow: number;
  outflow: number;
  /** โอนเข้า − โอนออก during the day. */
  transfer: number;
  closing: number;
};

export type DailyReport = {
  day: string;
  sales: {
    channels: ChannelSales[];
    /** ใบงาน/PO ที่จ่ายเงินเข้ามาวันนี้ — เบื้องหลังตัวเลข `documents`. */
    items: CountItem[];
    total: number;
    /** Sales on the previous day, for the "เทียบเมื่อวาน" line. */
    previousTotal: number;
    /** เงินรอคืน Finnix taken in today — in ② but never in ①. */
    held: number;
    /** Distinct tickets / POs whose payment today counts as sales. */
    documents: number;
    /** งานขายค้างชำระ at the close of the day, in the statuses asked for. */
    outstanding: Outstanding;
  };
  inflow: { rows: SourceRow[]; total: number };
  outflow: { rows: SourceRow[]; total: number };
  balances: { shop: string; name: string; accounts: BalanceRow[]; total: number }[];
  /** Whether ② or ③ has money under a label no account claims. */
  hasUnmatched: boolean;
};

const CHANNEL_ORDER: SalesReceipt['channel'][] = ['ปลีก', 'ขายส่ง'];

const satang = (n: number) => Math.round(n * 100) / 100;

/** The day before `YYYY-MM-DD`, as the shop's calendar reads it. */
export function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The day after `YYYY-MM-DD`. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const jobsIn = (rows: SalesReceipt[]) => new Set(rows.map((r) => r.sourceId)).size;

/**
 * ใบงาน/PO ที่อยู่เบื้องหลังกองเงินกองหนึ่ง — ใบละบรรทัด ไม่ใช่การจ่ายละบรรทัด.
 *
 * งานที่จ่ายสองครั้งในวันเดียวคือหนึ่งงาน ซึ่งเป็นกติกาเดียวกับที่ `jobsIn`
 * ใช้นับ ถ้าป๊อปอัพแสดงสองบรรทัดแต่ตัวเลขข้างบนบอก 1 คนอ่านจะเชื่อตัวไหนก็ผิด
 */
function receiptItems(rows: SalesReceipt[]): CountItem[] {
  const byDoc = new Map<string, { amount: number; channel: SalesReceipt['channel'] }>();
  for (const r of rows) {
    const found = byDoc.get(r.sourceId) ?? { amount: 0, channel: r.channel };
    byDoc.set(r.sourceId, { amount: satang(found.amount + r.amount), channel: r.channel });
  }
  return [...byDoc.entries()]
    .map(([id, v]) => ({
      label: id,
      amount: v.amount,
      href: v.channel === 'ขายส่ง' ? `/wholesale/${id}` : `/tickets/${id}`,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function salesFor(receipts: SalesReceipt[]): ChannelSales[] {
  return CHANNEL_ORDER.map((channel) => {
    const mine = receipts.filter((r) => r.channel === channel);
    const categories = [...new Set(mine.map((r) => r.category))]
      .map((name) => {
        const rows = mine.filter((r) => r.category === name);
        return { name, amount: sumReceipts(rows), count: jobsIn(rows), items: receiptItems(rows) };
      })
      .filter((c) => c.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
    return {
      channel,
      total: sumReceipts(mine),
      count: jobsIn(mine),
      categories,
      items: receiptItems(mine),
    };
  }).filter((c) => c.categories.length > 0);
}

export function buildDailyReport(input: {
  day: string;
  shops: DailyShop[];
  receipts: SalesReceipt[];
  accounts: MoneyAccount[];
  movements: MoneyMovement[];
  transfers: MoneyTransfer[];
  /** Retail jobs for งานค้างชำระ; omitted, the line reads zero. */
  jobs?: OutstandingJob[];
  /** The statuses a job must be in, on the day, to count as ค้างชำระ. */
  dueStatuses?: readonly string[];
  /** The shop's today — past days read status from history. Defaults to `day`. */
  today?: string;
}): DailyReport {
  const { day, shops } = input;
  const inScope = new Set(shops.map((s) => s.id));
  const yesterday = previousDay(day);

  // ---- ① ---------------------------------------------------------------------
  const todays = input.receipts.filter((r) => inScope.has(r.shop) && r.on === day);
  const earned = todays.filter((r) => !r.held);
  const channels = salesFor(earned);
  const previousTotal = sumReceipts(
    input.receipts.filter((r) => inScope.has(r.shop) && r.on === yesterday && !r.held),
  );

  // ---- ② ③ -------------------------------------------------------------------
  const accountsOf = new Map<string, MoneyAccount[]>();
  for (const a of [...input.accounts].sort(byAccountOrder)) {
    if (!inScope.has(a.shop)) continue;
    accountsOf.set(a.shop, [...(accountsOf.get(a.shop) ?? []), a]);
  }
  const owner = (shop: string, label: string) =>
    (accountsOf.get(shop) ?? []).find((a) => a.name === label || a.matchNames.includes(label));

  const inflow = new Map<string, SourceRow>();
  const outflow = new Map<string, SourceRow>();
  for (const m of input.movements) {
    if (!inScope.has(m.shop) || m.on !== day || !m.amount) continue;
    const account = owner(m.shop, m.source);
    const key = account ? `a${account.id}` : `l${m.shop}:${m.source}`;
    const bucket = m.amount > 0 ? inflow : outflow;
    const row = bucket.get(key) ?? {
      key,
      shop: m.shop,
      accountId: account?.id ?? null,
      name: account?.name ?? m.source,
      amount: 0,
      count: 0,
      items: [],
    };
    row.amount = satang(row.amount + Math.abs(m.amount));
    row.count += 1;
    /*
      เงินมาจากไหน — ใช้ `ref` ที่การเคลื่อนไหวพกมาอยู่แล้ว (โมดูลการเงิน).

      การเคลื่อนไหวที่ไม่มี `ref` คือยอดยกมาหรือรายการที่ลงมือ ไม่มีเอกสาร
      ต้นทางให้เปิด — แสดงชื่อแหล่งเงินไว้แทนที่จะข้าม เพราะจำนวนที่นับไว้
      ข้างบนนับมันไปแล้ว
    */
    row.items.push({
      label: m.ref?.docNo || m.source,
      note: [m.ref?.title, m.ref?.detail].filter(Boolean).join(' · ') || undefined,
      amount: Math.abs(m.amount),
      href: m.ref
        ? m.ref.kind === 'ticket'
          ? `/tickets/${m.ref.id}`
          : m.ref.kind === 'order'
            ? `/wholesale/${m.ref.id}`
            : '/accounting'
        : undefined,
    });
    bucket.set(key, row);
  }

  // Branch order, then the branch's own account order, then orphan labels.
  const shopRank = new Map(shops.map((s, i) => [s.id, i]));
  const accountRank = new Map([...accountsOf.values()].flat().map((a, i) => [a.id, i] as const));
  const ordered = (rows: Map<string, SourceRow>) =>
    [...rows.values()].sort(
      (a, b) =>
        (shopRank.get(a.shop) ?? 0) - (shopRank.get(b.shop) ?? 0) ||
        (a.accountId === null ? 1 : 0) - (b.accountId === null ? 1 : 0) ||
        (accountRank.get(a.accountId ?? -1) ?? 0) - (accountRank.get(b.accountId ?? -1) ?? 0) ||
        b.amount - a.amount,
    );
  const inflowRows = ordered(inflow);
  const outflowRows = ordered(outflow);

  // ---- ④ ---------------------------------------------------------------------
  const open = input.accounts.filter((a) => inScope.has(a.shop) && a.openedAt <= day);
  const upTo = (last: string) =>
    buildMoneySources(
      shops,
      open,
      input.movements.filter((m) => m.on <= last),
      input.transfers.filter((t) => t.on <= last),
    );
  const before = upTo(yesterday);
  const after = upTo(day);
  const openingOf = new Map(
    before.branches.flatMap((b) => b.accounts.map((a) => [a.id, a.balance] as const)),
  );
  const balances = after.branches.map((b) => ({
    shop: b.shop,
    name: b.name,
    total: b.total,
    accounts: b.accounts.map((a) => {
      // An account opened today starts the day at its opening balance.
      const opening = openingOf.get(a.id) ?? a.opening;
      const todayIn = inflowRows.find((r) => r.accountId === a.id)?.amount ?? 0;
      const todayOut = outflowRows.find((r) => r.accountId === a.id)?.amount ?? 0;
      return {
        accountId: a.id,
        shop: b.shop,
        name: a.name,
        kind: a.kind,
        opening,
        inflow: todayIn,
        outflow: todayOut,
        transfer: satang(a.balance - opening - todayIn + todayOut),
        closing: a.balance,
      };
    }),
  }));

  return {
    day,
    sales: {
      channels,
      items: receiptItems(earned),
      total: sumReceipts(earned),
      previousTotal,
      held: sumReceipts(todays.filter((r) => r.held)),
      documents: jobsIn(earned),
      outstanding: outstandingOn(
        (input.jobs ?? []).filter((j) => inScope.has(j.shop)),
        input.dueStatuses ?? [],
        day,
        input.today ?? day,
      ),
    },
    inflow: { rows: inflowRows, total: satang(inflowRows.reduce((n, r) => n + r.amount, 0)) },
    outflow: { rows: outflowRows, total: satang(outflowRows.reduce((n, r) => n + r.amount, 0)) },
    balances,
    hasUnmatched: [...inflowRows, ...outflowRows].some((r) => r.accountId === null),
  };
}
