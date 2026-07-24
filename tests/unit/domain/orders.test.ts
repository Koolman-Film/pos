import { describe, it, expect } from 'vitest';
import { orderTotal, orderPaid } from '@/lib/domain/orders';

describe('orderTotal', () => {
  it('subtracts returns and adjustments from the items total', () => {
    const order = {
      items: [
        { name: 'A', qty: 10, requestedPrice: 1000 },
        { name: 'B', qty: 8, requestedPrice: 1500 },
      ],
      returns: [{ item: 'A', qty: 2 }],
      adjustments: [{ amount: 200 }],
    };
    // items: 10*1000 + 8*1500 = 22000; returns: 2*1000 = 2000; adjustments: 200
    expect(orderTotal(order)).toBe(22000 - 2000 - 200);
  });
  it('ignores a return referencing an item not on the order', () => {
    const order = {
      items: [{ name: 'A', qty: 1, requestedPrice: 100 }],
      returns: [{ item: 'ghost', qty: 5 }],
      adjustments: [],
    };
    expect(orderTotal(order)).toBe(100);
  });
  it('prices a return at the FIRST matching item name (prototype uses find)', () => {
    const order = {
      items: [
        { name: 'A', qty: 1, requestedPrice: 100 },
        { name: 'A', qty: 1, requestedPrice: 900 },
      ],
      returns: [{ item: 'A', qty: 1 }],
      adjustments: [],
    };
    // 1000 total, return priced off the first 'A' (100), not the second
    expect(orderTotal(order)).toBe(1000 - 100);
  });
  it('sums multiple adjustments and treats a missing amount as 0', () => {
    const order = {
      items: [{ name: 'A', qty: 1, requestedPrice: 1000 }],
      returns: [],
      adjustments: [{ amount: 100 }, {} as { amount: number }, { amount: 50 }],
    };
    expect(orderTotal(order)).toBe(1000 - 150);
  });
  it('tolerates a missing adjustments array', () => {
    const order = {
      items: [{ name: 'A', qty: 2, requestedPrice: 250 }],
      returns: [],
    } as unknown as Parameters<typeof orderTotal>[0];
    expect(orderTotal(order)).toBe(500);
  });
  it('returns 0 for an empty order', () => {
    expect(orderTotal({ items: [], returns: [], adjustments: [] })).toBe(0);
  });
});

describe('orderPaid', () => {
  it('sums payment amounts', () => {
    expect(orderPaid({ payments: [{ amount: 5000 }, { amount: 400 }] })).toBe(5400);
  });
  it('returns 0 when there are no payments', () => {
    expect(orderPaid({ payments: [] })).toBe(0);
  });
});
