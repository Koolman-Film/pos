// Ported behavior-for-behavior from reference/v0.4/finnix-film.html:331-337.
// Returns are priced off the first order item whose `name` matches `return.item`.

export type OrderItem = { name: string; qty: number; requestedPrice: number };
export type OrderReturn = { item: string; qty: number };
export type OrderAdjustment = { amount: number };
export type OrderPayment = { amount: number };
export type OrderForTotals = {
  items: OrderItem[];
  returns: OrderReturn[];
  adjustments: OrderAdjustment[];
};

export function orderTotal(o: OrderForTotals): number {
  const itemsTotal = o.items.reduce((s, i) => s + i.qty * i.requestedPrice, 0);
  const returnsTotal = o.returns.reduce((s, r) => {
    const it = o.items.find((i) => i.name === r.item);
    return s + (it ? r.qty * it.requestedPrice : 0);
  }, 0);
  const adjustmentsTotal = (o.adjustments || []).reduce((s, a) => s + Number(a.amount || 0), 0);
  return itemsTotal - returnsTotal - adjustmentsTotal;
}

export function orderPaid(o: { payments: OrderPayment[] }): number {
  return o.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
}
