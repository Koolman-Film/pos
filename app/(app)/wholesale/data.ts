import { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth/session';
import {
  DEFAULT_PAYMENT_METHODS,
  blankOrder,
  type Shop,
  type WsCustomer,
  type WsDeletedOrder,
  type WsOrder,
  type WsShopInfo,
  type WsStatusMap,
  type WsStockItem,
} from '@/components/wholesale/types';

/**
 * Server-side data access + row → view-model mapping for the wholesale pages.
 *
 * Not a Server Action file (no `'use server'`) — these are plain async helpers
 * imported by the Server Components in `page.tsx` / `[id]/page.tsx`. Reads are
 * scoped to the caller's `accessibleShopIds`; RLS (migration 0007) enforces the
 * same scope in the database.
 */

const ORDER_SELECT = `
  id, shop_id, customer_id, status, created_at,
  order_items(name, qty, list_price, requested_price, reason),
  order_returns(item_name, qty, reason),
  order_adjustments(amount, reason),
  order_payments(amount, method)
`;

type OrderRow = {
  id: string;
  shop_id: string;
  customer_id: number | null;
  status: string;
  created_at: string | null;
  order_items:
    | {
        name: string;
        qty: number;
        list_price: number;
        requested_price: number;
        reason: string;
      }[]
    | null;
  order_returns: { item_name: string; qty: number; reason: string }[] | null;
  order_adjustments: { amount: number; reason: string }[] | null;
  order_payments: { amount: number; method: string }[] | null;
};

function mapOrder(row: OrderRow): WsOrder {
  return {
    id: row.id,
    shop: row.shop_id,
    customerId: row.customer_id,
    status: row.status,
    createdAt: row.created_at ?? undefined,
    items: (row.order_items ?? []).map((it) => ({
      name: it.name,
      qty: it.qty,
      listPrice: it.list_price,
      requestedPrice: it.requested_price,
      reason: it.reason ?? '',
    })),
    returns: (row.order_returns ?? []).map((r) => ({
      item: r.item_name,
      qty: r.qty,
      reason: r.reason ?? '',
    })),
    adjustments: (row.order_adjustments ?? []).map((a) => ({
      amount: a.amount,
      reason: a.reason ?? '',
      date: '',
    })),
    payments: (row.order_payments ?? []).map((p) => ({
      amount: p.amount,
      method: p.method,
      date: '',
      attachments: [],
    })),
  };
}

async function loadShops(session: SessionContext): Promise<Shop[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('shops')
    .select('id, name, sort_order')
    .in('id', session.accessibleShopIds)
    .order('sort_order');
  return (data ?? []).map((s) => ({ id: s.id, name: s.name }));
}

async function loadCustomers(): Promise<WsCustomer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('wholesale_customers')
    .select('id, name, phone, address')
    .order('name');
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? '',
    address: c.address ?? '',
  }));
}

async function loadWsStatuses(): Promise<WsStatusMap> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('ws_statuses')
    .select('key, bg, text_color, dot, sort_order')
    .order('sort_order');
  const map: WsStatusMap = {};
  (data ?? []).forEach((s) => {
    map[s.key] = { bg: s.bg, text: s.text_color, dot: s.dot };
  });
  return map;
}

/**
 * ถังขยะ PO — orders flagged by `deleteOrder`, newest deletion first.
 *
 * Only ever rendered for a caller holding `wholesale.restore`, and RLS still
 * scopes the rows to their branches. `deleted_by` is resolved to a name here
 * rather than embedded, so a PO whose deleter has since left still lists.
 */
export async function loadDeletedOrders(session: SessionContext): Promise<{
  orders: WsDeletedOrder[];
  customers: WsCustomer[];
  shops: Shop[];
}> {
  const supabase = await createClient();
  const [ordersRes, usersRes, customers, shops] = await Promise.all([
    supabase
      .from('orders')
      .select(`${ORDER_SELECT}, deleted_at, deleted_by`)
      .in('shop_id', session.accessibleShopIds)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
    supabase.from('app_users').select('id, name'),
    loadCustomers(),
    loadShops(session),
  ]);

  const nameById = new Map((usersRes.data ?? []).map((u) => [u.id, u.name]));
  const rows = (ordersRes.data ?? []) as (OrderRow & {
    deleted_at: string | null;
    deleted_by: string | null;
  })[];

  const orders: WsDeletedOrder[] = rows.map((row) => ({
    ...mapOrder(row),
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    deletedByName: (row.deleted_by && nameById.get(row.deleted_by)) || '',
  }));

  return { orders, customers, shops };
}

export async function loadWholesaleListData(session: SessionContext): Promise<{
  orders: WsOrder[];
  customers: WsCustomer[];
  wsStatuses: WsStatusMap;
  shops: Shop[];
}> {
  const supabase = await createClient();
  const [ordersRes, customers, wsStatuses, shops] = await Promise.all([
    supabase
      .from('orders')
      .select(ORDER_SELECT)
      .in('shop_id', session.accessibleShopIds)
      // Deleted POs (migration 0040) are out of the list and out of every
      // figure derived from it. The bin below is the only place they surface.
      .is('deleted_at', null),
    loadCustomers(),
    loadWsStatuses(),
    loadShops(session),
  ]);
  const orders = ((ordersRes.data as OrderRow[] | null) ?? []).map(mapOrder);
  return { orders, customers, wsStatuses, shops };
}

export async function loadOrderDetailData(
  session: SessionContext,
  id: string,
): Promise<{
  order: WsOrder | null;
  isNew: boolean;
  customers: WsCustomer[];
  orders: WsOrder[];
  stock: WsStockItem[];
  wsStatuses: WsStatusMap;
  shops: Shop[];
  shopInfo: Record<string, WsShopInfo>;
  paymentMethods: string[];
} | null> {
  const supabase = await createClient();
  const shops = await loadShops(session);
  const isNew = id === 'new';

  let order: WsOrder | null;
  if (isNew) {
    order = blankOrder(shops[0]?.id ?? 'cm');
  } else {
    const { data } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!data) return null;
    order = mapOrder(data as OrderRow);
    // Do not surface an order from a shop the caller cannot access.
    if (!session.accessibleShopIds.includes(order.shop)) return null;
  }

  const [customers, wsStatuses, allOrdersRes, stockRes, shopInfoRes, methodsRes] =
    await Promise.all([
      loadCustomers(),
      loadWsStatuses(),
      supabase
        .from('orders')
        .select(ORDER_SELECT)
        .in('shop_id', session.accessibleShopIds)
        .is('deleted_at', null),
      /*
        Stock for EVERY branch the caller can reach, not just the one the PO
        opens on.

        A new PO starts on the first branch in the list and the branch can be
        changed while it is new — but this read was pinned to the starting
        branch, and the product picker filters what it was given by `o.shop`.
        So switching a new PO to another branch left the picker with nothing
        to offer: goods really were on that branch's shelf and the PO could
        not sell them. Finnix North, whose whole purpose is wholesale, could
        not raise a single line.
      */
      supabase
        .from('stock')
        .select('id, name, short_name, shop_id, qty, sell_price')
        .in('shop_id', session.accessibleShopIds),
      supabase.from('shop_info').select('shop_id, company_name, address, phone, payment_channels'),
      supabase
        .from('option_lists')
        .select('value, sort_order, list_key')
        .eq('list_key', 'payment_methods')
        .order('sort_order'),
    ]);

  const orders = ((allOrdersRes.data as OrderRow[] | null) ?? []).map(mapOrder);

  const stock: WsStockItem[] = (stockRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    shortName: s.short_name ?? '',
    shop: s.shop_id,
    qty: s.qty,
    sellPrice: s.sell_price,
  }));

  const shopInfo: Record<string, WsShopInfo> = {};
  (shopInfoRes.data ?? []).forEach((si) => {
    shopInfo[si.shop_id] = {
      companyName: si.company_name ?? '',
      address: si.address ?? '',
      phone: si.phone ?? '',
      paymentChannels: si.payment_channels ?? [],
    };
  });

  const paymentMethods = (methodsRes.data ?? []).map((m) => m.value);

  return {
    order,
    isNew,
    customers,
    orders,
    stock,
    wsStatuses,
    shops,
    shopInfo,
    paymentMethods: paymentMethods.length ? paymentMethods : DEFAULT_PAYMENT_METHODS,
  };
}
