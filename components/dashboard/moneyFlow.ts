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

export type BranchMoney = {
  shop: string;
  name: string;
  accounts: AccountBalance[];
  /** Every account added up — a real figure now, so the card may show it. */
  total: number;
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

/** One recorded payment or expense, as it was stored. */
export type MoneyMovement = {
  shop: string;
  /** The free-text label — matched against an account's `matchNames`. */
  source: string;
  /** Positive = money in, negative = money out. */
  amount: number;
  /** ISO date; movements before an account's `openedAt` are ignored. */
  on: string;
};

export type MoneyTransfer = {
  shop: string;
  fromAccountId: number | null;
  toAccountId: number | null;
  amount: number;
  on: string;
};

type Shop = { id: string; name: string };

export function buildMoneySources(
  shops: Shop[],
  accounts: MoneyAccount[],
  movements: MoneyMovement[],
  transfers: MoneyTransfer[],
): MoneyOverview {
  const branches = shops
    .map((s) => {
      const mine = accounts
        .filter((a) => a.shop === s.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const balances: AccountBalance[] = mine.map((a) => {
        /*
          A label belongs to exactly one account per branch — the first that
          claims it. Two accounts naming the same label is a setup mistake, and
          splitting the money between them would hide it; giving it to one keeps
          the total right and leaves the mistake visible as an account that never
          moves.
        */
        const owns = (label: string) => mine.find((x) => x.matchNames.includes(label))?.id === a.id;

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

      return {
        shop: s.id,
        name: s.name,
        accounts: balances,
        total: balances.reduce((n, b) => n + b.balance, 0),
      };
    })
    .filter((b) => b.accounts.length > 0);

  return { branches, total: branches.reduce((n, b) => n + b.total, 0) };
}
