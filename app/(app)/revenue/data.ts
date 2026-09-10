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
/** ขายปลีกผ่าน Book งาน หรือ ขายส่งผ่านโมดูลขายส่ง. */
export type SaleChannel = 'ปลีก' | 'ส่ง';

export type SaleLine = {
  /**
   * เลขที่ใบงาน หรือ เลขที่ PO.
   *
   * One id column for both channels, because every figure on the page counts
   * distinct ids and a wholesale PO is exactly as much "one sale" as a ใบงาน.
   * `channel` is what says which screen it opens.
   */
  ticketId: string;
  shop: string;
  soldAt: string;
  customer: string;
  plate: string;
  category: string;
  product: string;
  /** Net of the line's own discount, which is what was actually charged. */
  amount: number;
  /**
   * ต้นทุนของที่ตัดออกไปสำหรับใบงานนี้ (migration 0027).
   *
   * From the LOTS the job actually drew on, not a quantity times an average —
   * which is the difference between a gross margin and a guess. Held per
   * TICKET, because stock is consumed against the job, not against a line.
   */
  cost: number;
  /**
   * เงินรอคืน Finnix — the customer paid this branch for a job that belongs to
   * another Finnix shop (migration 0031). The money was collected and is
   * recorded, but it is not this branch’s takings: it is reported on its own
   * and kept out of ยอดขาย everywhere.
   */
  held: boolean;
  /** เลขที่ใบกำกับภาษี if one was issued for this ticket, else ''. */
  taxInvoiceNo: string;
  /** Every document issued for the ticket, for the "เอกสาร" column. */
  documents: { docType: string; docNo: string; issuedAt: string }[];
  /**
   * ช่องทางการขาย.
   *
   * Central Audio sells retail through Book งาน and wholesale through the
   * ขายส่ง module, and until now the second appeared in NO figure anywhere in
   * the app. Adding it without a channel column would be worse than leaving
   * it out: a jump in takings with nothing to say where it came from.
   */
  channel: SaleChannel;
};

const TAX_INVOICE = 'ใบกำกับภาษี/ใบเสร็จรับเงิน';

export async function loadSaleLines(): Promise<SaleLine[]> {
  const supabase = await createClient();

  // RLS scopes all three to the caller's shops.
  const [{ data: ticketRows }, { data: policyRows }, { data: docRows }, { data: costRows }] =
    await Promise.all([
      supabase
        .from('tickets')
        .select(
          'id, shop_id, customer_name, plate, drop_off_date, revenue_kind, ' +
            'ticket_items(category, sold, sold_price, discount_type, discount_value)',
        )
        .is('deleted_at', null),
      supabase.from('insurance_policies').select('ticket_id, plan_name, price, sold_at'),
      supabase.from('ticket_documents').select('ticket_id, doc_type, doc_no, issued_at'),
      // What the materials cost. Consumption is negative in the ledger, so the
      // sum comes back negative and is flipped where it is read.
      supabase
        .from('stock_movements')
        .select('document_id, cost_total')
        .in('kind', ['ใบงาน', 'ยกเลิกใบงาน', 'กู้คืนใบงาน']),
    ]);

  type TicketRow = {
    id: string;
    shop_id: string;
    customer_name: string;
    plate: string;
    drop_off_date: string | null;
    revenue_kind: string;
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

  /*
    Cost per ticket, netted across cancellations. A job that was deducted, then
    cancelled, then restored nets to what it really consumed, because each of
    those movements carried its own signed cost.
  */
  const costByTicket = new Map<string, number>();
  for (const c of costRows ?? []) {
    if (!c.document_id) continue;
    costByTicket.set(
      c.document_id,
      (costByTicket.get(c.document_id) ?? 0) + Number(c.cost_total || 0),
    );
  }
  // Negative in the ledger (goods leaving); a report reads cost as positive.
  const costOf = (ticketId: string) => Math.max(0, -(costByTicket.get(ticketId) ?? 0));

  const tickets = (ticketRows ?? []) as unknown as TicketRow[];
  const byId = new Map(tickets.map((t) => [t.id, t]));

  const lines: SaleLine[] = [];
  for (const t of tickets) {
    const soldAt = (t.drop_off_date ?? '').slice(0, 10);
    // The ledger records consumption against the JOB, not the line, so the cost
    // rides on the first line of the ticket. Splitting it across lines would
    // need an apportionment rule nobody has asked for, and would read as
    // precision that is not there.
    let costLeft = costOf(t.id);
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
        cost: costLeft,
        held: t.revenue_kind === 'รับแทน',
        taxInvoiceNo: taxNo(t.id),
        documents: docsByTicket.get(t.id) ?? [],
        channel: 'ปลีก',
      });
      costLeft = 0;
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
      // ประกัน has no materials — the cover is the product.
      cost: 0,
      // A policy is sold by the branch that sold it, even on a held job.
      held: false,
      taxInvoiceNo: taxNo(p.ticket_id),
      documents: docsByTicket.get(p.ticket_id) ?? [],
      channel: 'ปลีก',
    });
  }

  lines.push(...(await wholesaleLines()));

  return lines.sort((a, b) => (a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0));
}

/**
 * รายการขายส่ง — หนึ่งบรรทัดต่อหนึ่งรายการสินค้าใน PO.
 *
 * **วันที่ที่นับ คือวันส่งของ** (`orders.delivered_at`, migration 0045), not the
 * day the PO was raised and not the day the money arrived. Wholesale delivers
 * first and is paid weeks later, so those three dates fall in three different
 * months and only one of them is when the sale was earned. A PO that has not
 * been delivered yet has earned nothing and is not here at all.
 *
 * การคืนสินค้าและการปรับราคาเป็นบรรทัดของตัวเอง ติดลบ ลงวันที่ของมันเอง — a
 * March sale returned in May must reduce May, not reach back and change a
 * month that has already been reported and reconciled.
 */
async function wholesaleLines(): Promise<SaleLine[]> {
  const supabase = await createClient();

  const [{ data: orderRows }, { data: customerRows }, { data: stockRows }, { data: costRows }] =
    await Promise.all([
      supabase
        .from('orders')
        .select(
          'id, shop_id, customer_id, delivered_at, sales_by, order_items(name, qty, requested_price), order_returns(item_name, qty, returned_at), order_adjustments(amount, reason, adjusted_at)',
        )
        .is('deleted_at', null)
        .not('delivered_at', 'is', null),
      supabase.from('wholesale_customers').select('id, name'),
      // ชนิดสินค้าของขายส่ง มาจากทะเบียนสินค้า so a roll of film reads under the
      // same ชนิดสินค้า whether it was sold over the counter or by the case.
      supabase.from('stock').select('name, category'),
      supabase
        .from('stock_movements')
        .select('document_id, cost_total')
        .in('kind', ['ขายส่ง', 'ลบ PO ขายส่ง', 'กู้คืน PO ขายส่ง']),
    ]);

  const customerName = new Map((customerRows ?? []).map((c) => [c.id, c.name]));
  const categoryOf = new Map<string, string>();
  for (const st of stockRows ?? []) {
    if (st.name && st.category && !categoryOf.has(st.name)) categoryOf.set(st.name, st.category);
  }

  const costByOrder = new Map<string, number>();
  for (const c of costRows ?? []) {
    if (!c.document_id) continue;
    costByOrder.set(
      c.document_id,
      (costByOrder.get(c.document_id) ?? 0) + Number(c.cost_total || 0),
    );
  }

  const lines: SaleLine[] = [];
  for (const o of orderRows ?? []) {
    const soldAt = (o.delivered_at ?? '').slice(0, 10);
    const customer = customerName.get(o.customer_id ?? -1) ?? 'ไม่ระบุลูกค้า';
    // Like retail, the cost rides on the first line: the ledger records
    // consumption against the PO, not against a line of it.
    let costLeft = Math.max(0, -(costByOrder.get(o.id) ?? 0));

    const base = {
      ticketId: o.id,
      shop: o.shop_id,
      customer,
      // A wholesale sale has no vehicle. The column carries the rep instead —
      // it is the 'who' the shop reads this report by.
      plate: o.sales_by ?? '',
      held: false,
      taxInvoiceNo: '',
      documents: [],
      channel: 'ส่ง' as const,
    };

    for (const it of o.order_items ?? []) {
      if (!it.name) continue;
      lines.push({
        ...base,
        soldAt,
        category: categoryOf.get(it.name) ?? 'ไม่ระบุชนิด',
        product: it.name,
        amount: Number(it.qty || 0) * Number(it.requested_price || 0),
        cost: costLeft,
      });
      costLeft = 0;
    }

    // Priced off the line it came back from, exactly as `orderTotal` does.
    const priceOf = (name: string) =>
      Number((o.order_items ?? []).find((i) => i.name === name)?.requested_price || 0);
    for (const r of o.order_returns ?? []) {
      const amount = Number(r.qty || 0) * priceOf(r.item_name);
      if (!amount) continue;
      lines.push({
        ...base,
        soldAt: (r.returned_at ?? soldAt).slice(0, 10),
        category: categoryOf.get(r.item_name) ?? 'ไม่ระบุชนิด',
        product: `คืนสินค้า: ${r.item_name}`,
        amount: -amount,
        cost: 0,
      });
    }

    for (const a of o.order_adjustments ?? []) {
      const amount = Number(a.amount || 0);
      if (!amount) continue;
      lines.push({
        ...base,
        soldAt: (a.adjusted_at ?? soldAt).slice(0, 10),
        category: 'ปรับราคา',
        product: a.reason || 'ปรับราคาหลังส่งของ',
        // Positive in the table means the bill went DOWN, so it subtracts.
        amount: -amount,
        cost: 0,
      });
    }
  }

  return lines;
}
