// Ported behavior-for-behavior from reference/v0.4/finnix-film.html:387-394.
// Do not "improve" the rounding or discount handling — these are the calculations
// the "unchanged business functionality" constraint protects.

export type TicketItem = {
  soldPrice: number;
  discountType?: 'percent' | 'amount';
  discountValue?: number;
};
export type TicketPayment = { amount: number };
export type TicketForTotals = { items: TicketItem[]; payments: TicketPayment[] };

export function itemNetPrice(i: TicketItem): number {
  const price = Number(i.soldPrice || 0);
  if (!i.discountType || !i.discountValue) return price;
  if (i.discountType === 'percent') return Math.max(0, price - (price * Number(i.discountValue)) / 100);
  return Math.max(0, price - Number(i.discountValue));
}

export function ticketTotal(t: TicketForTotals): number {
  return t.items.reduce((s, i) => s + itemNetPrice(i), 0);
}

export function ticketPaid(t: TicketForTotals): number {
  return t.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
}
