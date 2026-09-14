/**
 * แหล่งเงิน — how much money the branch has, and where it is sitting.
 *
 * Every figure here is a real BALANCE, which it could not be before migration
 * 0043. The system knew what came in against a payment method and what went out
 * against an expense source, both only since the day it was switched on, so any
 * total it produced was movement: a bank account held money before that day, and
 * cash taken at the counter was banked or moved into เงินสดย่อย without either
 * leg being recorded. Two additions closed that gap — an opening balance per
 * account, and transfers between accounts — and this is the arithmetic they make
 * possible:
 *
 *     ยอดคงเหลือ = ยอดตั้งต้น + รับเข้า − จ่ายออก + โอนเข้า − โอนออก
 *
 * Nothing before `opened_at` counts. That date is what the opening balance was
 * true ON, so adding older movements on top would count the same money twice —
 * once inside the figure the shop typed, once again as a transaction.
 *
 * แหล่งเงินผูกกันด้วย "ชื่อ" ไม่ใช่ด้วย id. A payment or an expense records the
 * label the person picked, and an account claims the labels that mean it. That
 * is what lets the till keep saying "เงินสด" while the bookkeeper renames the
 * account — but it also means a label nobody claims contributes to nothing. So
 * every such label is collected as `unmatched` and reported: money that left
 * the shop and shows up in no balance is the one thing this file must not do
 * silently, and it is a one-line fix once somebody can SEE which label it is.
 *
 * WHAT IS DELIBERATELY NOT IN HERE: ค้างรับ and ค้างจ่าย. A ticket invoiced and
 * not yet paid is revenue, and a bill accepted and not yet paid is a cost, but
 * neither has moved a single baht — and this is a count of where money IS. The
 * caller only ever hands over recorded PAYMENTS and expenses already marked
 * จ่ายแล้ว; those two figures have their own columns on the branch-comparison
 * card, where they belong.
 */

/** Where the money is, and how much of it. */
export type AccountBalance = {
  id: number;
  name: string;
  kind: string;
  /** Bank account number, shown under the name when the shop recorded one. */
  accountNo: string;
  /** The figure the shop reconciled from, and the date it was true. */
  opening: number;
  /** Received against this account since `opened_at`. */
  inflow: number;
  /** Paid out from this account since `opened_at`. */
  outflow: number;
  /** Moved in from another account (banking cash, topping up petty cash). */
  transferIn: number;
  /** Moved out to another account. */
  transferOut: number;
  /** opening + inflow − outflow + transferIn − transferOut. */
  balance: number;
};

/**
 * แหล่งเงินที่ยังไม่ได้ผูกกับบัญชีไหนเลย.
 *
 * A movement names its account by LABEL — the free text the till or the
 * expense form recorded — and an account claims the labels that mean it in
 * `match_names`. Anything nobody claims used to fall on the floor in silence:
 * the expense saved, the list showed it, and the balance simply did not move.
 * Money that left the shop and appears in no total is the one error this card
 * must never make quietly, so orphans are counted and handed back to be shown.
 */
export type UnmatchedLabel = {
  /** The label exactly as recorded — what has to go into `match_names`. */
  label: string;
  /** Money in under this label, since the earliest account opened. */
  inflow: number;
  /** Money out under this label. */
  outflow: number;
  /** How many movements are affected — "one typo" versus "every expense". */
  count: number;
};

export type BranchMoney = {
  shop: string;
  name: string;
  accounts: AccountBalance[];
  /** Every account added up — a real figure now, so the card may show it. */
  total: number;
  /** Labels in this branch that no account claims. Usually empty. */
  unmatched: UnmatchedLabel[];
};

/** The branches on the card, and every baht across them. */
export type MoneyOverview = {
  branches: BranchMoney[];
  /**
   * Every account in every branch shown. Safe to add up only because these are
   * balances: the movement version this replaced would have counted banked cash
   * once in the drawer and again in the bank.
   */
  total: number;
  /**
   * Whether any branch has money recorded against a label no account claims.
   * The card shows a warning on this rather than making the reader compare
   * two screens to discover that a figure is short.
   */
  hasUnmatched: boolean;
};

export type MoneyAccount = {
  id: number;
  shop: string;
  name: string;
  kind: string;
  accountNo: string;
  openingBalance: number;
  openedAt: string;
  /** Labels in `method` / `source` that mean this account. */
  matchNames: string[];
  sortOrder: number;
};

/**
 * เอกสารต้นทางของเงินก้อนหนึ่ง — what the ledger prints beside the amount.
 *
 * Optional on a movement because the dashboard card only needs the sum;
 * the ledger needs to say which ticket, PO or expense the money belongs to
 * and let the reader go and look at it.
 */
export type MovementRef = {
  kind: 'ticket' | 'order' | 'expense';
  /** Route id — the ticket id, the PO id, or the expense id. */
  id: string;
  /** What a person reads: ใบงาน/PO id, or the expense's POS-… number. */
  docNo: string;
  /** Customer, wholesale buyer, or what the expense was for. */
  title: string;
  /** Plate and payment type, cheque details, or expense category. */
  detail: string;
  /** Receipts stored on an expense, openable from the ledger. */
  attachments?: { fileName: string; path: string }[];
};

/** One recorded payment or expense, as it was stored. */
export type MoneyMovement = {
  shop: string;
  /** The free-text label — matched against an account's `matchNames`. */
  source: string;
  /** Positive = money in, negative = money out. */
  amount: number;
  /** ISO date; movements before an account's `openedAt` are ignored. */
  on: string;
  ref?: MovementRef;
};

export type MoneyTransfer = {
  shop: string;
  fromAccountId: number | null;
  toAccountId: number | null;
  amount: number;
  on: string;
};

type Shop = { id: string; name: string };

/**
 * ลำดับแหล่งเงินในสาขา — ที่ร้านจัดเอง แล้วตามลำดับที่สร้าง.
 *
 * `sort_order` alone is not an order: every account added through
 * เพิ่มแหล่งเงิน used to get 0, and rows that tie come back in whatever order
 * the database happens to return them — which is how เงินสดย่อย ended up at
 * the top of every branch. The id breaks the tie so the order at least holds
 * still, and the money screen now lets the shop set it. Exported so that
 * screen and the dashboard card cannot disagree about which row is first.
 */
export const byAccountOrder = (a: MoneyAccount, b: MoneyAccount): number =>
  a.sortOrder - b.sortOrder || a.id - b.id;

/**
 * ชื่อทั้งหมดที่หมายถึงบัญชีนี้ — รวมชื่อบัญชีเอง.
 *
 * `match_names` is a hand-kept list, and the name the account is DISPLAYED
 * under is the one a person picking a แหล่งเงิน sees and reaches for. Treating
 * it as a label costs nothing when it is already listed, and covers the case
 * that produced this function: an account renamed in the register while its
 * `match_names` stayed behind, so its own name stopped meaning it.
 */
const labelsOf = (a: MoneyAccount): string[] => [a.name, ...a.matchNames];

export function buildMoneySources(
  shops: Shop[],
  accounts: MoneyAccount[],
  movements: MoneyMovement[],
  transfers: MoneyTransfer[],
): MoneyOverview {
  const branches = shops
    .map((s) => {
      const mine = accounts.filter((a) => a.shop === s.id).sort(byAccountOrder);

      const balances: AccountBalance[] = mine.map((a) => {
        /*
          A label belongs to exactly one account per branch — the first that
          claims it. Two accounts naming the same label is a setup mistake, and
          splitting the money between them would hide it; giving it to one keeps
          the total right and leaves the mistake visible as an account that never
          moves.
        */
        const owns = (label: string) => mine.find((x) => labelsOf(x).includes(label))?.id === a.id;

        const rows = movements.filter(
          (m) => m.shop === s.id && m.on >= a.openedAt && owns(m.source),
        );
        const inflow = rows.filter((m) => m.amount > 0).reduce((n, m) => n + m.amount, 0);
        const outflow = rows.filter((m) => m.amount < 0).reduce((n, m) => n - m.amount, 0);

        const moved = transfers.filter((t) => t.shop === s.id && t.on >= a.openedAt);
        const transferIn = moved
          .filter((t) => t.toAccountId === a.id)
          .reduce((n, t) => n + t.amount, 0);
        const transferOut = moved
          .filter((t) => t.fromAccountId === a.id)
          .reduce((n, t) => n + t.amount, 0);

        return {
          id: a.id,
          name: a.name,
          kind: a.kind,
          accountNo: a.accountNo,
          opening: a.openingBalance,
          inflow,
          outflow,
          transferIn,
          transferOut,
          balance: a.openingBalance + inflow - outflow + transferIn - transferOut,
        };
      });

      /*
        อะไรที่ไม่เข้าบัญชีไหนเลย.

        Same two conditions the loop above applies, negated: a movement counts
        against an account only if some account claims its label AND it falls
        on or after that account's `openedAt`. A label nobody claims fails the
        first, so the earliest opening date in the branch is the fairest cutoff
        — before it, the money is already inside somebody's opening balance and
        reporting it as lost would be wrong.
      */
      const claimed = new Set(mine.flatMap(labelsOf));
      const earliest = mine.map((a) => a.openedAt).sort()[0] ?? '';
      const orphans = new Map<string, UnmatchedLabel>();
      for (const m of movements) {
        if (m.shop !== s.id) continue;
        if (!m.source) continue;
        if (claimed.has(m.source)) continue;
        if (earliest && m.on < earliest) continue;
        const row = orphans.get(m.source) ?? {
          label: m.source,
          inflow: 0,
          outflow: 0,
          count: 0,
        };
        if (m.amount > 0) row.inflow += m.amount;
        else row.outflow -= m.amount;
        row.count += 1;
        orphans.set(m.source, row);
      }

      return {
        shop: s.id,
        name: s.name,
        accounts: balances,
        total: balances.reduce((n, b) => n + b.balance, 0),
        // Biggest first: the one worth chasing is the one with money on it.
        unmatched: [...orphans.values()].sort(
          (a, b) => b.inflow + b.outflow - (a.inflow + a.outflow),
        ),
      };
    })
    .filter((b) => b.accounts.length > 0);

  return {
    branches,
    total: branches.reduce((n, b) => n + b.total, 0),
    hasUnmatched: branches.some((b) => b.unmatched.length > 0),
  };
}

/* ==========================================================================
   สมุดบัญชีแหล่งเงิน

   The register says how much is in an account. The ledger says why: every
   baht in and out, in date order, with the balance after each line and the
   document it came from — the shape of a bank statement, so it can be checked
   against one line by line.

   It is built from exactly the rules `buildMoneySources` uses (which account
   owns a label, nothing before `openedAt`) over exactly the same movements, so
   its closing balance with no period is the register figure. That equality is
   pinned by a test; if the two ever differ, one of them is wrong.
   ========================================================================== */

/** A transfer as the ledger needs it — the id and note are shown on the line. */
export type LedgerTransfer = MoneyTransfer & { id?: number; note?: string };

export type LedgerReconciliation = {
  id: number;
  accountId: number;
  countedAt: string;
  countedBalance: number;
  systemBalance: number;
  note: string;
};

export type LedgerEntryKind = 'receipt' | 'expense' | 'transfer-in' | 'transfer-out';

export type LedgerEntry = {
  key: string;
  on: string;
  kind: LedgerEntryKind;
  /** Signed: positive is เงินเพิ่ม, negative is เงินลด. */
  amount: number;
  /** The balance after this line. */
  balance: number;
  ref?: MovementRef;
  /** A transfer's other end — an account id, or null for นอกระบบ. */
  counterpartId?: number | null;
  note?: string;
};

/**
 * การกระทบยอดที่อยู่ในช่วง — a pin on the ledger, not a line that moves money.
 *
 * `systemNow` is recomputed from the ledger for the end of that day. When it no
 * longer equals `systemAtRecord`, something dated on or before the count was
 * entered or changed afterwards, and the reconciliation no longer says what it
 * said — which the screen reports instead of quietly rewriting the record.
 */
export type LedgerCount = {
  id: number;
  on: string;
  counted: number;
  systemAtRecord: number;
  systemNow: number;
  note: string;
};

export type LedgerMonth = {
  month: string;
  carriedIn: number;
  increase: number;
  decrease: number;
  carriedOut: number;
};

export type AccountLedger = {
  accountId: number;
  from: string;
  to: string;
  /** The whole period ends before the account was opened — nothing to show. */
  beforeOpening: boolean;
  /** ยอดยกมา — the balance at the start of `from`. */
  carriedIn: number;
  increase: number;
  decrease: number;
  /** ยอดยกไป — the balance at the end of `to`. */
  carriedOut: number;
  entries: LedgerEntry[];
  counts: LedgerCount[];
  /** The period month by month, for the รายปี view. */
  months: LedgerMonth[];
};

/**
 * เงินเข้าก่อนเงินออก ในวันเดียวกัน.
 *
 * The system keeps dates, not times, so the order inside a day is a choice. This
 * one never shows a balance dipping below what the day really reached — paying
 * an expense out of the cash that arrived that morning reads as it happened.
 */
const KIND_ORDER: Record<LedgerEntryKind, number> = {
  receipt: 0,
  'transfer-in': 1,
  'transfer-out': 2,
  expense: 3,
};

/** Money is summed in floating point; every figure shown is rounded to satang. */
const satang = (n: number) => Math.round(n * 100) / 100;

export function buildAccountLedger(
  accountId: number,
  accounts: MoneyAccount[],
  movements: MoneyMovement[],
  transfers: LedgerTransfer[],
  reconciliations: LedgerReconciliation[],
  from: string,
  to: string,
  /** Months after this one are left out of `months` — nothing has happened yet. */
  today = '',
): AccountLedger | null {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;

  // The same ownership rule as the register: a label belongs to the first
  // account of the branch, in the shop's order, that claims it.
  const branch = accounts.filter((a) => a.shop === account.shop).sort(byAccountOrder);
  const ownerOf = (label: string) => branch.find((x) => labelsOf(x).includes(label))?.id;

  const all: Omit<LedgerEntry, 'balance'>[] = [];
  movements.forEach((m, i) => {
    if (m.shop !== account.shop || m.on < account.openedAt) return;
    if (ownerOf(m.source) !== account.id) return;
    all.push({
      key: `m${i}`,
      on: m.on,
      kind: m.amount >= 0 ? 'receipt' : 'expense',
      amount: m.amount,
      ref: m.ref,
    });
  });
  transfers.forEach((t, i) => {
    if (t.shop !== account.shop || t.on < account.openedAt) return;
    const key = `t${t.id ?? `x${i}`}`;
    if (t.toAccountId === account.id) {
      all.push({
        key: `${key}-in`,
        on: t.on,
        kind: 'transfer-in',
        amount: t.amount,
        counterpartId: t.fromAccountId,
        note: t.note ?? '',
      });
    }
    if (t.fromAccountId === account.id) {
      all.push({
        key: `${key}-out`,
        on: t.on,
        kind: 'transfer-out',
        amount: -t.amount,
        counterpartId: t.toAccountId,
        note: t.note ?? '',
      });
    }
  });
  all.sort((a, b) =>
    a.on === b.on ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : a.on < b.on ? -1 : 1,
  );

  let running = account.openingBalance;
  let carriedIn = account.openingBalance;
  let increase = 0;
  let decrease = 0;
  const entries: LedgerEntry[] = [];
  for (const e of all) {
    running = satang(running + e.amount);
    if (from && e.on < from) {
      carriedIn = running;
      continue;
    }
    if (to && e.on > to) continue;
    entries.push({ ...e, balance: running });
    if (e.amount >= 0) increase = satang(increase + e.amount);
    else decrease = satang(decrease - e.amount);
  }

  const balanceAt = (day: string) =>
    satang(all.reduce((n, e) => (e.on <= day ? n + e.amount : n), account.openingBalance));

  const counts: LedgerCount[] = reconciliations
    .filter(
      (r) =>
        r.accountId === account.id && (!from || r.countedAt >= from) && (!to || r.countedAt <= to),
    )
    .sort((a, b) =>
      a.countedAt === b.countedAt ? a.id - b.id : a.countedAt < b.countedAt ? -1 : 1,
    )
    .map((r) => ({
      id: r.id,
      on: r.countedAt,
      counted: r.countedBalance,
      systemAtRecord: r.systemBalance,
      systemNow: balanceAt(r.countedAt),
      note: r.note,
    }));

  /*
    รายเดือนในช่วง — only from the month the account opened: before that its
    money is inside the opening balance, and twelve rows of "ยกมา 50,000" for
    months the account was not yet tracked would read as history it never had.
  */
  const months: LedgerMonth[] = [];
  if (from && to) {
    const first = [from.slice(0, 7), account.openedAt.slice(0, 7)].sort()[1];
    const lastCandidates = [to.slice(0, 7)];
    if (today) lastCandidates.push(today.slice(0, 7));
    const last = lastCandidates.sort()[0];
    let [y, m] = first.split('-').map(Number);
    let carry = carriedIn;
    // The carry into the first month is the balance at its first day, which
    // differs from `carriedIn` when the account opened inside the period.
    if (first > from.slice(0, 7)) carry = balanceAt(`${first}-00`);
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (key > last) break;
      const inMonth = entries.filter((e) => e.on.startsWith(key));
      const inc = satang(inMonth.filter((e) => e.amount >= 0).reduce((n, e) => n + e.amount, 0));
      const dec = satang(inMonth.filter((e) => e.amount < 0).reduce((n, e) => n - e.amount, 0));
      const out = satang(carry + inc - dec);
      months.push({ month: key, carriedIn: carry, increase: inc, decrease: dec, carriedOut: out });
      carry = out;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }

  return {
    accountId: account.id,
    from,
    to,
    beforeOpening: !!to && to < account.openedAt,
    carriedIn,
    increase,
    decrease,
    carriedOut: satang(carriedIn + increase - decrease),
    entries,
    counts,
    months,
  };
}
