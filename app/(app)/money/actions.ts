'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * การจัดการเงิน/บัญชี — server actions for the money register (migration 0043).
 *
 * CORRECTION C2 — a Server Action is a plain POST to the route that hosts it, so
 * the `hasNav('money')` check in the page only decides whether the screen
 * renders. Every action below re-establishes the session and re-checks the same
 * key, and RLS scopes the rows to the caller's branches on top of that.
 */

const REFUSED = 'ไม่มีสิทธิ์จัดการแหล่งเงิน';

async function authorize() {
  const session = await getSessionContext();
  if (!session.hasNav('money')) return null;
  return session;
}

function done(): { ok: true } {
  revalidatePath('/money');
  // The dashboard's เงินอยู่ที่ไหนบ้าง card reads the same rows.
  revalidatePath('/dashboard');
  return { ok: true };
}

export type SaveAccountInput = {
  id?: number;
  shop: string;
  name: string;
  kind: string;
  accountNo: string;
  openingBalance: number;
  openedAt: string;
  /** Labels in `method` / `source` that mean this account. */
  matchNames: string[];
};

/**
 * บันทึกแหล่งเงิน — add one, or correct one that exists.
 *
 * The opening balance is editable on purpose. Reconciling against a bank
 * statement finds that the figure first typed was wrong, and the fix for a wrong
 * number is the right number — not a fabricated transaction to bridge the gap,
 * which is what an immutable opening balance would force somebody to invent.
 */
export async function saveMoneyAccount(
  input: SaveAccountInput,
): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };
  if (!input.name.trim()) return { ok: false, error: 'ต้องระบุชื่อแหล่งเงิน' };
  if (!session.accessibleShopIds.includes(input.shop)) {
    return { ok: false, error: 'ไม่มีสิทธิ์ในสาขานี้' };
  }

  const supabase = await createClient();
  const row = {
    shop_id: input.shop,
    name: input.name.trim(),
    kind: input.kind,
    account_no: input.accountNo.trim(),
    opening_balance: input.openingBalance,
    opened_at: input.openedAt,
    match_names: input.matchNames.map((m) => m.trim()).filter(Boolean),
  };

  const { error } = input.id
    ? await supabase.from('money_accounts').update(row).eq('id', input.id)
    : await supabase.from('money_accounts').insert(row);
  if (error) return { ok: false, error: error.message };
  return done();
}

/**
 * ปิดแหล่งเงิน — deactivate rather than delete.
 *
 * Transfers point at it and reconciliations hang off it; removing the row would
 * take that history with it or orphan it. A closed account stops appearing and
 * keeps everything it ever explained.
 */
export async function closeMoneyAccount(id: number): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };
  const supabase = await createClient();
  const { error } = await supabase.from('money_accounts').update({ active: false }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return done();
}

export type SaveTransferInput = {
  shop: string;
  fromAccountId: number | null;
  toAccountId: number | null;
  amount: number;
  movedAt: string;
  note: string;
};

/**
 * บันทึกการโอน/ฝากเงิน.
 *
 * One end may be empty, and that is the point rather than a loophole: money
 * arriving from outside the register (the owner putting capital in) has no
 * source account, and money leaving without being a cost — repaying a director
 * who fronted cash — has no destination. Forcing both ends would push that
 * payment through ค่าใช้จ่าย, where it would inflate the expense figure and
 * understate the profit by exactly the same amount.
 */
export async function saveMoneyTransfer(
  input: SaveTransferInput,
): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };
  if (!session.accessibleShopIds.includes(input.shop)) {
    return { ok: false, error: 'ไม่มีสิทธิ์ในสาขานี้' };
  }
  if (!(input.amount > 0)) return { ok: false, error: 'จำนวนเงินต้องมากกว่า 0' };
  if (!input.fromAccountId && !input.toAccountId) {
    return { ok: false, error: 'ต้องระบุอย่างน้อยหนึ่งด้าน (จาก หรือ ไป)' };
  }
  if (input.fromAccountId && input.fromAccountId === input.toAccountId) {
    return { ok: false, error: 'โอนเข้าแหล่งเงินเดียวกันไม่ได้' };
  }

  const supabase = await createClient();

  /*
    Both ends must belong to the branch the transfer is filed under.

    Nothing tied them together before, and a mismatch is the worst kind of bad
    row: the money moves in one branch’s accounts while the record sits under
    another, so the branch whose balances changed cannot see why. A database
    trigger (0043) enforces it too — this check exists to give the person at the
    screen a sentence they can act on instead of a constraint violation.
  */
  const ends = [input.fromAccountId, input.toAccountId].filter((id): id is number => id !== null);
  if (ends.length > 0) {
    const { data: owned } = await supabase
      .from('money_accounts')
      .select('id')
      .eq('shop_id', input.shop)
      .in('id', ends);
    if ((owned ?? []).length !== ends.length) {
      return { ok: false, error: 'แหล่งเงินที่เลือกไม่ได้อยู่ในสาขานี้' };
    }
  }

  const { error } = await supabase.from('money_transfers').insert({
    shop_id: input.shop,
    from_account_id: input.fromAccountId,
    to_account_id: input.toAccountId,
    amount: input.amount,
    moved_at: input.movedAt,
    note: input.note.trim(),
    created_by: session.userId,
  });
  if (error) return { ok: false, error: error.message };
  return done();
}

export async function deleteMoneyTransfer(id: number): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };
  const supabase = await createClient();
  const { error } = await supabase.from('money_transfers').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return done();
}

export type SaveReconciliationInput = {
  accountId: number;
  countedAt: string;
  countedBalance: number;
  /** What the screen showed at the moment of counting. */
  systemBalance: number;
  note: string;
};

/**
 * บันทึกการกระทบยอด — what was counted, against what the system said.
 *
 * `systemBalance` is stored rather than recomputed later, because it will not
 * stay the same: back-dating an expense next week changes what the computed
 * figure was on the day of the count, and the gap the bookkeeper actually saw
 * would quietly rewrite itself. The difference is evidence; it has to be frozen.
 *
 * Recording a gap does NOT close it. Correcting the opening balance is a
 * separate, deliberate act — see `saveMoneyAccount`.
 */
export async function saveMoneyReconciliation(
  input: SaveReconciliationInput,
): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };
  const supabase = await createClient();
  const { error } = await supabase.from('money_reconciliations').insert({
    account_id: input.accountId,
    counted_at: input.countedAt,
    counted_balance: input.countedBalance,
    system_balance: input.systemBalance,
    note: input.note.trim(),
    created_by: session.userId,
  });
  if (error) return { ok: false, error: error.message };
  return done();
}
