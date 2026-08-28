'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { dateInputValue } from '@/lib/domain/now';

import type {
  ExportPayload,
  NewExpenseInput,
  TopupInput,
  UpdateExpenseInput,
  UploadedAttachment,
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
  // The form supplies a local `YYYY-MM-DD` (defaulting to today) — `paid_at` and
  // `due_at` are DATE columns, and a UTC timestamp lands a day early in
  // Asia/Bangkok. A paid expense dates the payment; a pending one dates when it
  // is due, which is what the เจ้าหนี้ card on the dashboard reads.
  const entered = input.date || dateInputValue(new Date());
  const rows = input.lines
    .filter((l) => l.desc.trim() || l.category || Number(l.amount) > 0)
    .map((l) => ({
      shop_id: input.shop,
      description: l.desc,
      category: l.category,
      source: input.source,
      amount: Number(l.amount || 0),
      status: input.status,
      expense_kind: input.paidForFinnix ? 'จ่ายแทน' : 'ค่าใช้จ่าย',
      paid_at: input.status === 'จ่ายแล้ว' ? entered : null,
      due_at: input.status === 'จ่ายแล้ว' ? null : entered,
    }));
  if (rows.length === 0) return;

  const { data: inserted, error } = await supabase.from('expenses').insert(rows).select('id');
  if (error) throw error;

  // The panel states that every line in one submission shares the same receipts,
  // so each new expense gets its own row pointing at the same stored object. The
  // files themselves were uploaded by the browser straight to the private bucket
  // (migration 0014) — only their paths travel through this action.
  const attachments = input.attachments ?? [];
  if (attachments.length > 0 && inserted && inserted.length > 0) {
    const attachmentRows = inserted.flatMap((e) =>
      attachments.map((a) => ({
        expense_id: e.id,
        storage_path: a.path,
        file_name: a.fileName,
        mime_type: a.mimeType || '',
        size_bytes: Math.round(a.size || 0),
        uploaded_by: session.userId,
      })),
    );
    const { error: attachErr } = await supabase.from('expense_attachments').insert(attachmentRows);
    if (attachErr) throw attachErr;
  }

  revalidatePath('/accounting');
}

/**
 * Register receipts uploaded by the browser against an EXISTING expense — the
 * edit row's "แนบไฟล์เพิ่ม". Same shape as the add path, minus creating the row.
 */
export async function addExpenseAttachments(
  expenseId: number,
  attachments: UploadedAttachment[],
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('accounting.addExpense')) return { ok: false, error: 'ไม่มีสิทธิ์แก้ไข' };
  if (attachments.length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.from('expense_attachments').insert(
    attachments.map((a) => ({
      expense_id: expenseId,
      storage_path: a.path,
      file_name: a.fileName,
      mime_type: a.mimeType || '',
      size_bytes: Math.round(a.size || 0),
      uploaded_by: session.userId,
    })),
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/accounting');
  return { ok: true };
}

/** Remove one receipt — the row AND the object, so nothing is left orphaned. */
export async function deleteExpenseAttachment(
  attachmentId: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.canDo('accounting.addExpense')) return { ok: false, error: 'ไม่มีสิทธิ์แก้ไข' };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from('expense_attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .maybeSingle();

  const { error } = await supabase.from('expense_attachments').delete().eq('id', attachmentId);
  if (error) return { ok: false, error: error.message };
  if (row?.storage_path) {
    await supabase.storage.from('expense-attachments').remove([row.storage_path]);
  }
  revalidatePath('/accounting');
  return { ok: true };
}

/**
 * A one-minute signed URL for a stored receipt. The bucket is private, so this
 * is the only way to open one; the caller is re-checked here (C2) and storage
 * RLS checks the same nav permission again when the URL is redeemed.
 */
export async function getExpenseAttachmentUrl(
  path: string,
): Promise<{ url?: string; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('expense-attachments')
    .createSignedUrl(path, 60);
  if (error) return { error: error.message };
  return { url: data?.signedUrl };
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
      expense_kind: input.paidForFinnix ? 'จ่ายแทน' : 'ค่าใช้จ่าย',
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

  // `expense_attachments` cascades with the expense, but the objects in the
  // bucket do not — without this they would linger unreachable, since nothing
  // outside that table records their paths.
  const { data: attachments } = await supabase
    .from('expense_attachments')
    .select('storage_path')
    .eq('expense_id', id);
  const paths = (attachments ?? []).map((a) => a.storage_path);

  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;

  if (paths.length > 0) {
    // A failure here leaves an orphaned object, not a broken expense list, so it
    // must not undo the delete the user asked for.
    await supabase.storage.from('expense-attachments').remove(paths);
  }

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
