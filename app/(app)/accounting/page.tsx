import {
  AccountingModule,
  type ExpenseView,
  type PettyCashView,
} from '@/components/accounting/AccountingModule';
import { getSessionContext } from '@/lib/auth/session';
import { fmtThaiDate } from '@/lib/domain/format';
import { createClient } from '@/lib/supabase/server';

import { updateOptionListAction } from '../optionListActions';

import {
  addExpense,
  addExpenseAttachments,
  deleteExpenseAttachment,
  deleteExpense,
  exportExpenses,
  getExpenseAttachmentUrl,
  topupCash,
  updateExpense,
} from './actions';

/**
 * Accounting route — Server Component. Fetches expenses, petty cash and the two
 * config lists (expense categories, payment sources) plus the caller's shops,
 * maps them to the prototype's flat shape, then renders the (client) module.
 *
 * `getSessionContext()` gates rendering; per C2 each Server Action re-checks on
 * its own. Capabilities are evaluated here to serializable booleans because a
 * closure cannot cross into a Client Component (see the module's note and the
 * Sidebar/Commission precedent).
 */
/** The expense projection below; the attachments embed defeats inference. */
type ExpenseRow = {
  id: number;
  doc_no: string | null;
  shop_id: string;
  description: string;
  category: string;
  source: string;
  amount: number;
  status: string;
  expense_kind: string;
  paid_at: string | null;
  due_at: string | null;
  expense_attachments:
    { id: number; file_name: string; storage_path: string; mime_type: string | null }[] | null;
};

export default async function AccountingPage() {
  const session = await getSessionContext();
  const supabase = await createClient();

  const [{ data: shopRows }, { data: expenseRows }, { data: pettyRows }, { data: optionRows }] =
    await Promise.all([
      supabase.from('shops').select('id, name').order('sort_order'),
      supabase
        .from('expenses')
        .select(
          'id, doc_no, shop_id, description, category, source, amount, status, expense_kind, paid_at, due_at, ' +
            'expense_attachments(id, file_name, storage_path, mime_type)',
        )
        .order('id', { ascending: false }),
      supabase.from('petty_cash').select('id, shop_id, type, amount, note, entry_at'),
      supabase
        .from('option_lists')
        .select('list_key, value, sort_order')
        .in('list_key', ['expense_categories', 'payment_sources'])
        .order('sort_order'),
    ]);

  const accessibleShops = (shopRows ?? []).filter((s) => session.accessibleShopIds.includes(s.id));

  const expenses: ExpenseView[] = ((expenseRows ?? []) as unknown as ExpenseRow[]).map((e) => ({
    id: e.id,
    docNo: e.doc_no ?? '',
    shop: e.shop_id,
    desc: e.description,
    category: e.category,
    source: e.source,
    amount: Number(e.amount),
    status: e.status,
    paidForFinnix: e.expense_kind === 'จ่ายแทน',
    dateObj: e.paid_at ? new Date(e.paid_at) : null,
    date: e.paid_at ? fmtThaiDate(new Date(e.paid_at)) : '-',
    due: e.due_at ? fmtThaiDate(new Date(e.due_at)) : undefined,
    attachments: (e.expense_attachments ?? []).map((a) => ({
      id: a.id,
      fileName: a.file_name,
      path: a.storage_path,
      mimeType: a.mime_type ?? '',
    })),
  }));

  const pettyCash: PettyCashView[] = (pettyRows ?? []).map((p) => ({
    id: p.id,
    shop: p.shop_id,
    type: p.type,
    amount: Number(p.amount),
    date: fmtThaiDate(new Date(p.entry_at)),
    note: p.note,
  }));

  const expenseCategories = (optionRows ?? [])
    .filter((o) => o.list_key === 'expense_categories')
    .map((o) => o.value);
  const paymentSources = (optionRows ?? [])
    .filter((o) => o.list_key === 'payment_sources')
    .map((o) => o.value);

  return (
    <AccountingModule
      expenses={expenses}
      pettyCash={pettyCash}
      expenseCategories={expenseCategories}
      paymentSources={paymentSources}
      canAddExpense={session.canDo('accounting.addExpense')}
      canTopupCash={session.canDo('accounting.topupCash')}
      canExport={session.canDo('accounting.export')}
      canManageOptions={session.canDo('options.manage')}
      addExpenseAction={addExpense}
      topupCashAction={topupCash}
      updateExpenseAction={updateExpense}
      deleteExpenseAction={deleteExpense}
      exportAction={exportExpenses}
      attachmentUrlAction={getExpenseAttachmentUrl}
      attachAction={addExpenseAttachments}
      detachAction={deleteExpenseAttachment}
      updateOptionListAction={updateOptionListAction}
      accessibleShops={accessibleShops}
      canSeeAllShops={session.seesAllShops}
    />
  );
}
