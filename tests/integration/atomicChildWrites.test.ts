import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';

/**
 * `save_ticket_children` / `save_order_children` (migration 0011).
 *
 * The point of these functions is atomicity, so the important tests are the
 * failure ones: force an insert to fail part-way and assert the previous rows are
 * still there. Before migration 0011 those cases lost data — the delete had
 * already committed in its own transaction — so if these ever start passing for
 * the wrong reason (e.g. someone reverts to client-side delete-then-insert), the
 * "survives" assertions are what catch it.
 */

const admin = adminClient();

const TICKET = 'JT-ATOMIC-0001';
const ORDER = 'WS-ATOMIC-0001';

async function cleanup() {
  await admin.from('tickets').delete().eq('id', TICKET);
  await admin.from('orders').delete().eq('id', ORDER);
}

async function seedTicket() {
  const { error } = await admin.from('tickets').insert({
    id: TICKET,
    shop_id: 'cm',
    customer_name: 'ลูกค้าทดสอบ',
    status: 'จองแล้ว',
    drop_off_date: '2026-07-24T09:00:00Z',
    pickup_date: '2026-07-24T17:00:00Z',
  });
  assertNoError('seed atomic ticket', error);

  // One good item with a position, and one payment — the "previous" state.
  const { error: rpcErr } = await admin.rpc('save_ticket_children', {
    p_ticket_id: TICKET,
    p_items: [
      {
        category: 'ฟิล์มกรองแสง',
        booked: '',
        bookedPrice: 0,
        sold: 'ฟิล์ม A',
        soldPrice: 5000,
        discountType: null,
        discountValue: null,
        positions: [{ position: 'บานหน้า', product: 'ฟิล์ม A', price: 5000 }],
        actualQty: { 'ฟิล์ม A': 2 },
      },
    ],
    p_payments: [{ type: 'มัดจำ', method: 'เงินสด', amount: 1000, paidAt: '2026-07-24' }],
  });
  assertNoError('seed atomic ticket children', rpcErr);
}

const itemsOf = async (ticketId: string) => {
  const { data } = await admin
    .from('ticket_items')
    .select('sold, sold_price, actual_qty, ticket_item_positions(position, product, price)')
    .eq('ticket_id', ticketId);
  return data ?? [];
};

const paymentsOf = async (ticketId: string) => {
  const { data } = await admin.from('ticket_payments').select('amount').eq('ticket_id', ticketId);
  return data ?? [];
};

describe('save_ticket_children', () => {
  beforeEach(async () => {
    await cleanup();
    await seedTicket();
  });
  afterAll(cleanup);

  it('replaces the whole child set in one call', async () => {
    const { error } = await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [
        {
          category: 'เครื่องเสียง',
          booked: '',
          bookedPrice: 0,
          sold: 'ลำโพง B',
          soldPrice: 8000,
          discountType: null,
          discountValue: null,
          positions: [],
          actualQty: {},
        },
      ],
      p_payments: [],
    });
    assertNoError('replace children', error);

    const items = await itemsOf(TICKET);
    expect(items).toHaveLength(1);
    expect(items[0].sold).toBe('ลำโพง B');
    expect(await paymentsOf(TICKET)).toHaveLength(0);
  });

  it('keeps each item’s positions attached to that item', async () => {
    // The loop assigns positions by the id it just inserted; getting this wrong
    // silently attaches every position to the last item.
    const mkItem = (sold: string, position: string) => ({
      category: 'ฟิล์มกรองแสง',
      booked: '',
      bookedPrice: 0,
      sold,
      soldPrice: 100,
      discountType: null,
      discountValue: null,
      positions: [{ position, product: sold, price: 100 }],
      actualQty: {},
    });

    await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [mkItem('ฟิล์ม X', 'บานหน้า'), mkItem('ฟิล์ม Y', 'บานหลัง')],
      p_payments: [],
    });

    const items = await itemsOf(TICKET);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.ticket_item_positions).toHaveLength(1);
      expect(item.ticket_item_positions[0].product).toBe(item.sold);
    }
  });

  it('ATOMICITY: a failing item leaves the previous children untouched', async () => {
    // `category` is NOT NULL. An explicit JSON null makes coalesce fall back to
    // '' — so instead force the failure with a bad numeric, which cannot be
    // coalesced away.
    const { error } = await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [
        {
          category: 'ฟิล์มกรองแสง',
          booked: '',
          bookedPrice: 0,
          sold: 'ของใหม่',
          soldPrice: 'ไม่ใช่ตัวเลข', // invalid numeric → the insert must fail
          discountType: null,
          discountValue: null,
          positions: [],
          actualQty: {},
        },
      ],
      p_payments: [],
    });

    expect(error, 'the call must fail, not silently coerce').not.toBeNull();

    // The original single item, its position and its payment must all survive.
    const items = await itemsOf(TICKET);
    expect(items, 'previous items were lost — the write was not atomic').toHaveLength(1);
    expect(items[0].sold).toBe('ฟิล์ม A');
    expect(items[0].ticket_item_positions).toHaveLength(1);
    expect(await paymentsOf(TICKET)).toHaveLength(1);
  });

  it('ATOMICITY: a failure in the SECOND item still rolls back the first', async () => {
    // The most valuable case: the loop has already inserted a row when it fails.
    const good = {
      category: 'ฟิล์มกรองแสง',
      booked: '',
      bookedPrice: 0,
      sold: 'ดีี',
      soldPrice: 1,
      discountType: null,
      discountValue: null,
      positions: [],
      actualQty: {},
    };
    const { error } = await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [good, { ...good, sold: 'พัง', soldPrice: 'x' }],
      p_payments: [],
    });

    expect(error).not.toBeNull();
    const items = await itemsOf(TICKET);
    expect(items).toHaveLength(1);
    expect(items[0].sold, 'a partially-applied write leaked through').toBe('ฟิล์ม A');
  });

  it('clears the children when handed empty arrays', async () => {
    const { error } = await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [],
      p_payments: [],
    });
    assertNoError('clear children', error);
    expect(await itemsOf(TICKET)).toHaveLength(0);
    expect(await paymentsOf(TICKET)).toHaveLength(0);
  });

  it('preserves a null discount rather than coercing it to zero', async () => {
    await admin.rpc('save_ticket_children', {
      p_ticket_id: TICKET,
      p_items: [
        {
          category: 'ฟิล์มกรองแสง',
          booked: '',
          bookedPrice: 0,
          sold: 'ไม่มีส่วนลด',
          soldPrice: 100,
          discountType: null,
          discountValue: null,
          positions: [],
          actualQty: {},
        },
      ],
      p_payments: [],
    });
    const { data } = await admin
      .from('ticket_items')
      .select('discount_type, discount_value')
      .eq('ticket_id', TICKET)
      .single();
    expect(data).toEqual({ discount_type: null, discount_value: null });
  });

  it('round-trips the actual_qty map that drives stock movement', async () => {
    const items = await itemsOf(TICKET);
    expect(items[0].actual_qty).toEqual({ 'ฟิล์ม A': 2 });
  });
});

describe('save_order_children', () => {
  const seedOrder = async () => {
    const { error } = await admin
      .from('orders')
      .insert({ id: ORDER, shop_id: 'cm', customer_id: 1, status: 'รออนุมัติราคา' });
    assertNoError('seed atomic order', error);
    const { error: rpcErr } = await admin.rpc('save_order_children', {
      p_order_id: ORDER,
      p_items: [{ name: 'สินค้าเดิม', qty: 5, listPrice: 100, requestedPrice: 90, reason: '' }],
      p_returns: [{ item: 'สินค้าเดิม', qty: 1, reason: 'ชำรุด' }],
      p_adjustments: [{ amount: 50, reason: 'ค่าส่ง' }],
      p_payments: [{ amount: 200, method: 'เงินสด' }],
      p_saved_on: '2026-07-24',
    });
    assertNoError('seed atomic order children', rpcErr);
  };

  beforeEach(async () => {
    await cleanup();
    await seedOrder();
  });
  afterAll(cleanup);

  const childCounts = async () => {
    const [items, returns, adjustments, payments] = await Promise.all([
      admin.from('order_items').select('name').eq('order_id', ORDER),
      admin.from('order_returns').select('item_name').eq('order_id', ORDER),
      admin.from('order_adjustments').select('amount').eq('order_id', ORDER),
      admin.from('order_payments').select('amount').eq('order_id', ORDER),
    ]);
    return {
      items: items.data ?? [],
      returns: returns.data ?? [],
      adjustments: adjustments.data ?? [],
      payments: payments.data ?? [],
    };
  };

  it('replaces all four child tables together', async () => {
    const { error } = await admin.rpc('save_order_children', {
      p_order_id: ORDER,
      p_items: [{ name: 'สินค้าใหม่', qty: 2, listPrice: 500, requestedPrice: 450, reason: 'ลด' }],
      p_returns: [],
      p_adjustments: [],
      p_payments: [],
      p_saved_on: '2026-07-25',
    });
    assertNoError('replace order children', error);

    const c = await childCounts();
    expect(c.items.map((i) => i.name)).toEqual(['สินค้าใหม่']);
    expect(c.returns).toHaveLength(0);
    expect(c.adjustments).toHaveLength(0);
    expect(c.payments).toHaveLength(0);
  });

  it('ATOMICITY: a bad payment rolls back the items already inserted', async () => {
    // Items insert first, payments last — so this proves the earlier inserts in the
    // same call are undone, which is exactly what the old code could not do.
    const { error } = await admin.rpc('save_order_children', {
      p_order_id: ORDER,
      p_items: [{ name: 'ควรถูกยกเลิก', qty: 1, listPrice: 1, requestedPrice: 1, reason: '' }],
      p_returns: [],
      p_adjustments: [],
      p_payments: [{ amount: 'ไม่ใช่ตัวเลข', method: 'เงินสด' }],
      p_saved_on: '2026-07-25',
    });

    expect(error).not.toBeNull();
    const c = await childCounts();
    expect(
      c.items.map((i) => i.name),
      'the item write was not rolled back',
    ).toEqual(['สินค้าเดิม']);
    expect(c.returns).toHaveLength(1);
    expect(c.adjustments).toHaveLength(1);
    expect(c.payments).toHaveLength(1);
  });

  it('stamps adjustments and payments with the supplied save date', async () => {
    await admin.rpc('save_order_children', {
      p_order_id: ORDER,
      p_items: [],
      p_returns: [],
      p_adjustments: [{ amount: 10, reason: 'x' }],
      p_payments: [{ amount: 20, method: 'โอน' }],
      p_saved_on: '2026-07-26',
    });
    const [{ data: adj }, { data: pay }] = await Promise.all([
      admin.from('order_adjustments').select('adjusted_at').eq('order_id', ORDER).single(),
      admin.from('order_payments').select('paid_at').eq('order_id', ORDER).single(),
    ]);
    expect(adj!.adjusted_at).toBe('2026-07-26');
    expect(pay!.paid_at).toBe('2026-07-26');
  });
});
