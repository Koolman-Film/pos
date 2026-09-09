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
