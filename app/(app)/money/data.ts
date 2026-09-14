import type { MoneyAccount, MoneyMovement, MoneyTransfer } from '@/components/dashboard/moneyFlow';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import type { createClient } from '@/lib/supabase/server';

/**
 * ข้อมูลเงินทั้งหมดที่หน้าการเงินและสมุดบัญชีแหล่งเงินใช้ — อ่านที่เดียว.
 *
 * Two screens now answer "how much is in this account": the register table and
 * the ledger that explains it. If each assembled its own list of movements they
 * would eventually disagree about which payments count, and the ledger's closing
 * balance would stop matching the figure beside it. So both read through here.
 *
 * Three rules this file exists to keep in one place:
 *
 *   * อ่านครบทุกแถว. PostgREST stops at 1,000 rows without saying so; a balance
 *     summed over an arbitrary thousand payments is a wrong number that looks
 *     right. Every read that grows with the business is paged.
 *
 *   * ไม่ได้รับเงินจริง ไม่นับ. A wholesale payment counts once somebody has
 *     confirmed the money arrived (0048), dated the day it cleared; an expense
 *     counts once it is จ่ายแล้ว. Anything still pending moves no money.
 *
 *   * เอกสารที่ลบแล้ว ไม่นับ. Deleted tickets were already out; deleted POs were
 *     not, so their payments stayed in the balance of an account that could no
 *     longer show where the money came from.
 */

type Client = Awaited<ReturnType<typeof createClient>>;
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

type TicketPaymentRow = {
  id: number;
  ticket_id: string;
  type: string | null;
  method: string | null;
  amount: number | string | null;
  paid_at: string | null;
  tickets: { shop_id: string; customer_name: string | null; plate: string | null } | null;
};

type OrderPaymentRow = {
  id: number;
  order_id: string;
  method: string | null;
  amount: number | string | null;
  paid_at: string | null;
  cleared_at: string | null;
  cheque_no: string | null;
  cheque_bank: string | null;
  orders: {
    shop_id: string;
    wholesale_customers: { name: string | null } | null;
  } | null;
};

type ExpenseRow = {
  id: number;
  shop_id: string;
  doc_no: string | null;
  description: string | null;
  category: string | null;
  source: string | null;
  amount: number | string | null;
  paid_at: string | null;
  expense_kind: string | null;
  expense_attachments: { file_name: string; storage_path: string }[] | null;
};

type TransferRow = {
  id: number;
  shop_id: string;
  from_account_id: number | null;
  to_account_id: number | null;
  amount: number | string | null;
  moved_at: string;
  note: string | null;
};

type ReconciliationRow = {
  id: number;
  account_id: number;
  counted_at: string;
  counted_balance: number | string | null;
  system_balance: number | string | null;
  note: string | null;
};

export type MoneyTransferRecord = MoneyTransfer & { id: number; note: string };

export type MoneyReconciliationRecord = {
  id: number;
  accountId: number;
  countedAt: string;
  countedBalance: number;
  systemBalance: number;
  note: string;
};

export type MoneyData = {
  accounts: MoneyAccount[];
  movements: MoneyMovement[];
  transfers: MoneyTransferRecord[];
  reconciliations: MoneyReconciliationRecord[];
};

const num = (v: unknown) => Number(v ?? 0);
// Every date read here is a DATE column, already the shop's calendar day.
// Passing it through `new Date()` would reinterpret it as UTC midnight.
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');
const joined = (...parts: (string | null | undefined)[]) =>
  parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' · ');

export async function loadMoneyData(supabase: Client): Promise<MoneyData> {
  const [accountRows, transferRows, reconRows, ticketPays, orderPays, expenseRows] =
    await Promise.all([
      fetchAllRows(
        (from, to) =>
          supabase
            .from('money_accounts')
            .select(
              'id, shop_id, name, kind, account_no, opening_balance, opened_at, match_names, sort_order',
            )
            .eq('active', true)
            .order('sort_order')
            .order('id')
            .range(from, to),
        'money_accounts',
      ),
      fetchAllRows(
        (from, to) =>
          supabase
            .from('money_transfers')
            .select('id, shop_id, from_account_id, to_account_id, amount, moved_at, note')
            .order('moved_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to) as unknown as Page<TransferRow>,
        'money_transfers',
      ),
      fetchAllRows(
        (from, to) =>
          supabase
            .from('money_reconciliations')
            .select('id, account_id, counted_at, counted_balance, system_balance, note')
            .order('counted_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to) as unknown as Page<ReconciliationRow>,
        'money_reconciliations',
      ),
      fetchAllRows(
        (from, to) =>
          supabase
            .from('ticket_payments')
            .select(
              'id, ticket_id, type, method, amount, paid_at, tickets!inner(shop_id, customer_name, plate)',
            )
            .is('tickets.deleted_at', null)
            .not('paid_at', 'is', null)
            .order('id')
            .range(from, to) as unknown as Page<TicketPaymentRow>,
        'ticket_payments',
      ),
      fetchAllRows(
        (from, to) =>
          supabase
            .from('order_payments')
            .select(
              'id, order_id, method, amount, paid_at, cleared_at, cheque_no, cheque_bank, orders!inner(shop_id, wholesale_customers(name))',
            )
            .is('orders.deleted_at', null)
            .eq('status', 'รับเงินแล้ว')
            .order('id')
            .range(from, to) as unknown as Page<OrderPaymentRow>,
        'order_payments',
      ),
      fetchAllRows(
        (from, to) =>
          supabase
            .from('expenses')
            .select(
              'id, shop_id, doc_no, description, category, source, amount, paid_at, expense_kind, expense_attachments(file_name, storage_path)',
            )
            .eq('status', 'จ่ายแล้ว')
            .not('paid_at', 'is', null)
            .order('id')
            .range(from, to) as unknown as Page<ExpenseRow>,
        'expenses',
      ),
    ]);

  const accounts: MoneyAccount[] = accountRows.map((a) => ({
    id: a.id,
    shop: a.shop_id,
    name: a.name,
    kind: a.kind,
    accountNo: a.account_no ?? '',
    openingBalance: num(a.opening_balance),
    openedAt: a.opened_at,
    matchNames: a.match_names ?? [],
    sortOrder: a.sort_order,
  }));

  const movements: MoneyMovement[] = [
    ...ticketPays
      .filter((p) => p.method && p.tickets)
      .map((p) => ({
        shop: p.tickets!.shop_id,
        source: p.method!,
        amount: num(p.amount),
        on: day(p.paid_at),
        ref: {
          kind: 'ticket' as const,
          id: p.ticket_id,
          docNo: p.ticket_id,
          title: p.tickets!.customer_name ?? '',
          detail: joined(p.tickets!.plate, p.type),
        },
      })),
    ...orderPays
      .filter((p) => p.method && p.orders)
      .map((p) => ({
        shop: p.orders!.shop_id,
        source: p.method!,
        amount: num(p.amount),
        // วันที่เงินเข้าจริง — a cheque counts the day it cleared, not the day
        // it was handed over. Rows from before 0048 have only `paid_at`.
        on: day(p.cleared_at ?? p.paid_at),
        ref: {
          kind: 'order' as const,
          id: p.order_id,
          docNo: p.order_id,
          title: p.orders!.wholesale_customers?.name ?? '',
          detail: p.cheque_no
            ? joined(`เช็ค ${p.cheque_bank ?? ''} ${p.cheque_no}`.replace(/\s+/g, ' '), p.method)
            : (p.method ?? ''),
        },
      }))
      .filter((m) => m.on),
    ...expenseRows
      .filter((e) => e.source)
      .map((e) => ({
        shop: e.shop_id,
        source: e.source!,
        amount: -num(e.amount),
        on: day(e.paid_at),
        ref: {
          kind: 'expense' as const,
          id: String(e.id),
          docNo: e.doc_no || `#${e.id}`,
          title: e.description ?? '',
          detail: joined(e.category, e.expense_kind === 'จ่ายแทน' ? 'จ่ายแทน Finnix' : ''),
          attachments: (e.expense_attachments ?? []).map((a) => ({
            fileName: a.file_name,
            path: a.storage_path,
          })),
        },
      })),
  ];

  return {
    accounts,
    movements,
    transfers: transferRows.map((t) => ({
      id: t.id,
      shop: t.shop_id,
      fromAccountId: t.from_account_id,
      toAccountId: t.to_account_id,
      amount: num(t.amount),
      on: t.moved_at,
      note: t.note ?? '',
    })),
    reconciliations: reconRows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      countedAt: r.counted_at,
      countedBalance: num(r.counted_balance),
      systemBalance: num(r.system_balance),
      note: r.note ?? '',
    })),
  };
}
