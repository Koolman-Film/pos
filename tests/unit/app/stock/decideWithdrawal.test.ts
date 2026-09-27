import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  Two managers pressing ไม่อนุมัติ on the same ใบเบิก at once.

  Both read the row while it is still รออนุมัติ, so both pass the first check.
  The UPDATE re-checks the status in its WHERE, so only one of them changes a
  row — but the action never looked at whether it had, and the second one went
  on to put the goods back on the shelf a second time. The stock move must only
  happen for the request whose update actually took.
*/

const rpc = vi.fn();
let updatedRows: { id: number }[] = [];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  getSessionContext: async () => ({
    userId: 'u-manager',
    name: 'ผู้จัดการ',
    accessibleShopIds: ['cm'],
    canDo: () => true,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const read = {
        select: () => read,
        eq: () => read,
        single: async () => ({
          data: {
            id: 43,
            item: 'ฟิล์ม A',
            stock_id: 7,
            shop_id: 'cm',
            qty: 2,
            status: 'รออนุมัติ',
          },
          error: null,
        }),
      };
      const write = {
        eq: () => write,
        select: async () => ({ data: updatedRows, error: null }),
        then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      };
      return { ...read, update: () => write };
    },
    rpc: (...args: unknown[]) => {
      rpc(...args);
      return Promise.resolve({ error: null });
    },
  }),
}));

import { decideWithdrawalAction } from '@/app/(app)/stock/actions';

describe('decideWithdrawalAction — two decisions at once', () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  it('returns the stock when its rejection is the one that took', async () => {
    updatedRows = [{ id: 43 }];
    await decideWithdrawalAction({ id: 43, approve: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('move_stock');
  });

  it('does not return the stock again when another decision got there first', async () => {
    updatedRows = [];
    await expect(decideWithdrawalAction({ id: 43, approve: false })).rejects.toThrow(
      'ใบเบิกนี้ตัดสินไปแล้ว',
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
