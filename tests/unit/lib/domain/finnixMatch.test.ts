import { describe, it, expect } from 'vitest';

import { matchFinnixMoney } from '@/lib/domain/finnixMatch';
import type { PayAccount } from '@/lib/domain/payAccount';

/**
 * จับคู่รายได้ Finnix กับแหล่งเงินที่รับเงินไว้จริง (ร้านขอ 25 ก.ย. 2569).
 *
 * The lines say what was sold and whose it was; the accounts say where the
 * money went. The gap between them is somebody's job — and it was invisible
 * until an account could say whose money it holds.
 */

const acc = (over: Partial<PayAccount>): PayAccount => ({
  id: 1,
  shop: 'cm',
  name: 'เงินสดหน้าร้าน',
  kind: 'cash',
  accountNo: '',
  owner: 'สาขา',
  matchNames: [],
  ...over,
});

const accounts = [
  acc({ id: 1 }),
  acc({ id: 2, name: 'K-bank ดูลมาน', kind: 'bank' }),
  acc({ id: 3, name: 'เงิน FINNIX - Kbank', kind: 'bank', owner: 'Finnix' }),
  acc({ id: 4, name: 'บัญชีสาขาอื่น', shop: 'lp' }),
];

const run = (
  items: { soldPrice: number; revenueKind?: string }[],
  payments: { amount: number; method: string }[],
) => matchFinnixMoney({ items, payments, accounts, shop: 'cm' });

const SOLD = [
  { soldPrice: 6000, revenueKind: 'รายได้' },
  { soldPrice: 4000, revenueKind: 'รับแทน' },
];

describe('matchFinnixMoney', () => {
  it('บอกว่าตรงกัน เมื่อเงินเข้าถูกบัญชีทั้งสองฝั่ง', () => {
    const m = run(SOLD, [
      { amount: 6000, method: 'เงินสดหน้าร้าน' },
      { amount: 4000, method: 'เงิน FINNIX - Kbank' },
    ]);
    expect(m).toMatchObject({
      soldOwn: 6000,
      soldFinnix: 4000,
      paidOwn: 6000,
      paidFinnix: 4000,
      settled: true,
      owedToFinnix: 0,
    });
  });

  it('บอกยอดที่ต้องโอนคืน เมื่อเงินของ Finnix เข้าบัญชีสาขา', () => {
    const m = run(SOLD, [
      { amount: 7000, method: 'เงินสดหน้าร้าน' },
      { amount: 3000, method: 'เงิน FINNIX - Kbank' },
    ]);
    // Finnix sold 4,000 but only 3,000 reached its account.
    expect(m.owedToFinnix).toBe(1000);
    // The sale itself does not move: the branch still sold 6,000 of its own.
    expect(m.soldOwn).toBe(6000);
  });

  it('บอกทิศกลับกัน เมื่อบัญชี Finnix รับไว้เกิน', () => {
    const m = run(SOLD, [{ amount: 10000, method: 'เงิน FINNIX - Kbank' }]);
    expect(m.owedToFinnix).toBe(-6000);
  });

  it('ยังจ่ายไม่ครบ ยังไม่เรียกว่าไม่ตรง', () => {
    // Two sides cannot agree mid-payment, and saying so on every deposit is
    // noise. `settled` is what the screen checks before it speaks.
    const m = run(SOLD, [{ amount: 5000, method: 'เงินสดหน้าร้าน' }]);
    expect(m.settled).toBe(false);
  });

  it('ไม่เดาแทนแหล่งเงินที่ไม่รู้จัก', () => {
    // Assuming an unrecognised label is the branch's is how a mistake becomes
    // a number nobody questions.
    const m = run(SOLD, [{ amount: 10000, method: 'โอนเข้าบัญชีเก่า' }]);
    expect(m).toMatchObject({ paidOwn: 0, paidFinnix: 0, paidUnknown: 10000 });
    expect(m.owedToFinnix).toBe(4000);
  });

  it('หาบัญชีเจอจากชื่อเดิมที่ผูกไว้ เหมือนที่ยอดคงเหลือหา', () => {
    const m = matchFinnixMoney({
      items: SOLD,
      payments: [{ amount: 4000, method: 'โอน Finnix' }],
      accounts: [
        ...accounts.slice(0, 2),
        acc({ id: 3, name: 'เงิน FINNIX - Kbank', owner: 'Finnix', matchNames: ['โอน Finnix'] }),
      ],
      shop: 'cm',
    });
    expect(m.paidFinnix).toBe(4000);
  });

  it('ไม่หยิบบัญชีของสาขาอื่นมาใช้', () => {
    const m = run(SOLD, [{ amount: 1000, method: 'บัญชีสาขาอื่น' }]);
    expect(m.paidUnknown).toBe(1000);
  });

  it('ใบงานที่ไม่มีรายการของ Finnix ไม่มีอะไรต้องจับคู่', () => {
    const m = run(
      [{ soldPrice: 6000, revenueKind: 'รายได้' }],
      [{ amount: 6000, method: 'เงินสดหน้าร้าน' }],
    );
    expect(m).toMatchObject({ soldFinnix: 0, owedToFinnix: 0, settled: true });
  });
});

/**
 * ใบงานเดิมไม่ถูกนำมาจับคู่ (ร้านขอ 25 ก.ย. 2569, migration 0070).
 *
 * A job opened before the shop marked its Finnix accounts was recorded under
 * rules that did not include this one, and its money was settled by hand at the
 * time. Judging it now would put a red box on work nobody is going to redo.
 */
describe('matchFinnixMoney — เฉพาะใบงานที่เปิดหลังตั้งค่า', () => {
  const stamped = accounts.map((a) => ({ ...a, ownerSetAt: '2026-09-25T00:00:00Z' }));
  const wrongAccount = [{ amount: 10000, method: 'เงินสดหน้าร้าน' }];

  const at = (ticketCreatedAt?: string) =>
    matchFinnixMoney({
      items: SOLD,
      payments: wrongAccount,
      accounts: stamped,
      shop: 'cm',
      ticketCreatedAt,
    });

  it('ใบงานที่เปิดก่อนวันตั้งค่า ไม่ถูกจับคู่', () => {
    const m = at('2026-09-01T10:00:00Z');
    expect(m.inScope).toBe(false);
    // The numbers are still computed; the screen is what stays quiet.
    expect(m.owedToFinnix).toBe(4000);
  });

  it('ใบงานที่เปิดหลังวันตั้งค่า ถูกจับคู่ตามปกติ', () => {
    expect(at('2026-09-26T10:00:00Z').inScope).toBe(true);
  });

  it('ใบงานใหม่ที่ยังไม่ได้บันทึก ถือว่าใหม่ที่สุด', () => {
    expect(at(undefined).inScope).toBe(true);
  });

  it('สาขาที่ยังไม่เคยตั้งค่าเจ้าของบัญชี ไม่ปิดกั้นใบงานไหน', () => {
    // Nothing stamped means nothing to compare against, not "everything old".
    const m = matchFinnixMoney({
      items: SOLD,
      payments: wrongAccount,
      accounts,
      shop: 'cm',
      ticketCreatedAt: '2020-01-01T00:00:00Z',
    });
    expect(m.inScope).toBe(true);
  });
});
