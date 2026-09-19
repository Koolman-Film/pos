/**
 * กลับไปรายการใบงาน — กลับไปที่มุมมองเดิม (ร้านขอ 19 ก.ย. 2569).
 *
 * Book งาน is worked branch by branch: pick ลำพูน, pick ค้างชำระ, open a job,
 * come back. The back link went to a bare /tickets, so every trip through a
 * ticket dropped the counter back to ทุกร้าน and the filters had to be set
 * again — several times an hour.
 *
 * The list writes what it is showing here as it changes; the back link reads it
 * and returns to exactly that. It is stored as a query string because that is
 * what the list already accepts on the way in, so the same view is a link
 * somebody can paste to a colleague.
 *
 * sessionStorage, not localStorage: the filter belongs to this tab's trip
 * through the module, not to the machine forever. Every access is guarded —
 * a private window, or storage turned off, must not take the back link with it.
 */

export const TICKET_FILTER_KEY = 'tickets:lastFilter';

export type TicketFilter = {
  shop: string;
  status: string;
  customer: string;
  search: string;
  period: string;
  periodValue: string;
  rangeStart: string;
  rangeEnd: string;
};

/** The defaults the list starts on; they are left out of the query. */
const isAll = (v: string) => !v || v === 'all';

export function ticketFilterQuery(f: Partial<TicketFilter>): string {
  const params = new URLSearchParams();
  if (!isAll(f.shop ?? '')) params.set('shop', f.shop!);
  if (!isAll(f.status ?? '')) params.set('status', f.status!);
  if (!isAll(f.customer ?? '')) params.set('customer', f.customer!);
  if ((f.search ?? '').trim()) params.set('q', f.search!.trim());
  if (f.period) {
    params.set('period', f.period);
    // Only the value the chosen period actually reads.
    if ((f.period === 'month' || f.period === 'year') && f.periodValue) {
      params.set('pv', f.periodValue);
    }
    if (f.period === 'range') {
      if (f.rangeStart) params.set('rs', f.rangeStart);
      if (f.rangeEnd) params.set('re', f.rangeEnd);
    }
  }
  return params.toString();
}

export function rememberTicketFilter(f: Partial<TicketFilter>): void {
  try {
    sessionStorage.setItem(TICKET_FILTER_KEY, ticketFilterQuery(f));
  } catch {
    // Storage off or full: the back link falls back to the plain list.
  }
}

/** Where กลับไปรายการใบงาน should go — the last view, or the plain list. */
export function ticketsHref(): string {
  let query = '';
  try {
    query = sessionStorage.getItem(TICKET_FILTER_KEY) ?? '';
  } catch {
    query = '';
  }
  return query ? `/tickets?${query}` : '/tickets';
}
