/**
 * คีย์ประจำรายการรับชำระ.
 *
 * Both `save_order_children` and `save_ticket_children` delete and re-insert
 * every child row on each save, so the database id is not stable: nothing that
 * must survive a save — a wholesale confirmation, a retail payment's own date —
 * can be keyed on it. This is generated once when the row is added and carried
 * through every later save.
 *
 * `crypto.randomUUID` is not in every browser this shop runs (nor in jsdom),
 * and uniqueness within one document is all that is asked of it.
 */
export function newPaymentUid(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
