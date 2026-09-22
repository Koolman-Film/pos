import { describe, it, expect } from 'vitest';

import {
  defaultPayMethod,
  payableAccounts,
  payAccountLine,
  type PayAccount,
} from '@/lib/domain/payAccount';

/**
 * บัญชีรับชำระ (ร้านขอ 21 ก.ย. 2569) — which แหล่งเงิน a ใบแจ้งหนี้ or a
 * ใบเสนอราคา may send a customer to, and how it reads on paper.
 */

const acc = (over: Partial<PayAccount>): PayAccount => ({
  id: 1,
  shop: 'north',
  name: 'กสิกร ออมทรัพย์',
  kind: 'bank',
  accountNo: '236-1-38053-6',
  ...over,
});

describe('payableAccounts', () => {
  const all = [
    acc({ id: 1 }),
    acc({ id: 2, name: 'เงินสดหน้าร้าน', kind: 'cash', accountNo: '' }),
    acc({ id: 3, name: 'เงินสดย่อย', kind: 'petty', accountNo: '' }),
    acc({ id: 4, name: 'บัตรเครดิตบริษัท', kind: 'credit', accountNo: '' }),
    acc({ id: 5, shop: 'cm' }),
  ];

  it('offers the branch’s bank accounts and its counter cash', () => {
    expect(payableAccounts(all, 'north').map((a) => a.id)).toEqual([1, 2]);
  });

  it('never offers another branch’s account', () => {
    expect(payableAccounts(all, 'north').some((a) => a.shop !== 'north')).toBe(false);
  });
});

describe('payAccountLine', () => {
  it('prints the name and the number the customer transfers to', () => {
    expect(payAccountLine(acc({}))).toBe('กสิกร ออมทรัพย์ · เลขที่บัญชี 236-1-38053-6');
  });

  it('prints just the name when there is no number', () => {
    expect(payAccountLine(acc({ name: 'เงินสดหน้าร้าน', accountNo: '' }))).toBe('เงินสดหน้าร้าน');
  });
});

describe('defaultPayMethod', () => {
  const accounts = [
    acc({ id: 1, name: 'กสิกร ออมทรัพย์' }),
    acc({ id: 2, name: 'เงินสดหน้าร้าน', kind: 'cash', accountNo: '' }),
    acc({ id: 3, name: 'เงินสดย่อย', kind: 'petty', accountNo: '' }),
  ];

  it('starts a new payment on the branch’s counter cash', () => {
    expect(defaultPayMethod(accounts, 'north')).toBe('เงินสดหน้าร้าน');
  });

  it('falls back to its first account a customer can pay into', () => {
    expect(defaultPayMethod([accounts[0], accounts[2]], 'north')).toBe('กสิกร ออมทรัพย์');
  });

  it('leaves it empty for a branch with no accounts, rather than inventing a word', () => {
    expect(defaultPayMethod(accounts, 'cm')).toBe('');
  });
});
