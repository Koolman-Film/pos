import { createClient } from '@/lib/supabase/server';
import { itemNetPrice } from '@/lib/domain/tickets';

/**
 * รายการการขาย — one row per product line sold, which is what the shop asked
 * for: the report is read by ชนิดสินค้า, not by ticket.
 *
 * The sale date is the ticket's วันที่รับงาน, the same date the dashboard counts
 * revenue on, so the two screens can never disagree about a month's takings.
 * ประกัน is the exception and carries its own `sold_at` — it is often bought
 * long after the job (migration 0023) — so it lands in the month the money
 * actually came in.
 */
export type SaleLine = {
  ticketId: string;
  shop: string;
  soldAt: string;
  customer: string;
  plate: string;
  category: string;
  product: string;
  /** Net of the line's own discount, which is what was actually charged. */
  amount: number;
  /** เลขที่ใบกำกับภาษี if one was issued for this ticket, else ''. */
  taxInvoiceNo: string;
  /** Every document issued for the ticket, for the "เอกสาร" column. */
  documents: { docType: string; docNo: string; issuedAt: string }[];
};

const TAX_INVOICE = 'ใบกำกับภาษี/ใบเสร็จรับเงิน';

export async function loadSaleLines(): Promise<SaleLine[]> {
  const supabase = await createClient();

  // RLS scopes all three to the caller's shops.
  const [{ data: ticketRows }, { data: policyRows }, { data: docRows }] = await Promise.all([
    supabase
      .from('tickets')
      .select(
        'id, shop_id, customer_name, plate, drop_off_date, ' +
          'ticket_items(category, sold, sold_price, discount_type, discount_value)',
      )
      .is('deleted_at', null),
    supabase.from('insurance_policies').select('ticket_id, plan_name, price, sold_at'),
    supabase.from('ticket_documents').select('ticket_id, doc_type, doc_no, issued_at'),
  ]);

  type TicketRow = {
    id: string;
    shop_id: string;
    customer_name: string;
    plate: string;
    drop_off_date: string | null;
    ticket_items: {
      category: string;
      sold: string;
      sold_price: number;
      discount_type: string | null;
      discount_value: number | null;
    }[];
  };

  const docsByTicket = new Map<string, SaleLine['documents']>();
  for (const d of docRows ?? []) {
    const list = docsByTicket.get(d.ticket_id) ?? [];
    list.push({ docType: d.doc_type, docNo: d.doc_no, issuedAt: d.issued_at });
    docsByTicket.set(d.ticket_id, list);
  }
  const taxNo = (ticketId: string) =>
    docsByTicket.get(ticketId)?.find((d) => d.docType === TAX_INVOICE)?.docNo ?? '';

  const tickets = (ticketRows ?? []) as unknown as TicketRow[];
  const byId = new Map(tickets.map((t) => [t.id, t]));

  const lines: SaleLine[] = [];
  for (const t of tickets) {
    const soldAt = (t.drop_off_date ?? '').slice(0, 10);
    for (const i of t.ticket_items ?? []) {
      // A line with no product is a row somebody started and left; it has no
      // price and no name, and printing it would pad the report with blanks.
      if (!i.sold) continue;
      lines.push({
        ticketId: t.id,
        shop: t.shop_id,
        soldAt,
        customer: t.customer_name,
        plate: t.plate,
        category: i.category || 'ไม่ระบุชนิด',
        product: i.sold,
        amount: itemNetPrice({
          soldPrice: Number(i.sold_price || 0),
          discountType: (i.discount_type as 'percent' | 'amount' | null) ?? undefined,
          discountValue: i.discount_value != null ? Number(i.discount_value) : undefined,
        }),
        taxInvoiceNo: taxNo(t.id),
        documents: docsByTicket.get(t.id) ?? [],
      });
    }
  }

  for (const p of policyRows ?? []) {
    const t = byId.get(p.ticket_id);
    if (!t) continue;
    lines.push({
      ticketId: p.ticket_id,
      shop: t.shop_id,
      // Its own date — the whole reason a policy is not a ticket line.
      soldAt: (p.sold_at ?? '').slice(0, 10),
      customer: t.customer_name,
      plate: t.plate,
      category: 'ประกัน',
      product: p.plan_name || 'ประกัน',
      amount: Number(p.price || 0),
      taxInvoiceNo: taxNo(p.ticket_id),
      documents: docsByTicket.get(p.ticket_id) ?? [],
    });
  }

  return lines.sort((a, b) => (a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0));
}
