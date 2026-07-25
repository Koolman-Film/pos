'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

import type {
  ExportPayload,
  NewExpenseInput,
  TopupInput,
  UpdateExpenseInput,
} from '@/components/accounting/AccountingModule';

/**
 * Accounting Server Actions. Port of the prototype's `addExpense`, `addTopup`,
 * `saveEditExpense`, `deleteExpense` and `exportExcel`
 * (reference/v0.4/finnix-film.html:3584-3628).
 *
 * C2 — proxy auth is optimistic only; every Server Action is a bare POST to this
 * route and any client can call it without ever rendering the gated UI, so each
 * one re-verifies the caller independently of `proxy.ts` and the UI gate:
 *   - `getSessionContext()` IS the auth check (revalidates against the Supabase
 *     auth server; redirects unauthenticated/unregistered/suspended callers).
 *   - `session.canDo(<capability>)` re-checks the capability server-side.
 * RLS (Task 7) remains the final backstop, not the only check. The edit and
 * delete actions gate on `accounting.addExpense` — the same capability the
 * prototype's row edit/delete controls sit behind.
 */

export async function addExpense(input: NewExpenseInput): Promise<void> {
  const session = await getSessionContext();
  if (!session.canDo('accounting.addExpense')) throw new Error('forbidden');

  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const rows = input.lines
    .filter((l) => l.desc.trim() || l.category || Number(l.amount) > 0)
    .map((l) => ({
      shop_id: input.shop,
      description: l.desc,
      category: l.category,
      source: input.source,
      amount: Number(l.amount || 0),
      status: input.status,
      // A paid expense is dated now; a pending one carries no paid date yet.
      paid_at: input.status === 'จ่ายแล้ว' ? nowIso : null,
    }));
  if (rows.length === 0) return;

  const { error } = await supabase.from('expenses').insert(rows);
  if (error) throw error;

  revalidatePath('/accounting');
}

export async function topupCash(input: TopupInput): Promise<void> {
  const session = await getSessionContext();
  if (!session.canDo('accounting.topupCash')) throw new Error('forbidden');

  const supabase = await createClient();
  const { error } = await supabase.from('petty_cash').insert({
    shop_id: input.shop,
    type: 'เติมเงิน',
    amount: Number(input.amount),
    note: input.note || 'เติมเงินสดย่อย',
    entry_at: new Date().toISOString(),
  });
  if (error) throw error;

  revalidatePath('/accounting');
}

export async function updateExpense(input: UpdateExpenseInput): Promise<void> {
  const session = await getSessionContext();
  if (!session.canDo('accounting.addExpense')) throw new Error('forbidden');

  const supabase = await createClient();
  const { error } = await supabase
    .from('expenses')
    .update({
      description: input.desc,
      category: input.category,
      source: input.source,
      amount: Number(input.amount),
      status: input.status,
      paid_at: input.paidAt,
    })
    .eq('id', input.id);
  if (error) throw error;

  revalidatePath('/accounting');
}

export async function deleteExpense(id: number): Promise<void> {
  const session = await getSessionContext();
  if (!session.canDo('accounting.addExpense')) throw new Error('forbidden');

  const supabase = await createClient();
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;

  revalidatePath('/accounting');
}

/**
 * Build the Excel workbook server-side (so `accounting.export` is re-checked on
 * the server, per C2) and return it as base64 for the client to download.
 * `xlsx` drives the export, mirroring the prototype's `exportExcel` sheet-per-shop
 * layout (finnix-film.html:3584-3597).
 */
export async function exportExpenses(
  payload: ExportPayload,
): Promise<{ fileName: string; base64: string } | null> {
  const session = await getSessionContext();
  if (!session.canDo('accounting.export')) throw new Error('forbidden');

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  if (payload.groups.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'ค่าใช้จ่าย');
  } else {
    payload.groups.forEach((g) => {
      const ws = XLSX.utils.json_to_sheet(g.rows);
      // Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 chars.
      const sheetName = (g.sheetName || '').replace(/[:\\/?*[\]]/g, '').slice(0, 31) || 'sheet';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  }
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return { fileName: `${payload.fileNameBase}-${Date.now()}.xlsx`, base64 };
}
