import { describe, it, expect } from 'vitest';
import { itemNetPrice, ticketTotal, ticketPaid } from '@/lib/domain/tickets';

describe('itemNetPrice', () => {
  it('returns soldPrice unchanged when there is no discount', () => {
    expect(itemNetPrice({ soldPrice: 1300 })).toBe(1300);
  });
  it('applies a percent discount', () => {
    expect(itemNetPrice({ soldPrice: 1000, discountType: 'percent', discountValue: 10 })).toBe(900);
  });
  it('applies a flat-amount discount', () => {
    expect(itemNetPrice({ soldPrice: 1000, discountType: 'amount', discountValue: 300 })).toBe(700);
  });
  it('floors at 0 when the discount exceeds the price', () => {
    expect(itemNetPrice({ soldPrice: 100, discountType: 'amount', discountValue: 500 })).toBe(0);
  });
  it('floors at 0 when a percent discount exceeds 100', () => {
    expect(itemNetPrice({ soldPrice: 1000, discountType: 'percent', discountValue: 150 })).toBe(0);
  });
  it('treats a missing soldPrice as 0', () => {
    expect(itemNetPrice({} as { soldPrice: number })).toBe(0);
  });
  it('ignores a discountValue of 0 (falsy) and returns the full price', () => {
    expect(itemNetPrice({ soldPrice: 1000, discountType: 'percent', discountValue: 0 })).toBe(1000);
  });
  it('does not round fractional results', () => {
    expect(itemNetPrice({ soldPrice: 1300, discountType: 'percent', discountValue: 7.5 })).toBe(1202.5);
  });
});

describe('ticketTotal / ticketPaid', () => {
  const ticket = {
    items: [
      { soldPrice: 5100 },
      { soldPrice: 4500, discountType: 'percent' as const, discountValue: 10 },
    ],
    payments: [{ amount: 2000 }, { amount: 1000 }],
  };
  it('sums itemNetPrice across all items', () => {
    expect(ticketTotal(ticket)).toBe(5100 + 4050);
  });
  it('sums payment amounts', () => {
    expect(ticketPaid(ticket)).toBe(3000);
  });
  it('returns 0 for an empty ticket', () => {
    expect(ticketTotal({ items: [], payments: [] })).toBe(0);
    expect(ticketPaid({ items: [], payments: [] })).toBe(0);
  });
  it('treats a missing payment amount as 0', () => {
    expect(ticketPaid({ items: [], payments: [{} as { amount: number }, { amount: 500 }] })).toBe(500);
  });
});
