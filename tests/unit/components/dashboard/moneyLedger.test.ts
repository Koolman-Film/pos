import { describe, it, expect } from 'vitest';

import {
  buildAccountLedger,
  buildMoneySources,
  type LedgerReconciliation,
  type LedgerTransfer,
  type MoneyAccount,
  type MoneyMovement,
} from '@/components/dashboard/moneyFlow';

/**
 * สมุดบัญชีแหล่งเงิน.
 *
 * The ledger explains a balance line by line. The one property that matters
 * above all others is that it explains the SAME balance the register shows —
 * a statement whose last line disagrees with the figure beside it is worse than
 * no statement.
 */

const shops = [{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }];

const base = {
  shop: 'cm',
  kind: 'bank',
  accountNo: '',
  openingBalance: 0,
  openedAt: '2026-09-01',
  matchNames: [] as string[],
  sortOrder: 1,
};
const bank: MoneyAccount = {
  ...base,
  id: 1,
  name: 'Kbank',
  matchNames: ['โอน TTB'],
  openingBalance: 50_000,
};
const cash: MoneyAccount = {
  ...base,
  id: 2,
  name: 'เงินสดหน้าร้าน',
  kind: 'cash',
  matchNames: ['เงินสด'],
  openingBalance: 5_000,
  sortOrder: 2,
};
const petty: MoneyAccount = { ...base, id: 3, name: 'เงินสดย่อย', kind: 'petty', sortOrder: 3 };
const accounts = [bank, cash, petty];

const movements: MoneyMovement[] = [
  {
    shop: 'cm',
    source: 'โอน TTB',
    amount: 6_400,
    on: '2026-09-05',
    ref: { kind: 'ticket', id: 'CM-1', docNo: 'CM-1', title: 'คุณวิภา', detail: '1กข 4455' },
  },
  {
    shop: 'cm',
    source: 'Kbank',
    amount: -2_500,
    on: '2026-09-12',
    ref: { kind: 'expense', id: '9', docNo: 'POS-CM-6909059', title: 'ค่าอาหาร', detail: '' },
  },
  // Someone else's money: another account, before opening, another branch.
  { shop: 'cm', source: 'เงินสด', amount: 1_200, on: '2026-09-05' },
  { shop: 'cm', source: 'โอน TTB', amount: 9_999, on: '2026-08-31' },
  { shop: 'lp', source: 'โอน TTB', amount: 7_777, on: '2026-09-06' },
];

const transfers: LedgerTransfer[] = [
  {
    id: 7,
    shop: 'cm',
    fromAccountId: 1,
    toAccountId: 3,
    amount: 5_000,
    on: '2026-09-12',
    note: 'เติมเงินสดย่อย',
  },
  {
    id: 8,
    shop: 'cm',
    fromAccountId: null,
    toAccountId: 1,
    amount: 7_560.72,
    on: '2026-09-12',
    note: 'เครื่องรูด',
  },
];

const counts = (systemBalance = 56_460.72): LedgerReconciliation[] => [
  {
    id: 1,
    accountId: 1,
    countedAt: '2026-09-12',
    countedBalance: 56_460.72,
    systemBalance,
    note: '',
  },
];

const ledger = (from = '', to = '', recon = counts(), today = '') =>
  buildAccountLedger(1, accounts, movements, transfers, recon, from, to, today)!;

describe('buildAccountLedger', () => {
  it('closes on exactly the balance the register shows', () => {
    const register = buildMoneySources(shops, accounts, movements, transfers).branches[0].accounts;
    expect(ledger().carriedOut).toBe(register.find((a) => a.id === 1)!.balance);
    expect(ledger().carriedOut).toBe(56_460.72);
  });

  it('carries the balance in from before the period', () => {
    const l = ledger('2026-09-06', '2026-09-30');
    expect(l.carriedIn).toBe(56_400);
    expect(l.increase).toBe(7_560.72);
    expect(l.decrease).toBe(7_500);
    expect(l.carriedOut).toBe(56_460.72);
    expect(l.entries).toHaveLength(3);
  });

  it('lists money in before money out on the same day', () => {
    const day = ledger().entries.filter((e) => e.on === '2026-09-12');
    expect(day.map((e) => e.kind)).toEqual(['transfer-in', 'transfer-out', 'expense']);
    expect(day.map((e) => e.balance)).toEqual([63_960.72, 58_960.72, 56_460.72]);
  });

  it("keeps each line's document and the other end of each transfer", () => {
    const e = ledger().entries;
    expect(e[0].ref?.docNo).toBe('CM-1');
    expect(e.find((x) => x.kind === 'transfer-out')).toMatchObject({
      counterpartId: 3,
      note: 'เติมเงินสดย่อย',
    });
    expect(e.find((x) => x.kind === 'transfer-in')?.counterpartId).toBeNull();
    expect(e.find((x) => x.kind === 'expense')?.ref?.docNo).toBe('POS-CM-6909059');
  });

  it("leaves out another account's money, another branch's, and anything before opening", () => {
    const amounts = ledger().entries.map((e) => e.amount);
    expect(amounts).not.toContain(1_200);
    expect(amounts).not.toContain(9_999);
    expect(amounts).not.toContain(7_777);
    expect(amounts).toHaveLength(4);
  });

  it('says so when the whole period is before the account was opened', () => {
    const l = ledger('2026-08-01', '2026-08-31');
    expect(l.beforeOpening).toBe(true);
    expect(l.entries).toEqual([]);
  });

  it('pins a count to the balance of its day', () => {
    expect(ledger().counts[0]).toMatchObject({ counted: 56_460.72, systemNow: 56_460.72 });
  });

  it('notices when history changed after a count was recorded', () => {
    // Recorded when the system still said 50,000 — something dated on or before
    // that day has been entered since.
    const c = ledger('', '', counts(50_000)).counts[0];
    expect(c.systemAtRecord).toBe(50_000);
    expect(c.systemNow).not.toBe(c.systemAtRecord);
  });

  it('breaks a year into months from the month the account opened, up to today', () => {
    const l = ledger('2026-01-01', '2026-12-31', counts(), '2026-09-14');
    expect(l.months).toEqual([
      {
        month: '2026-09',
        carriedIn: 50_000,
        increase: 13_960.72,
        decrease: 7_500,
        carriedOut: 56_460.72,
      },
    ]);
  });

  it('returns nothing for an account it was not given', () => {
    expect(buildAccountLedger(99, accounts, movements, transfers, [], '', '')).toBeNull();
  });
});
