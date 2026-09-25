import { isReceived } from '@/lib/domain/orders';
import { itemNetPrice } from '@/lib/domain/tickets';

/**
 * ยอดขายบนแดชบอร์ด = เงินที่รับแล้ว (ร้านขอ 16 ก.ย. 2569).
 *
 * The card used to count every job dropped off in the period at its full
 * price, and every PO at the value of the goods sent out — so a job that was
 * half paid, or a PO still waiting for its cheque, was in the figure, and the
 * shop's ยอดขาย never matched the money in its accounts. Now a sale counts when,
 * and as far as, it has been paid:
 *
 *   - a ticket payment on its `paid_at` — the same rows, and the same day, as
 *     โมดูลการเงิน's รับเข้า;
 *   - a PO payment only once it is รับเงินแล้ว, on the day the money actually
 *     arrived (`cleared_at`, falling back to `paid_at` for rows from before
 *     0048) — again exactly as โมดูลการเงิน counts it;
 *   - work the branch took money for on behalf of another Finnix shop
 *     (`รับแทน`) is marked `held`: collected, but not this branch's sales.
 *     That is asked of each LINE, not of the whole job (0068) — one car can
 *     have the branch's own film on it and another branch's wrap.
 *
 * A payment carries no ชนิดสินค้า, so the breakdown under the headline splits
 * each payment across what it paid for, in proportion to value: the ticket's
 * lines by ชนิดสินค้า plus any ประกัน sold on that ticket (a policy is its own
 * record, 0023, and its premium is taken as a payment on the ticket), and a
 * PO's goods by the ชนิดสินค้า the stock register gives them. The split adds up
 * to the payment to the satang, so the rows still add up to the headline.
 *
 * That same split answers "how much of this 4,000 baht was ours" on a mixed
 * job: the share that bought the lines that were ours. There is no better
 * answer available — the customer handed over one amount for the whole car —
 * and it is the answer the ชนิดสินค้า breakdown has always used.
 */

export const UNSPECIFIED_CATEGORY = 'ไม่ระบุชนิด';
export const INSURANCE_CATEGORY = 'ประกัน';

export type SalesReceipt = {
  /** The ticket or PO the money was paid against. */
  sourceId: string;
  shop: string;
  /** `YYYY-MM-DD` — the day the money came in. */
  on: string;
  channel: 'ปลีก' | 'ขายส่ง';
  /** รับแทน Finnix — collected here, earned by another shop. */
  held: boolean;
  category: string;
  amount: number;
};

type Weighted = { category: string; held: boolean; weight: number };

const satang = (n: number) => Math.round(n * 100) / 100;
const dayOf = (v: string | null | undefined) => (v ?? '').slice(0, 10);

/**
 * `amount` shared out in proportion to `parts`; the last share takes the
 * rounding, so the shares always add back to `amount` to the satang.
 *
 * Parts merge on ชนิดสินค้า AND on whose money it is: ฟิล์มกรองแสง the branch
 * sold and ฟิล์มกรองแสง it is holding for another shop are two different sums
 * that must not be added together (0068).
 */
export function splitByWeight(
  amount: number,
  parts: Weighted[],
): { category: string; held: boolean; amount: number }[] {
  const merged = new Map<string, { category: string; held: boolean; weight: number }>();
  for (const p of parts) {
    if (!(p.weight > 0)) continue;
    const category = p.category || UNSPECIFIED_CATEGORY;
    const key = `${p.held ? 'held' : 'own'}|${category}`;
    const at = merged.get(key);
    if (at) at.weight += p.weight;
    else merged.set(key, { category, held: p.held, weight: p.weight });
  }
  const entries = [...merged.values()];
  const total = entries.reduce((n, e) => n + e.weight, 0);
  if (!(total > 0)) {
    return [{ category: UNSPECIFIED_CATEGORY, held: false, amount: satang(amount) }];
  }

  let given = 0;
  return entries.map((e, i) => {
    const share =
      i === entries.length - 1 ? satang(amount - given) : satang((amount * e.weight) / total);
    given = satang(given + share);
    return { category: e.category, held: e.held, amount: share };
  });
}

export type ReceiptTicket = {
  id: string;
  shop: string;
  /** Kept for a caller that has no per-line answer; each line may say otherwise. */
  held: boolean;
  items: (Parameters<typeof itemNetPrice>[0] & { category?: string; held?: boolean })[];
  /** `on` is the payment's `paid_at`, `YYYY-MM-DD`. */
  payments: { amount: number; on: string }[];
};

export function ticketReceipts(
  tickets: ReceiptTicket[],
  policies: { ticketId: string; price: number }[],
): SalesReceipt[] {
  const insuranceByTicket = new Map<string, number>();
  for (const p of policies) {
    insuranceByTicket.set(
      p.ticketId,
      (insuranceByTicket.get(p.ticketId) ?? 0) + Number(p.price || 0),
    );
  }

  const lines: SalesReceipt[] = [];
  for (const t of tickets) {
    const weights: Weighted[] = [
      // A line with no answer of its own falls back to the ticket's, so a
      // caller that has not been taught about per-line kinds still works.
      ...t.items.map((i) => ({
        category: i.category ?? '',
        held: i.held ?? t.held,
        weight: itemNetPrice(i),
      })),
      // ประกัน is sold by the branch that sold it, even on a held job — the
      // same rule โมดูลรายได้ applies to the policy line.
      { category: INSURANCE_CATEGORY, held: false, weight: insuranceByTicket.get(t.id) ?? 0 },
    ];
    for (const p of t.payments) {
      const on = dayOf(p.on);
      const amount = Number(p.amount || 0);
      if (!on || !amount) continue;
      for (const share of splitByWeight(amount, weights)) {
        lines.push({ sourceId: t.id, shop: t.shop, on, channel: 'ปลีก', ...share });
      }
    }
  }
  return lines;
}

export type ReceiptOrder = {
  id: string;
  shop: string;
  items: { name: string; qty: number; requestedPrice: number }[];
  payments: {
    amount: number;
    status?: string;
    paidAt?: string | null;
    clearedAt?: string | null;
  }[];
};

export function orderReceipts(
  orders: ReceiptOrder[],
  categoryOf: (productName: string) => string,
): SalesReceipt[] {
  const lines: SalesReceipt[] = [];
  for (const o of orders) {
    // ขายส่งไม่มีการรับแทน: a PO is raised by the branch that sells it.
    const weights: Weighted[] = o.items.map((it) => ({
      category: categoryOf(it.name) || UNSPECIFIED_CATEGORY,
      held: false,
      weight: Number(it.qty || 0) * Number(it.requestedPrice || 0),
    }));
    for (const p of o.payments) {
      if (!isReceived(p)) continue;
      const on = dayOf(p.clearedAt || p.paidAt);
      const amount = Number(p.amount || 0);
      if (!on || !amount) continue;
      for (const share of splitByWeight(amount, weights)) {
        lines.push({ sourceId: o.id, shop: o.shop, on, channel: 'ขายส่ง', ...share });
      }
    }
  }
  return lines;
}

/** The day a receipt belongs to, as the period filter reads dates. */
export const receiptDate = (r: { on: string }) => new Date(`${r.on}T00:00:00`);

export const sumReceipts = (rows: { amount: number }[]) =>
  satang(rows.reduce((n, r) => n + r.amount, 0));
