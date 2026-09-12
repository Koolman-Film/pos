import { describe, it, expect } from 'vitest';

import {
  buildMoneySources,
  type MoneyAccount,
  type MoneyMovement,
  type MoneyTransfer,
} from '@/components/dashboard/moneyFlow';

/**
 * แหล่งเงิน — ยอดคงเหลือจริง.
 *
 * Before migration 0043 the dashboard could only report movement: it knew what
 * came in and what went out since the day it was switched on, and nothing about
 * what the bank already held or about cash being banked. An opening balance per
 * account and transfers between accounts are what make a real balance possible,
 * and this pins the arithmetic that uses them.
 */

const shops = [{ id: 'cm', name: 'FINNIX เชียงใหม่' }];

const account = (over: Partial<MoneyAccount>): MoneyAccount => ({
  id: 1,
  shop: 'cm',
  name: 'Kbank',
  kind: 'bank',
  accountNo: '123-4-56789',
  openingBalance: 0,
  openedAt: '2026-09-01',
  matchNames: [],
  sortOrder: 1,
  ...over,
});

const bank = account({ id: 1, name: 'Kbank', matchNames: ['โอน TTB', 'บัญชีธนาคารสาขา'] });
const cash = account({
  id: 2,
  name: 'เงินสดหน้าร้าน',
  kind: 'cash',
  matchNames: ['เงินสด'],
  sortOrder: 2,
});
const petty = account({
  id: 3,
  name: 'เงินสดย่อย',
  kind: 'petty',
  matchNames: ['เงินสดย่อย'],
  sortOrder: 3,
});

const only = (accounts: MoneyAccount[], m: MoneyMovement[] = [], t: MoneyTransfer[] = []) =>
  buildMoneySources(shops, accounts, m, t).branches[0];

describe('buildMoneySources', () => {
  it('starts from the opening balance the shop reconciled to', () => {
    const b = only([{ ...bank, openingBalance: 50_000 }]);
    expect(b.accounts[0].balance).toBe(50_000);
    expect(b.total).toBe(50_000);
  });

  it('adds receipts and subtracts payments, matched by label', () => {
    const b = only(
      [{ ...bank, openingBalance: 50_000 }],
      [
        { shop: 'cm', source: 'โอน TTB', amount: 6_400, on: '2026-09-05' },
        { shop: 'cm', source: 'บัญชีธนาคารสาขา', amount: -35_000, on: '2026-09-06' },
      ],
    );
    expect(b.accounts[0].inflow).toBe(6_400);
    expect(b.accounts[0].outflow).toBe(35_000);
    expect(b.accounts[0].balance).toBe(21_400);
  });

  it('ignores anything dated before the opening balance was taken', () => {
    // The opening figure already contains that money. Counting the transaction
    // on top of it would bank the same baht twice.
    const b = only(
      [{ ...bank, openingBalance: 50_000, openedAt: '2026-09-01' }],
      [{ shop: 'cm', source: 'โอน TTB', amount: 9_999, on: '2026-08-31' }],
    );
    expect(b.accounts[0].balance).toBe(50_000);
  });

  it('moves money between accounts without changing the total', () => {
    // Banking the day's cash: the business is no richer, the money is elsewhere.
    const b = only(
      [
        { ...bank, openingBalance: 10_000 },
        { ...cash, openingBalance: 8_000 },
      ],
      [],
      [{ shop: 'cm', fromAccountId: 2, toAccountId: 1, amount: 5_000, on: '2026-09-07' }],
    );
    const byId = (id: number) => b.accounts.find((a) => a.id === id)!;
    expect(byId(1).balance).toBe(15_000);
    expect(byId(2).balance).toBe(3_000);
    expect(b.total).toBe(18_000);
  });

  it('counts a transfer with one open end, for money entering or leaving the register', () => {
    // A เงินสดย่อย top-up recorded before anyone said where it came from.
    const b = only(
      [petty],
      [],
      [{ shop: 'cm', fromAccountId: null, toAccountId: 3, amount: 10_000, on: '2026-09-02' }],
    );
    expect(b.accounts[0].transferIn).toBe(10_000);
    expect(b.accounts[0].balance).toBe(10_000);
  });

  it('gives a label to one account only, so a setup mistake cannot double the money', () => {
    const rival = account({ id: 9, name: 'Kbank สำรอง', matchNames: ['โอน TTB'], sortOrder: 9 });
    const b = only(
      [bank, rival],
      [{ shop: 'cm', source: 'โอน TTB', amount: 1_000, on: '2026-09-05' }],
    );
    expect(b.total).toBe(1_000);
    expect(b.accounts.find((a) => a.id === 9)!.balance).toBe(0);
  });

  it('keeps the accounts in the order the branch set', () => {
    const b = only([petty, bank, cash]);
    expect(b.accounts.map((a) => a.name)).toEqual(['Kbank', 'เงินสดหน้าร้าน', 'เงินสดย่อย']);
  });

  it('drops a branch with no accounts rather than printing an empty heading', () => {
    expect(buildMoneySources(shops, [], [], []).branches).toEqual([]);
  });
});

/**
 * ยอดคงเหลือ ต้องไม่รวม ค้างรับ และ ค้างจ่าย.
 *
 * A ticket invoiced and unpaid is revenue; a bill accepted and unpaid is a cost.
 * Neither has moved a baht, and this card counts where money IS — so both stay
 * out. The page feeds in recorded payments and expenses already marked จ่ายแล้ว,
 * and this pins the consequence rather than trusting the caller to keep doing it.
 */
describe('balances follow money that actually moved', () => {
  const bankOnly = account({
    id: 1,
    matchNames: ['โอน TTB', 'บัญชีธนาคารสาขา'],
    openingBalance: 100_000,
  });

  it('counts a payment that was received', () => {
    const b = only(
      [bankOnly],
      [{ shop: 'cm', source: 'โอน TTB', amount: 5_000, on: '2026-09-05' }],
    );
    expect(b.accounts[0].balance).toBe(105_000);
  });

  it('does not move on an unpaid bill, however large', () => {
    // The 108,400 salary bill sitting in ค้างจ่าย has left nobody's account. It
    // reaches this function only once it is paid, which is when it is real.
    const b = only([bankOnly], []);
    expect(b.accounts[0].balance).toBe(100_000);
    expect(b.accounts[0].outflow).toBe(0);
  });

  it('ignores a label no account claims, rather than guessing', () => {
    // ค้างรับ has no payment method, so nothing about it can match an account.
    // A stray label must not silently land on the first account either.
    const b = only(
      [bankOnly],
      [{ shop: 'cm', source: 'เงินสด', amount: 40_900, on: '2026-09-05' }],
    );
    expect(b.accounts[0].balance).toBe(100_000);
    expect(b.total).toBe(100_000);
  });

  /*
    ชื่อบัญชีตัวมันเอง ก็คือชื่อที่ใช้จับคู่ได้.

    `match_names` is kept by hand and the account gets renamed in the register
    without it. Its own name meaning it costs nothing and covers that.
  */
  it('matches a movement against the account\u2019s own name', () => {
    const b = only(
      [account({ id: 9, name: 'K-bank คูลมาน เชียงใหม่', matchNames: [], openingBalance: 10_000 })],
      [{ shop: 'cm', source: 'K-bank คูลมาน เชียงใหม่', amount: -2_500, on: '2026-09-05' }],
    );
    expect(b.accounts[0].outflow).toBe(2_500);
    expect(b.accounts[0].balance).toBe(7_500);
    expect(b.unmatched).toEqual([]);
  });
});

/**
 * แหล่งเงินที่ยังไม่ได้ผูกกับบัญชี.
 *
 * The failure this exists for: an expense is saved against a แหล่งเงิน label
 * that no account claims — a new entry in the dropdown, or an account renamed
 * out from under one. The expense saves, the list shows it, and it lands in no
 * balance. Nothing errors; the money is just quietly absent from the figure the
 * shop reconciles against its bank statement.
 */
describe('buildMoneySources — แหล่งเงินที่ยังไม่มีเจ้าของ', () => {
  it('reports an expense label no account claims, with its amount', () => {
    const b = only(
      [account({ id: 1, name: 'K-bank คูลมาน เชียงใหม่', openingBalance: 10_000 })],
      [
        { shop: 'cm', source: 'K-bank เลขที่ 186-3-69345-0', amount: -2_500, on: '2026-09-10' },
        { shop: 'cm', source: 'K-bank เลขที่ 186-3-69345-0', amount: -5_000, on: '2026-09-11' },
      ],
    );
    // The balance is still wrong — nothing is invented — but the shortfall is
    // now reported instead of being invisible.
    expect(b.accounts[0].balance).toBe(10_000);
    expect(b.unmatched).toEqual([
      { label: 'K-bank เลขที่ 186-3-69345-0', inflow: 0, outflow: 7_500, count: 2 },
    ]);
  });

  it('says nothing when every label has a home', () => {
    const b = only(
      [bank, cash],
      [{ shop: 'cm', source: 'เงินสด', amount: 1_200, on: '2026-09-05' }],
    );
    expect(b.unmatched).toEqual([]);
    expect(buildMoneySources(shops, [bank, cash], [], []).hasUnmatched).toBe(false);
  });

  it('does not report movements from before any account was opened', () => {
    // That money is already inside somebody’s opening balance. Calling it lost
    // would send the bookkeeper looking for a problem that is not there.
    const b = only(
      [account({ openedAt: '2026-09-01' })],
      [{ shop: 'cm', source: 'บัญชีเก่าที่เลิกใช้', amount: -9_999, on: '2026-08-20' }],
    );
    expect(b.unmatched).toEqual([]);
  });

  it('flags the overview so the dashboard card can warn', () => {
    const out = buildMoneySources(
      shops,
      [bank],
      [{ shop: 'cm', source: 'ไม่มีใครรับ', amount: -100, on: '2026-09-05' }],
      [],
    );
    expect(out.hasUnmatched).toBe(true);
  });

  it('puts the label with the most money on it first', () => {
    // Two orphans is two jobs; the one worth doing first is the expensive one.
    const b = only(
      [bank],
      [
        { shop: 'cm', source: 'เล็ก', amount: -100, on: '2026-09-05' },
        { shop: 'cm', source: 'ใหญ่', amount: -90_000, on: '2026-09-05' },
      ],
    );
    expect(b.unmatched.map((u) => u.label)).toEqual(['ใหญ่', 'เล็ก']);
  });
});
