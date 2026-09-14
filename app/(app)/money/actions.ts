'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { buildAccountLedger } from '@/components/dashboard/moneyFlow';
import { ledgerEntryDetail, ledgerEntryTitle } from '@/components/money/ledgerText';
import { fmtThaiDayString, shopDayKey } from '@/lib/domain/format';

import { loadMoneyData } from './data';

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

  /*
    บัญชีใหม่ต่อท้ายสาขา.

    It used to be inserted with the column default of 0, so it tied with
    every other account added this way and landed wherever the database put
    it. Appending is what a person adding one expects; they can move it after.
  */
  let sortOrder: number | undefined;
  if (!input.id) {
    const { data: last } = await supabase
      .from('money_accounts')
      .select('sort_order')
      .eq('shop_id', input.shop)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = (last?.sort_order ?? 0) + 1;
  }

  const { error } = input.id
    ? await supabase.from('money_accounts').update(row).eq('id', input.id)
    : await supabase.from('money_accounts').insert({ ...row, sort_order: sortOrder });
  if (error) return { ok: false, error: error.message };
  return done();
}

/**
 * จัดลำดับแหล่งเงินในสาขา.
 *
 * Takes the whole order for one branch rather than "move this one up": the
 * stored numbers are mostly ties today, and swapping two equal numbers
 * changes nothing. Renumbering the branch 1…n in the order the screen shows
 * is the one write that always produces what the person just saw.
 *
 * The dashboard card reads the same column, so this sets both screens.
 */
export async function reorderMoneyAccounts(
  shop: string,
  orderedIds: number[],
): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };
  if (!session.accessibleShopIds.includes(shop)) {
    return { ok: false, error: 'ไม่มีสิทธิ์ในสาขานี้' };
  }

  const supabase = await createClient();
  for (const [i, id] of orderedIds.entries()) {
    // `shop_id` in the filter: an id from another branch simply matches
    // nothing, rather than being renumbered from a screen it is not on.
    const { error } = await supabase
      .from('money_accounts')
      .update({ sort_order: i + 1 })
      .eq('id', id)
      .eq('shop_id', shop);
    if (error) return { ok: false, error: error.message };
  }
  return done();
}

/**
 * นำการเติมเงินสดย่อยที่ตกหล่นเข้ายอดเงิน (migration 0056).
 *
 * A top-up pressed on บัญชี/ค่าใช้จ่าย before 0056 reached `petty_cash` and
 * never the balance. This turns one of them into the transfer it should have
 * been, dated the day it happened. `fromAccountId` null is นอกระบบ.
 *
 * One at a time and never automatic: the same money may already have been
 * keyed as a transfer by hand, and only the person looking can tell.
 */
export async function importPettyCashTopup(
  pettyId: number,
  fromAccountId: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };
  const supabase = await createClient();
  const { error } = await supabase.rpc('link_petty_cash_topup', {
    p_petty_id: pettyId,
    p_from_account: fromAccountId,
  });
  if (error) return { ok: false, error: error.message.replace(/^forbidden:\s*/, '') };
  revalidatePath('/accounting');
  return done();
}

/**
 * "โอนไว้เองแล้ว" — the top-up is already in the balance as a transfer somebody
 * keyed by hand, so importing it would count the money twice.
 */
export async function skipPettyCashTopup(
  pettyId: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };
  const supabase = await createClient();
  const { error } = await supabase.rpc('skip_petty_cash_topup', { p_petty_id: pettyId });
  if (error) return { ok: false, error: error.message.replace(/^forbidden:\s*/, '') };
  return done();
}

/**
 * ผูกชื่อแหล่งเงินที่ยังไม่มีเจ้าของ เข้ากับบัญชี.
 *
 * A payment or an expense records the LABEL the person picked, and an account
 * claims the labels that mean it. A label nobody claims contributes to no
 * balance — the expense saves, the list shows it, and the money silently
 * appears nowhere. That is what happens whenever somebody adds a new entry to
 * the แหล่งเงิน dropdown, which is one text box away at all times.
 *
 * So the screen lists the orphans and this binds one, rather than asking the
 * bookkeeper to find the account, open the editor and retype a label they
 * would have to copy exactly — including whatever spacing the original had.
 *
 * ผูกได้อย่างเดียว ไม่ลบของเดิม. Read-modify-write on an array is a race, and
 * the losing side of that race would take an existing binding down with it,
 * which is the very failure this exists to fix.
 */
export async function bindMoneyLabel(
  accountId: number,
  label: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };
  const wanted = label.trim();
  if (!wanted) return { ok: false, error: 'ไม่มีชื่อแหล่งเงินให้ผูก' };

  const supabase = await createClient();
  const { data: account, error: readError } = await supabase
    .from('money_accounts')
    .select('id, shop_id, match_names')
    .eq('id', accountId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!account) return { ok: false, error: 'ไม่พบแหล่งเงินนี้' };
  if (!session.accessibleShopIds.includes(account.shop_id)) {
    return { ok: false, error: 'ไม่มีสิทธิ์ในสาขานี้' };
  }

  const names = account.match_names ?? [];
  if (names.includes(wanted)) return done();

  const { error } = await supabase
    .from('money_accounts')
    .update({ match_names: [...names, wanted] })
    .eq('id', accountId);
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
  /**
   * `YYYY-MM-DD` — the day the counted figure was TRUE, e.g. a statement's
   * closing date. Statements arrive days after the month they close, so this
   * is not the day the count was typed in.
   */
  countedAt: string;
  countedBalance: number;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.countedAt)) {
    return { ok: false, error: 'วันที่ของยอดที่นับไม่ถูกต้อง' };
  }
  if (input.countedAt > shopDayKey(new Date())) {
    return { ok: false, error: 'วันที่ของยอดที่นับต้องไม่เกินวันนี้' };
  }
  if (!Number.isFinite(input.countedBalance)) {
    return { ok: false, error: 'ยอดที่นับได้ไม่ถูกต้อง' };
  }

  const supabase = await createClient();

  /*
    ยอดระบบ ณ สิ้นวันที่นับ — คำนวณที่เซิร์ฟเวอร์.

    It used to be whatever balance the screen was showing, which was always
    TODAY's — wrong for a statement closing on the 30th and counted on the 3rd,
    and a number the browser could send as anything. The ledger for this
    account up to the end of `countedAt` is the figure the count is compared
    against, and it is the same arithmetic the register uses.
  */
  const money = await loadMoneyData(supabase);
  const ledger = buildAccountLedger(
    input.accountId,
    money.accounts,
    money.movements,
    money.transfers,
    [],
    '',
    input.countedAt,
  );
  if (!ledger) return { ok: false, error: 'ไม่พบแหล่งเงินนี้' };

  const { error } = await supabase.from('money_reconciliations').insert({
    account_id: input.accountId,
    counted_at: input.countedAt,
    counted_balance: input.countedBalance,
    system_balance: ledger.carriedOut,
    note: input.note.trim(),
    created_by: session.userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/money/${input.accountId}`);
  return done();
}

/**
 * ส่งออกสมุดบัญชีแหล่งเงินเป็น Excel.
 *
 * Recomputed here from the database rather than taken from the page, so the
 * file is the ledger as it stands, not whatever the browser was holding — and
 * so a spreadsheet handed to an accountant cannot carry figures nobody entered.
 */
export async function exportAccountLedger(input: {
  accountId: number;
  from: string;
  to: string;
}): Promise<{ ok: true; fileName: string; base64: string } | { ok: false; error: string }> {
  const session = await authorize();
  if (!session) return { ok: false, error: REFUSED };

  const supabase = await createClient();
  const money = await loadMoneyData(supabase);
  const account = money.accounts.find((a) => a.id === input.accountId);
  if (!account) return { ok: false, error: 'ไม่พบแหล่งเงินนี้' };
  const ledger = buildAccountLedger(
    account.id,
    money.accounts,
    money.movements,
    money.transfers,
    money.reconciliations,
    input.from,
    input.to,
  );
  if (!ledger) return { ok: false, error: 'ไม่พบแหล่งเงินนี้' };

  const nameOf = (id: number | null | undefined) =>
    id == null ? 'นอกระบบ' : (money.accounts.find((a) => a.id === id)?.name ?? '—');
  const day = (d: string) => (d ? fmtThaiDayString(d) : '');

  const rows = [
    {
      // Dated the day it is true — see LedgerModule's `carriedInDay`.
      วันที่: day(ledger.from && ledger.from > account.openedAt ? ledger.from : account.openedAt),
      รายการ: 'ยอดยกมา',
      อ้างอิง: '',
      รายละเอียด: '',
      เงินเพิ่ม: '' as number | string,
      เงินลด: '' as number | string,
      คงเหลือ: ledger.carriedIn,
    },
    ...ledger.entries.map((e) => ({
      วันที่: day(e.on),
      รายการ: ledgerEntryTitle(e, nameOf),
      อ้างอิง: e.ref?.docNo ?? '',
      รายละเอียด: ledgerEntryDetail(e),
      เงินเพิ่ม: e.amount >= 0 ? e.amount : '',
      เงินลด: e.amount < 0 ? -e.amount : '',
      คงเหลือ: e.balance,
    })),
    {
      วันที่: day(ledger.to),
      รายการ: 'ยอดยกไป',
      อ้างอิง: '',
      รายละเอียด: '',
      เงินเพิ่ม: ledger.increase,
      เงินลด: ledger.decrease,
      คงเหลือ: ledger.carriedOut,
    },
  ];

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  // Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 characters.
  const sheetName = account.name.replace(/[:\\/?*[\]]/g, '').slice(0, 31) || 'ledger';
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const span = `${input.from || 'start'}_${input.to || 'now'}`;
  return { ok: true, fileName: `ledger-${account.id}-${span}.xlsx`, base64 };
}
