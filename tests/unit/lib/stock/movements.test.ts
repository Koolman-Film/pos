import { describe, it, expect } from 'vitest';

import { applyStockMovements, diffQtyMaps, sumQtyMaps } from '@/lib/stock/movements';

/**
 * The arithmetic behind automatic stock movement. Getting a sign wrong here means
 * physical inventory silently drifts from the system, so every branch is pinned.
 */

describe('sumQtyMaps', () => {
  it('adds the same product across several item maps', () => {
    expect(sumQtyMaps([{ A: 2 }, { A: 3 }])).toEqual({ A: 5 });
  });

  it('keeps distinct products separate', () => {
    expect(sumQtyMaps([{ A: 2 }, { B: 3 }])).toEqual({ A: 2, B: 3 });
  });

  it('ignores null and undefined maps', () => {
    expect(sumQtyMaps([{ A: 1 }, null, undefined])).toEqual({ A: 1 });
  });

  it('returns an empty map for no input', () => {
    expect(sumQtyMaps([])).toEqual({});
  });

  it('drops zero quantities rather than carrying an empty product', () => {
    expect(sumQtyMaps([{ A: 0 }])).toEqual({});
  });

  it('drops the empty-string product name', () => {
    // The UI can hand back a blank key while a row is half-filled.
    expect(sumQtyMaps([{ '': 5 }])).toEqual({});
  });

  it('drops non-numeric quantities instead of producing NaN', () => {
    expect(sumQtyMaps([{ A: 'x' as unknown as number, B: 2 }])).toEqual({ B: 2 });
  });

  it('coerces numeric strings, which is what an <input> yields', () => {
    expect(sumQtyMaps([{ A: '3' as unknown as number }])).toEqual({ A: 3 });
  });

  it('keeps a negative total (a downward revision)', () => {
    expect(sumQtyMaps([{ A: 3 }, { A: -5 }])).toEqual({ A: -2 });
  });
});

describe('diffQtyMaps', () => {
  it('reports an increase as a positive delta', () => {
    expect(diffQtyMaps({ A: 2 }, { A: 5 })).toEqual({ A: 3 });
  });

  it('reports a decrease as a negative delta', () => {
    expect(diffQtyMaps({ A: 5 }, { A: 2 })).toEqual({ A: -3 });
  });

  it('omits products that did not change', () => {
    expect(diffQtyMaps({ A: 5, B: 1 }, { A: 5, B: 2 })).toEqual({ B: 1 });
  });

  it('treats a newly added product as its whole quantity consumed', () => {
    expect(diffQtyMaps({}, { A: 4 })).toEqual({ A: 4 });
  });

  it('returns a removed product to stock in full', () => {
    // The product was on the ticket and is now gone: give all of it back.
    expect(diffQtyMaps({ A: 4 }, {})).toEqual({ A: -4 });
  });

  it('is empty when nothing changed', () => {
    expect(diffQtyMaps({ A: 1 }, { A: 1 })).toEqual({});
  });

  it('handles both sides empty', () => {
    expect(diffQtyMaps({}, {})).toEqual({});
  });

  it('handles simultaneous add, remove and change', () => {
    expect(diffQtyMaps({ A: 2, B: 3 }, { B: 1, C: 7 })).toEqual({ A: -2, B: -2, C: 7 });
  });

  it('round-trips: applying a delta then its inverse nets to nothing', () => {
    const before = { A: 3, B: 2 };
    const after = { A: 5, C: 1 };
    const forward = diffQtyMaps(before, after);
    const backward = diffQtyMaps(after, before);
    for (const key of new Set([...Object.keys(forward), ...Object.keys(backward)])) {
      expect((forward[key] ?? 0) + (backward[key] ?? 0)).toBe(0);
    }
  });
});

describe('wholesale net quantity (sold minus returned)', () => {
  // The wholesale action composes the same two helpers to get net-per-product,
  // which is the prototype's origSold/origReturned pairing (:2694-2701).
  const net = (sold: Record<string, number>, returned: Record<string, number>) =>
    diffQtyMaps(sumQtyMaps([returned]), sumQtyMaps([sold]));

  it('nets a partial return against the sale', () => {
    expect(net({ A: 10 }, { A: 2 })).toEqual({ A: 8 });
  });

  it('nets to nothing when everything is returned', () => {
    expect(net({ A: 10 }, { A: 10 })).toEqual({});
  });

  it('goes negative when more is returned than sold on this PO', () => {
    // Legitimate: a customer returns goods from an earlier order against this one.
    expect(net({ A: 2 }, { A: 5 })).toEqual({ A: -3 });
  });

  it('ignores a return naming a product that is not on the order', () => {
    expect(net({ A: 5 }, { Z: 1 })).toEqual({ A: 5, Z: -1 });
  });
});

/**
 * `applyStockMovements` used to read `qty` into JavaScript, subtract, and write
 * the result back — a lost update the moment two people saved at once. It now
 * hands the database a relative change, and reports the products it could not
 * find instead of skipping them in silence.
 */
describe('applyStockMovements', () => {
  type Change = { id: number; change: number };

  /** A Supabase double: enough of the chain to see what the call would send. */
  function fakeSupabase(rows: { id: number; name: string; qty: number }[]) {
    const rpcCalls: { fn: string; args: { p_changes: Change[]; p_kind?: string } }[] = [];
    const inserted: Record<string, unknown>[][] = [];
    const supabase = {
      from(table: string) {
        if (table === 'withdrawals') {
          return {
            insert(payload: Record<string, unknown>[]) {
              inserted.push(payload);
              return Promise.resolve({ error: null });
            },
          };
        }
        const q = {
          select: () => q,
          eq: () => q,
          in: () => q,
          order: () => Promise.resolve({ data: rows }),
        };
        return q;
      },
      rpc(fn: string, args: { p_changes: Change[]; p_kind?: string }) {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ error: null });
      },
    };
    return { supabase, rpcCalls, inserted };
  }

  const source = { kind: 'ใบงาน', documentId: 'JT-CM-00216', by: 'ผู้ทดสอบ', shopId: 'cm' };

  it('sends a relative change so two concurrent saves both land', async () => {
    const { supabase, rpcCalls } = fakeSupabase([{ id: 7, name: 'ฟิล์ม A', qty: 10 }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyStockMovements(supabase as any, { 'ฟิล์ม A': 2 }, source);

    // One call moves the quantity AND writes the ledger entry (migration 0026).
    expect(rpcCalls[0].fn).toBe('move_stock');
    // A change of -2, NOT the computed result 8. The row's own value decides.
    expect(rpcCalls[0].args.p_changes).toEqual([{ id: 7, change: -2 }]);
    expect(rpcCalls[0].args.p_kind).toBe('ใบงาน');
  });

  it('adds back what a negative delta returns to the shelf', async () => {
    const { supabase, rpcCalls } = fakeSupabase([{ id: 7, name: 'ฟิล์ม A', qty: 10 }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyStockMovements(supabase as any, { 'ฟิล์ม A': -3 }, source);
    expect(rpcCalls[0].args.p_changes).toEqual([{ id: 7, change: 3 }]);
  });

  it('names the products it could not find instead of skipping them quietly', async () => {
    const { supabase, rpcCalls, inserted } = fakeSupabase([{ id: 7, name: 'ฟิล์ม A', qty: 10 }]);
    const result = await applyStockMovements(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      { 'ฟิล์ม A': 1, ฟิล์มที่ถูกเปลี่ยนชื่อ: 2 },
      source,
    );

    // A renamed product is the usual cause, and it has to reach a human.
    expect(result.unmatched).toEqual(['ฟิล์มที่ถูกเปลี่ยนชื่อ']);
    // Only the one that exists moves, and only it gets a ledger entry — there
    // is nothing honest to write about a quantity that never moved.
    expect(rpcCalls[0].args.p_changes).toEqual([{ id: 7, change: -1 }]);
    expect(inserted).toHaveLength(0);
  });

  it('takes the oldest row when a branch still has two of one name', async () => {
    // Migration 0025 adds a unique index; this is the rule for data older than it.
    const { supabase, rpcCalls } = fakeSupabase([
      { id: 4, name: 'ฟิล์ม A', qty: 10 },
      { id: 9, name: 'ฟิล์ม A', qty: 3 },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyStockMovements(supabase as any, { 'ฟิล์ม A': 1 }, source);
    expect(rpcCalls[0].args.p_changes).toEqual([{ id: 4, change: -1 }]);
  });

  it('does nothing at all when there is no movement', async () => {
    const { supabase, rpcCalls, inserted } = fakeSupabase([{ id: 7, name: 'ฟิล์ม A', qty: 10 }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await applyStockMovements(supabase as any, {}, source);
    expect(result.unmatched).toEqual([]);
    expect(rpcCalls).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });
});
