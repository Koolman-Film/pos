import type { WsOrder } from '@/components/wholesale/types';
import { orderPaid, orderTotal, PAYMENT_BOUNCED, PAYMENT_REPORTED } from '@/lib/domain/orders';

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

export const outstanding = (o: WsOrder) => orderTotal(o) - orderPaid(o);

const open = (o: WsOrder) => o.status !== 'ปิดงานแล้ว';

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

export function isOverdue(o: WsOrder, today: string): boolean {
  return open(o) && !!o.dueAt && o.dueAt < today && outstanding(o) > OWES;
}

export function isDueSoon(o: WsOrder, today: string): boolean {
  return (
    open(o) &&
    !!o.dueAt &&
    o.dueAt >= today &&
    o.dueAt <= shiftDay(today, DUE_SOON_DAYS) &&
    outstanding(o) > OWES
  );
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
