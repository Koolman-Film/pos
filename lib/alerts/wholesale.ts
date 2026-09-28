import type { WsOrder } from '@/components/wholesale/types';
import {
  orderPaid,
  orderTotal,
  PAYMENT_BOUNCED,
  PAYMENT_REPORTED,
  isOpenOrderStatus,
  type OrderForTotals,
} from '@/lib/domain/orders';
import {
  dueSoonInstallments,
  overdueInstallments,
  type Installment,
} from '@/lib/domain/installments';

/**
 * What these questions need to know about a PO — and no more, so the
 * dashboard, which maps POs its own way, can ask them too.
 */
export type BillOrder = OrderForTotals & {
  status: string;
  dueAt?: string;
  /**
   * ตารางงวดที่ตกลงกับลูกค้า (migration 0078).
   *
   * มีเมื่อไหร่ มันเป็นตัวตัดสินแทน `dueAt` — งวดที่ 1 เลยกำหนดแล้วแต่งวดที่ 2
   * ยังไม่ถึง คือคำตอบที่กำหนดชำระวันเดียวต่อใบให้ไม่ได้. ไม่มี = PO ที่ยังไม่
   * ได้ตั้งตาราง ซึ่งคือ PO ทุกใบก่อน 0078 และยังใช้กติกาเดิมทุกประการ
   */
  installments?: Installment[];
  /**
   * ต้องรู้จัก `installmentUid` ด้วย เพราะเมื่อมีตารางงวด คำถามเรื่องเลยกำหนด
   * ไม่ใช่ "ค้างอยู่เท่าไหร่" แต่เป็น "งวดไหนที่ยังไม่ครบ" — และเงินแต่ละก้อน
   * ตอบคำถามนั้นได้ก็ต่อเมื่อมันบอกได้ว่าตัวเองอยู่งวดไหน
   */
  payments: (Parameters<typeof orderPaid>[0]['payments'][number] & {
    installmentUid?: string;
  })[];
};

/** งวดที่เลยกำหนดแล้วและยังเก็บไม่ครบ — ว่างเปล่าเมื่อ PO ไม่มีตารางงวด. */
export const overdueParts = (o: BillOrder, today: string) =>
  overdueInstallments(o.installments ?? [], o.payments, today);

/**
 * คำถามที่การแจ้งเตือนขายส่งถาม — and the same questions the wholesale list
 * answers when an alert opens it.
 *
 * Both sides import these rather than each writing its own. An alert that says
 * 3 and opens a list showing 5 teaches people to stop believing the number, which
 * is the one thing the bell cannot afford.
 */

/**
 * "ใกล้ถึงกำหนดชำระ" looks this many days ahead.
 *
 * The shop asked for alerts without day counts in them, so the number is never
 * shown — but "near" still has to mean something, and three days is enough to
 * ring a customer before the date rather than after it.
 */
export const DUE_SOON_DAYS = 3;

/** Less than half a satang left is paid — floating point, not a debt. */
const OWES = 0.005;

/** `YYYY-MM-DD` shifted by whole days, on the calendar rather than the clock. */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export const outstanding = (o: BillOrder) => orderTotal(o) - orderPaid(o);

const open = (o: BillOrder) => isOpenOrderStatus(o.status);

/** A cheque was reported and its date has come, but nobody has confirmed the money. */
export function hasChequeDue(o: WsOrder, today: string): boolean {
  return o.payments.some((p) => {
    if (p.status !== PAYMENT_REPORTED || !(Number(p.amount) > 0)) return false;
    const due = p.chequeDate || p.date || '';
    return !!due && due <= today;
  });
}

/** A cheque bounced and the bill is still not covered by money actually received. */
export function hasBouncedUnpaid(o: WsOrder): boolean {
  return o.payments.some((p) => p.status === PAYMENT_BOUNCED) && outstanding(o) > OWES;
}

/** A return has been written down but nobody has confirmed the goods came back. */
export function hasReturnAwaitingReceipt(o: WsOrder): boolean {
  return o.returns.some((r) => !r.receivedAt);
}

export function isOverdue(o: BillOrder, today: string): boolean {
  if (!open(o)) return false;
  // มีตารางงวด = ตารางเป็นตัวตัดสิน ยอดค้างทั้งก้อนกับวันเดียวตอบคำถามนี้ไม่ได้
  if ((o.installments ?? []).length > 0) return overdueParts(o, today).length > 0;
  return !!o.dueAt && o.dueAt < today && outstanding(o) > OWES;
}

export function isDueSoon(o: BillOrder, today: string): boolean {
  if (!open(o)) return false;
  const horizon = shiftDay(today, DUE_SOON_DAYS);
  if ((o.installments ?? []).length > 0) {
    return dueSoonInstallments(o.installments ?? [], o.payments, today, horizon).length > 0;
  }
  return !!o.dueAt && o.dueAt >= today && o.dueAt <= horizon && outstanding(o) > OWES;
}

/** The `?flag=` values the wholesale list accepts. */
export const WS_FLAGS = ['cheques', 'bounced', 'returns', 'overdue', 'dueSoon'] as const;
export type WsFlag = (typeof WS_FLAGS)[number];

export const isWsFlag = (v: unknown): v is WsFlag =>
  typeof v === 'string' && (WS_FLAGS as readonly string[]).includes(v);

export const WS_FLAG_LABELS: Record<WsFlag, string> = {
  cheques: 'เช็คถึงวันหน้าเช็ค รอยืนยันเงินเข้า',
  bounced: 'เช็คเด้ง ยังเก็บเงินไม่ครบ',
  returns: 'สินค้าคืน รอยืนยันรับของ',
  overdue: 'เลยกำหนดชำระ',
  dueSoon: 'ใกล้ถึงกำหนดชำระ',
};

export function matchesWsFlag(o: WsOrder, flag: WsFlag, today: string): boolean {
  switch (flag) {
    case 'cheques':
      return hasChequeDue(o, today);
    case 'bounced':
      return hasBouncedUnpaid(o);
    case 'returns':
      return hasReturnAwaitingReceipt(o);
    case 'overdue':
      return isOverdue(o, today);
    case 'dueSoon':
      return isDueSoon(o, today);
  }
}
