import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  One receipt, two expenses.

  An expense submitted with several lines stores its receipt ONCE and gives every
  line its own attachment row pointing at the same object. Deleting one of those
  lines — or removing the receipt from one of them — used to delete the object
  itself, so the other lines kept a row that pointed at nothing and their proof
  was gone. The object may only go when no attachment row still refers to it.
*/

type Row = { id: number; expense_id: number; storage_path: string };
let rows: Row[] = [];
const removed: string[][] = [];

function table(name: string) {
  let filters: ((r: Row) => boolean)[] = [];
  const api = {
    select: () => api,
    eq: (col: keyof Row | 'id', v: unknown) => {
      filters.push((r) => (r as Record<string, unknown>)[col] === v);
      return api;
    },
    in: (col: keyof Row, vs: unknown[]) => {
      filters.push((r) => vs.includes((r as Record<string, unknown>)[col]));
      return api;
    },
    maybeSingle: async () => ({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null }),
    delete: () => {
      const del = {
        eq: async (col: string, v: unknown) => {
          if (name === 'expense_attachments') {
            rows = rows.filter((r) => (r as Record<string, unknown>)[col] !== v);
          } else if (name === 'expenses') {
            rows = rows.filter((r) => r.expense_id !== v);
          }
          return { error: null };
        },
      };
      return del;
    },
    then: (resolve: (v: { data: Row[]; error: null }) => void) => {
      const data = rows.filter((r) => filters.every((f) => f(r)));
      filters = [];
      resolve({ data, error: null });
    },
  };
  return api;
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  getSessionContext: async () => ({
    userId: 'u-acc',
    name: 'บัญชี',
    accessibleShopIds: ['cm'],
    canDo: () => true,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (name: string) => table(name),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));

import { deleteExpense, deleteExpenseAttachment } from '@/app/(app)/accounting/actions';

beforeEach(() => {
  removed.length = 0;
  rows = [
    { id: 1, expense_id: 10, storage_path: 'cm/shared-receipt.pdf' },
    { id: 2, expense_id: 11, storage_path: 'cm/shared-receipt.pdf' },
    { id: 3, expense_id: 11, storage_path: 'cm/only-mine.jpg' },
  ];
});

describe('a receipt shared by several expense lines', () => {
  it('survives deleting one of the expenses that share it', async () => {
    await deleteExpense(10);
    expect(removed.flat()).not.toContain('cm/shared-receipt.pdf');
  });

  it('survives removing it from one of the expenses', async () => {
    await deleteExpenseAttachment(1);
    expect(removed.flat()).not.toContain('cm/shared-receipt.pdf');
  });

  it('is removed once the last expense referring to it is gone', async () => {
    await deleteExpense(10);
    await deleteExpense(11);
    expect(removed.flat()).toContain('cm/shared-receipt.pdf');
    expect(removed.flat()).toContain('cm/only-mine.jpg');
  });

  it('still removes a receipt that belonged to one expense only', async () => {
    await deleteExpenseAttachment(3);
    expect(removed.flat()).toEqual(['cm/only-mine.jpg']);
  });
});
