import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { itemNetPrice } from '@/lib/domain/tickets';
import { summarizePayments, type PaymentSummary } from '@/lib/domain/docPayment';
import { isReceived, orderTotal } from '@/lib/domain/orders';
import { wholesaleRevenueLines, type WholesaleRevenueOrder } from '@/lib/domain/wholesaleRevenue';

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
  /** เลขที่เอกสาร PEAK ของรายได้ Finnix บนใบงานนี้ (0072) — ว่างเมื่อยังไม่กรอก. */
  finnixDocNo: string;
  /**
   * ยอดที่เข้าบัญชีซึ่งเป็นของ Finnix จริง บนใบงานนี้ (0069 + 0071).
   *
   * Compared with what was SOLD as รายได้ Finnix, the difference is money
   * sitting on the wrong side — which nobody could measure before an account
   * could say whose it was.
   */
  paidIntoFinnix: number;
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
  /*
    ข้อมูลที่รายงานขาด (ร้านขอ 22 ก.ย. 2569): จองผ่าน, ยี่ห้อ/รุ่น, การชำระเงิน.
    Blank on a wholesale line, which has no booking channel and no vehicle.
  */
  bookingChannel?: string;
  car?: string;
  /**
   * The DOCUMENT's payments, the same on each of its lines. A report counts
   * `paid` / `due` once per document — see components/revenue/revenueReport.ts.
   */
  payment?: PaymentSummary;
};

const TAX_INVOICE = 'ใบกำกับภาษี/ใบเสร็จรับเงิน';

export async function loadSaleLines(): Promise<SaleLine[]> {
  const supabase = await createClient();

  // RLS scopes all three to the caller's shops.
  const [
    { data: ticketRows },
    { data: policyRows },
    { data: docRows },
    { data: accountRows },
    { data: costRows },
  ] = await Promise.all([
    supabase
      .from('tickets')
      .select(
        'id, shop_id, customer_name, plate, brand, model, booking_channel, drop_off_date, revenue_kind, finnix_doc_no, ' +
          'ticket_items(category, sold, sold_price, discount_type, discount_value, revenue_kind, finnix_doc_no), ' +
          'ticket_payments(amount, method)',
      )
      .is('deleted_at', null),
    supabase.from('insurance_policies').select('ticket_id, plan_name, price, sold_at, paid_amount'),
    supabase.from('ticket_documents').select('ticket_id, doc_type, doc_no, issued_at'),
    // แหล่งเงินที่เป็นของ Finnix — which account each payment landed in is
    // what says whether the money went where it belonged (0069).
    supabase.from('money_accounts').select('shop_id, name, match_names, owner'),
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
    finnix_doc_no: string | null;
    brand: string | null;
    model: string | null;
    booking_channel: string | null;
    ticket_payments: { amount: number; method: string }[] | null;
    ticket_items: {
      category: string;
      sold: string;
      sold_price: number;
      revenue_kind: string | null;
      finnix_doc_no: string | null;
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

  /*
    การชำระเงินของใบงาน — ค่าสินค้าอย่างเดียว.

    ค่าประกันไม่รวมอยู่ในนี้ (0071): it has its own payment, received on its own
    day, because a policy is usually bought after the job was delivered, paid
    in full and LOCKED — and a locked ticket refuses new payments. The policy
    line below carries its own paid/due.
  */
  /*
    เงินที่เข้าบัญชีของ Finnix จริง ต่อใบงาน (0069).

    A payment names its แหล่งเงิน as free text, so it is matched to an account
    the way the balances match it: by the account's own name and its
    `match_names`, first claim in the branch wins. A label nobody claims is
    NOT assumed to be the branch's — it simply is not counted as Finnix's,
    which is the honest answer and leaves the difference visible.
  */
  const finnixLabels = new Map<string, Set<string>>();
  for (const a of accountRows ?? []) {
    if (a.owner !== 'Finnix') continue;
    const set = finnixLabels.get(a.shop_id) ?? new Set<string>();
    for (const label of [a.name, ...(a.match_names ?? [])]) {
      if (label) set.add(label);
    }
    finnixLabels.set(a.shop_id, set);
  }
  const finnixPaidOn = new Map<string, number>();
  for (const t of tickets) {
    const labels = finnixLabels.get(t.shop_id);
    if (!labels) continue;
    const into = (t.ticket_payments ?? []).reduce(
      (n, p) => n + (labels.has((p.method ?? '').trim()) ? Number(p.amount || 0) : 0),
      0,
    );
    if (into) finnixPaidOn.set(t.id, Math.round(into * 100) / 100);
  }

  const paymentOf = new Map<string, PaymentSummary>();
  for (const t of tickets) {
    const total = (t.ticket_items ?? []).reduce(
      (s, i) =>
        s +
        itemNetPrice({
          soldPrice: Number(i.sold_price || 0),
          discountType: (i.discount_type as 'percent' | 'amount' | null) ?? undefined,
          discountValue: i.discount_value != null ? Number(i.discount_value) : undefined,
        }),
      0,
    );
    paymentOf.set(
      t.id,
      summarizePayments(
        total,
        (t.ticket_payments ?? []).map((p) => ({ amount: Number(p.amount || 0), method: p.method })),
      ),
    );
  }
  // The document's summary rides on every one of its lines; a report counts
  // the amounts once per document (components/revenue/revenueReport.ts), on
  // whichever of its lines it prints first — so a filter hiding the first
  // line cannot hide the money.
  const paymentForLine = (ticketId: string): PaymentSummary | undefined => paymentOf.get(ticketId);
  const carOf = (t: TicketRow) => [t.brand, t.model].filter(Boolean).join(' ');

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
        // ทีละรายการ ไม่ใช่ทั้งใบงาน (0068): one job can sell the branch’s own
        // work alongside another branch’s, and the report has a line for each.
        held: i.revenue_kind === 'รับแทน',
        taxInvoiceNo: taxNo(t.id),
        finnixDocNo: i.finnix_doc_no ?? '',
        paidIntoFinnix: finnixPaidOn.get(t.id) ?? 0,
        documents: docsByTicket.get(t.id) ?? [],
        channel: 'ปลีก',
        bookingChannel: t.booking_channel ?? '',
        car: carOf(t),
        payment: paymentForLine(t.id),
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
      // ประกันเป็นรายได้ของสาขาเสมอ จึงไม่มีเอกสาร Finnix
      finnixDocNo: '',
      // A policy is the branch's revenue, so it is never on the Finnix side.
      paidIntoFinnix: 0,
      documents: docsByTicket.get(p.ticket_id) ?? [],
      channel: 'ปลีก',
      bookingChannel: t.booking_channel ?? '',
      car: carOf(t),
      /*
        การชำระเงินของกรมธรรม์เอง (0071) — not the ticket's. It is bought as
        often as not after the job was paid for and closed, so its money never
        went through the ticket at all.
      */
      payment: summarizePayments(Number(p.price || 0), [
        { amount: Number(p.paid_amount || 0), method: 'ค่าประกัน' },
      ]),
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

  const [{ data: orderRows }, { data: customerRows }, stockRows, { data: costRows }] =
    await Promise.all([
      supabase
        .from('orders')
        .select(
          'id, shop_id, customer_id, delivered_at, sales_by, order_items(name, qty, requested_price), order_returns(item_name, qty, returned_at), order_adjustments(amount, reason, adjusted_at, status), order_payments(amount, method, status)',
        )
        .is('deleted_at', null)
        .not('delivered_at', 'is', null),
      supabase.from('wholesale_customers').select('id, name'),
      // ชนิดสินค้าของขายส่ง มาจากทะเบียนสินค้า so a roll of film reads under the
      // same ชนิดสินค้า whether it was sold over the counter or by the case.
      //
      // Paged, because a truncated read here does not fail — it quietly files
      // real sales under ไม่ระบุชนิด.
      fetchAllRows<{ name: string; category: string }>(
        (from, to) => supabase.from('stock').select('name, category').order('name').range(from, to),
        'stock',
      ),
      supabase
        .from('stock_movements')
        .select('document_id, cost_total')
        .in('kind', ['ขายส่ง', 'ลบ PO ขายส่ง', 'กู้คืน PO ขายส่ง']),
    ]);

  const customerName = new Map((customerRows ?? []).map((c) => [c.id, c.name]));
  const categoryOf = new Map<string, string>();
  for (const st of stockRows) {
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

  /*
    วันไหนนับเป็นยอดขาย และเท่าไหร่ — อยู่ใน `lib/domain/wholesaleRevenue.ts`.

    The dashboard counts the same takings, and two screens quoting different
    numbers for the same month is the one failure neither of them recovers
    from. So the rule lives in one place and this function only decorates its
    output with the things a report needs and a total does not: who bought,
    which ชนิดสินค้า it falls under, and what it cost.
  */
  const orders: WholesaleRevenueOrder[] = (orderRows ?? []).map((o) => ({
    id: o.id,
    shop: o.shop_id,
    deliveredAt: o.delivered_at,
    items: (o.order_items ?? []).map((i) => ({
      name: i.name,
      qty: Number(i.qty || 0),
      requestedPrice: Number(i.requested_price || 0),
    })),
    returns: (o.order_returns ?? []).map((r) => ({
      item: r.item_name,
      qty: Number(r.qty || 0),
      date: r.returned_at,
    })),
    adjustments: (o.order_adjustments ?? []).map((a) => ({
      amount: Number(a.amount || 0),
      reason: a.reason ?? '',
      date: a.adjusted_at,
      // เฉพาะที่อนุมัติแล้วที่ลดยอดขาย (0050).
      status: a.status ?? '',
    })),
  }));

  const orderById = new Map((orderRows ?? []).map((o) => [o.id, o]));

  /*
    การชำระเงินของ PO — only money actually received counts as paid, the same
    rule every money figure in the app uses; a cheque that is only reported
    is still owed.
  */
  const orderPayment = new Map<string, PaymentSummary>();
  for (const o of orders) {
    const row = orderById.get(o.id);
    orderPayment.set(
      o.id,
      summarizePayments(
        orderTotal(o),
        (row?.order_payments ?? [])
          .filter((p) => isReceived({ status: p.status ?? undefined }))
          .map((p) => ({ amount: Number(p.amount || 0), method: p.method ?? '' })),
      ),
    );
  }
  // The ledger records consumption against the PO, not against a line of it,
  // so the cost rides on that PO’s first line — the same rule retail uses.
  const costLeft = new Map<string, number>();
  for (const o of orderRows ?? []) {
    costLeft.set(o.id, Math.max(0, -(costByOrder.get(o.id) ?? 0)));
  }

  return wholesaleRevenueLines(orders).map((l) => {
    const o = orderById.get(l.orderId);
    const isSale = l.kind === 'ขาย';
    const cost = isSale ? (costLeft.get(l.orderId) ?? 0) : 0;
    if (isSale) costLeft.set(l.orderId, 0);
    return {
      ticketId: l.orderId,
      shop: l.shop,
      soldAt: l.on,
      customer: customerName.get(o?.customer_id ?? -1) ?? 'ไม่ระบุลูกค้า',
      // A wholesale sale has no vehicle. The column carries the rep instead —
      // it is the 'who' the shop reads this report by.
      plate: o?.sales_by ?? '',
      category: l.kind === 'ปรับราคา' ? 'ปรับราคา' : (categoryOf.get(l.item) ?? 'ไม่ระบุชนิด'),
      product: l.kind === 'คืนสินค้า' ? `คืนสินค้า: ${l.item}` : l.item,
      amount: l.amount,
      cost,
      held: false,
      taxInvoiceNo: '',
      // ขายส่งไม่มีรายได้ Finnix — a PO is raised by the branch that sells it.
      finnixDocNo: '',
      paidIntoFinnix: 0,
      documents: [],
      channel: 'ส่ง' as const,
      bookingChannel: '',
      car: '',
      payment: orderPayment.get(l.orderId),
    };
  });
}
