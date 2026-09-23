import { sumReceipts, type SalesReceipt } from '@/components/dashboard/cashSales';
import {
  buildMoneySources,
  byAccountOrder,
  type MoneyAccount,
  type MoneyMovement,
  type MoneyTransfer,
} from '@/components/dashboard/moneyFlow';

/**
 * สรุปการเงินประจำวัน — one day, one page, for the owners.
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

export type CategoryAmount = { name: string; amount: number };

export type ChannelSales = {
  channel: SalesReceipt['channel'];
  total: number;
  categories: CategoryAmount[];
};

export type SourceRow = {
  /** `a<id>` for an account, `l<shop>:<label>` for a label nobody claims. */
  key: string;
  shop: string;
  accountId: number | null;
  name: string;
  amount: number;
  count: number;
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
    total: number;
    /** Sales on the previous day, for the "เทียบเมื่อวาน" line. */
    previousTotal: number;
    /** เงินรอคืน Finnix taken in today — in ② but never in ①. */
    held: number;
    /** Distinct tickets / POs that paid today. */
    documents: number;
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

function salesFor(receipts: SalesReceipt[]): ChannelSales[] {
  return CHANNEL_ORDER.map((channel) => {
    const mine = receipts.filter((r) => r.channel === channel);
    const categories = [...new Set(mine.map((r) => r.category))]
      .map((name) => ({ name, amount: sumReceipts(mine.filter((r) => r.category === name)) }))
      .filter((c) => c.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
    return { channel, total: sumReceipts(mine), categories };
  }).filter((c) => c.categories.length > 0);
}

export function buildDailyReport(input: {
  day: string;
  shops: DailyShop[];
  receipts: SalesReceipt[];
  accounts: MoneyAccount[];
  movements: MoneyMovement[];
  transfers: MoneyTransfer[];
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
    };
    row.amount = satang(row.amount + Math.abs(m.amount));
    row.count += 1;
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
      total: sumReceipts(earned),
      previousTotal,
      held: sumReceipts(todays.filter((r) => r.held)),
      documents: new Set(todays.map((r) => r.sourceId)).size,
    },
    inflow: { rows: inflowRows, total: satang(inflowRows.reduce((n, r) => n + r.amount, 0)) },
    outflow: { rows: outflowRows, total: satang(outflowRows.reduce((n, r) => n + r.amount, 0)) },
    balances,
    hasUnmatched: [...inflowRows, ...outflowRows].some((r) => r.accountId === null),
  };
}
