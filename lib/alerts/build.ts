import type { WsOrder } from '@/components/wholesale/types';
import { needsPriceApproval } from '@/lib/domain/orders';

import { LEVEL_ORDER, type AlertItem } from './types';
import {
  hasBouncedUnpaid,
  hasChequeDue,
  hasReturnAwaitingReceipt,
  isDueSoon,
  isOverdue,
  shiftDay,
  DUE_SOON_DAYS,
} from './wholesale';

/**
 * ประกอบการแจ้งเตือนของผู้ใช้หนึ่งคน — pure, so every rule below is tested
 * without a database.
 *
 * Who sees what is decided here and nowhere else:
 *
 *   * A person sees only what they can act on. Nobody is told a price is
 *     waiting if they cannot approve prices — a bell full of other people's
 *     work is a bell nobody listens to.
 *   * ผู้บริหาร/แอดมิน see every approval AND every bill (ร้านตัดสินใจ 15 ก.ย.
 *     2569). "Every bill" is tied to `wholesale.confirmPayment`, the right to say
 *     money came in, which only they hold by default.
 *   * A sales rep with a login linked to their sales-people record sees the bills
 *     for THEIR POs. Anyone else in the wholesale module sees the branch's.
 *   * Branches are not filtered here: the rows arrive already limited by RLS.
 *
 * `null` for a section means it was not loaded (no access, or the query failed)
 * and contributes nothing — the bell degrades rather than breaking the page.
 */
export type AlertInput = {
  today: string;
  can: (capability: string) => boolean;
  hasNav: (nav: string) => boolean;
  /** Sales-people records linked to this login. Empty for anyone not a rep. */
  myRepNames: { shop: string; name: string }[];
  /** Open (not deleted, not closed) POs. */
  orders: WsOrder[] | null;
  unpaidTickets: { id: string }[] | null;
  /** รอจ่าย expenses with a due date no later than the due-soon horizon. */
  expenses: { id: number; dueAt: string }[] | null;
  withdrawals: { id: number }[] | null;
  lowStock: { id: number; name: string }[] | null;
  pettyTopups: { id: number }[] | null;
  expiringPolicies: { id: number; plate: string }[] | null;
};

export function buildAlerts(input: AlertInput): AlertItem[] {
  const { today, can, hasNav } = input;
  const out: AlertItem[] = [];

  const push = (
    base: Pick<AlertItem, 'key' | 'level' | 'title' | 'href'>,
    rows: { id: string; example?: string }[],
  ) => {
    if (rows.length === 0) return;
    out.push({
      ...base,
      count: rows.length,
      itemIds: rows.map((r) => r.id),
      examples: rows
        .map((r) => r.example)
        .filter((e): e is string => !!e)
        .slice(0, 3),
    });
  };
  const byOrder = (prefix: string, list: WsOrder[]) =>
    list.map((o) => ({ id: `${prefix}:${o.id}`, example: o.id }));

  // -------------------------------------------------------------- ขายส่ง
  if (input.orders && hasNav('wholesale')) {
    const orders = input.orders;

    if (can('wholesale.priceApproval')) {
      // Same predicate as the dashboard's รอการอนุมัติ counter, so the two
      // numbers can never disagree.
      push(
        {
          key: 'po.priceApproval',
          level: 'todo',
          title: 'ราคา/ปรับราคา PO รออนุมัติ',
          href: '/wholesale?approval=pending',
        },
        byOrder('price', orders.filter(needsPriceApproval)),
      );
    }
    if (can('wholesale.badDebt')) {
      push(
        {
          key: 'po.badDebt',
          level: 'todo',
          title: 'ขอตัดหนี้สูญ รออนุมัติ',
          href: `/wholesale?status=${encodeURIComponent('ค้างชำระ')}`,
        },
        byOrder(
          'baddebt',
          orders.filter((o) => o.status === 'ค้างชำระ'),
        ),
      );
    }
    if (can('wholesale.confirmPayment')) {
      push(
        {
          key: 'cheque.due',
          level: 'urgent',
          title: 'เช็คถึงวันหน้าเช็คแล้ว ยังไม่ยืนยันเงินเข้า',
          href: '/wholesale?flag=cheques',
        },
        byOrder(
          'cheque',
          orders.filter((o) => hasChequeDue(o, today)),
        ),
      );
    }
    if (can('wholesale.updateStatus')) {
      push(
        {
          key: 'po.delivery',
          level: 'todo',
          title: 'PO รอจัดส่ง',
          href: `/wholesale?status=${encodeURIComponent('รอจัดส่ง')}`,
        },
        byOrder(
          'delivery',
          orders.filter((o) => o.status === 'รอจัดส่ง'),
        ),
      );
      push(
        {
          key: 'po.returns',
          level: 'todo',
          title: 'สินค้าคืน รอยืนยันว่าได้รับของ',
          href: '/wholesale?flag=returns',
        },
        byOrder('return', orders.filter(hasReturnAwaitingReceipt)),
      );
    }

    /*
      รายการเรียกเก็บเงิน.

      Everyone in the module chases payment, but not everyone chases the same
      customers: a rep's list is their own POs, matched by the name the PO was
      credited to within the branch it belongs to.
    */
    const seesAllBills = can('wholesale.confirmPayment');
    const mine = input.myRepNames;
    const billOrders =
      seesAllBills || mine.length === 0
        ? orders
        : orders.filter((o) => mine.some((r) => r.shop === o.shop && r.name === o.salesBy));
    const sale =
      !seesAllBills && mine.length === 1 ? `&sale=${encodeURIComponent(mine[0].name)}` : '';

    push(
      {
        key: 'cheque.bounced',
        level: 'urgent',
        title: 'เช็คเด้ง ยังเก็บเงินไม่ครบ',
        href: `/wholesale?flag=bounced${sale}`,
      },
      byOrder('bounced', billOrders.filter(hasBouncedUnpaid)),
    );
    push(
      {
        key: 'receivable.overdue',
        level: 'urgent',
        title: 'เลยกำหนดชำระแล้ว ยังไม่ได้รับเงิน',
        href: `/wholesale?flag=overdue${sale}`,
      },
      byOrder(
        'overdue',
        billOrders.filter((o) => isOverdue(o, today)),
      ),
    );
    push(
      {
        key: 'receivable.dueSoon',
        level: 'todo',
        title: 'ใกล้ถึงกำหนดชำระ',
        href: `/wholesale?flag=dueSoon${sale}`,
      },
      byOrder(
        'duesoon',
        billOrders.filter((o) => isDueSoon(o, today)),
      ),
    );
  }

  // ------------------------------------------------------------- Book งาน
  if (input.unpaidTickets && hasNav('list')) {
    push(
      {
        key: 'ticket.unpaid',
        level: 'todo',
        title: 'ใบงานค้างชำระ',
        href: `/tickets?status=${encodeURIComponent('ค้างชำระ')}`,
      },
      input.unpaidTickets.map((t) => ({ id: `ticket:${t.id}`, example: t.id })),
    );
  }

  // ------------------------------------------------------------ ค่าใช้จ่าย
  if (input.expenses && can('accounting.addExpense')) {
    const horizon = shiftDay(today, DUE_SOON_DAYS);
    push(
      {
        key: 'expense.overdue',
        level: 'urgent',
        title: 'ค่าใช้จ่ายเลยกำหนดจ่าย',
        href: '/accounting',
      },
      input.expenses.filter((e) => e.dueAt < today).map((e) => ({ id: `expense:${e.id}` })),
    );
    push(
      {
        key: 'expense.dueSoon',
        level: 'todo',
        title: 'ค่าใช้จ่ายใกล้ถึงกำหนดจ่าย',
        href: '/accounting',
      },
      input.expenses
        .filter((e) => e.dueAt >= today && e.dueAt <= horizon)
        .map((e) => ({ id: `expense:${e.id}` })),
    );
  }

  // ----------------------------------------------------------------- สต็อก
  if (input.withdrawals && can('stock.approveWithdraw')) {
    push(
      { key: 'stock.withdraw', level: 'todo', title: 'เบิกสต็อกรออนุมัติ', href: '/stock' },
      input.withdrawals.map((w) => ({ id: `withdraw:${w.id}` })),
    );
  }

  // --------------------------------------------------------- การเงิน/บัญชี
  if (input.pettyTopups && hasNav('money')) {
    push(
      {
        key: 'money.topups',
        level: 'todo',
        title: 'เติมเงินสดย่อยที่ยังไม่เข้ายอดเงิน',
        href: '/money',
      },
      input.pettyTopups.map((p) => ({ id: `topup:${p.id}` })),
    );
  }

  // ------------------------------------------------------- แจ้งให้ทราบ
  if (input.lowStock && hasNav('stock')) {
    push(
      { key: 'stock.low', level: 'info', title: 'สินค้าต่ำกว่าจำนวนขั้นต่ำ', href: '/stock' },
      input.lowStock.map((s) => ({ id: `stock:${s.id}`, example: s.name })),
    );
  }
  if (input.expiringPolicies && hasNav('list')) {
    push(
      { key: 'insurance.expiring', level: 'info', title: 'ประกันใกล้หมดอายุ', href: '/dashboard' },
      input.expiringPolicies.map((p) => ({ id: `policy:${p.id}`, example: p.plate })),
    );
  }

  // ด่วน first, then ต้องทำ, then แจ้งให้ทราบ; within a level, the order above.
  return out
    .map((a, i) => ({ a, i }))
    .sort((x, y) => LEVEL_ORDER.indexOf(x.a.level) - LEVEL_ORDER.indexOf(y.a.level) || x.i - y.i)
    .map(({ a }) => a);
}
