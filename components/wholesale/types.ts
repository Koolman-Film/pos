/**
 * Client-side ("camelCase") view models for the wholesale module.
 *
 * The database rows (see `lib/types/database.ts`) are snake_case; the server
 * pages under `app/(app)/wholesale/**` map them into these shapes before handing
 * them to the client components, exactly mirroring the objects the prototype's
 * `WholesaleModule` kept in React state (reference/v0.4/finnix-film.html:310-330).
 *
 * These are intentionally structurally compatible with `OrderForTotals` in
 * `lib/domain/orders.ts`, so `orderTotal` / `orderPaid` can be called on a
 * `WsOrder` directly — the domain layer is the single source of truth for the
 * money math (including the deliberate C5 duplicate-name defect).
 */

export type WsItem = {
  name: string;
  qty: number;
  listPrice: number;
  requestedPrice: number;
  reason: string;
};

export type WsReturn = { item: string; qty: number; reason: string };

export type WsAdjustment = { amount: number; reason: string; date: string };

export type WsPayment = {
  amount: number;
  method: string;
  date: string;
  attachments: string[];
};

export type WsOrder = {
  id: string;
  shop: string;
  customerId: number | null;
  status: string;
  items: WsItem[];
  returns: WsReturn[];
  adjustments: WsAdjustment[];
  payments: WsPayment[];
};

export type WsCustomer = { id: number; name: string; phone: string; address: string };

/** Colour triple per status key — the prototype's `DEFAULT_WS_STATUS` shape. */
export type WsStatus = { bg: string; text: string; dot: string };
export type WsStatusMap = Record<string, WsStatus>;

export type WsStockItem = {
  id: number;
  name: string;
  shortName: string;
  shop: string;
  qty: number;
  sellPrice: number;
};

export type WsShopInfo = {
  companyName?: string;
  address?: string;
  phone?: string;
  paymentChannels?: string[];
};

export type Shop = { id: string; name: string };

/** Payload the `saveOrder` server action accepts (a subset of `WsOrder`). */
export type SaveOrderInput = WsOrder;

/** Prototype: `reference/v0.4/finnix-film.html:296`. */
export function customerName(id: number | null, customers: WsCustomer[]): string {
  return customers.find((c) => c.id === id)?.name || 'ยังไม่ระบุลูกค้า';
}

/** Prototype: `reference/v0.4/finnix-film.html:372` (`shopName`, backed by `SHOPS`). */
export function shopName(id: string, shops: Shop[]): string {
  return shops.find((s) => s.id === id)?.name || id;
}

/** Prototype: `reference/v0.4/finnix-film.html:297-301`. */
export function customerPurchasedProducts(customerId: number | null, orders: WsOrder[]): string[] {
  const names = new Set<string>();
  orders
    .filter((ord) => ord.customerId === customerId)
    .forEach((ord) => ord.items.forEach((it) => it.name && names.add(it.name)));
  return [...names];
}

/** Prototype: `reference/v0.4/finnix-film.html:303-309`. */
export const DEFAULT_WS_STATUS: WsStatusMap = {
  รออนุมัติราคา: { bg: '#FBF1DA', text: '#8A5A12', dot: '#E8B23D' },
  รอจัดส่ง: { bg: '#DEEEEC', text: '#286B62', dot: '#2F8F82' },
  จัดส่งแล้ว: { bg: '#E6EFDC', text: '#4C7A3E', dot: '#6BA24F' },
  ค้างชำระ: { bg: '#FBEAEC', text: '#B23A48', dot: '#C24B57' },
  ปิดงานแล้ว: { bg: '#F1EDE7', text: '#6B5F55', dot: '#B5AAA1' },
};

/** Prototype: `reference/v0.4/finnix-film.html:302`. */
export const DEFAULT_PAYMENT_METHODS = ['เงินสด', 'โอนเงิน', 'บัตรเครดิต'];

/** Prototype: `reference/v0.4/finnix-film.html:330`. Blank draft for a new PO. */
export function blankOrder(shop: string): WsOrder {
  return {
    id: 'WS-NEW-' + Math.floor(Math.random() * 9000 + 1000),
    shop,
    customerId: null,
    status: 'รออนุมัติราคา',
    items: [],
    returns: [],
    adjustments: [],
    payments: [],
  };
}
