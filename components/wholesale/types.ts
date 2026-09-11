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

/**
 * การคืนสินค้าหนึ่งรายการ.
 *
 * `date` is what the return reduces revenue ON (migration 0045). Without it a
 * return could only ever be netted off the PO as a whole, so a March sale
 * returned in May took March’s figure down two months after it was reported.
 */
/**
 * การคืนสินค้าหนึ่งรายการ.
 *
 * `date` is what the return reduces revenue ON (migration 0045) — a business
 * date, routinely backdated by agreement. `receivedAt` is a different fact:
 * the day the boxes actually came back through the door, which is the only
 * thing that may put stock on the shelf (migration 0054). A return that is
 * agreed but not yet received must not move the count.
 */
export type WsReturn = {
  item: string;
  qty: number;
  reason: string;
  date: string;
  /** Client-generated key that survives a save — the confirmation hangs off it. */
  uid?: string;
  /** ยืนยันแล้วว่าได้ของคืนจริง. Empty = still owed back to us. */
  receivedAt?: string;
};

/**
 * การปรับราคาหนึ่งรายการ (migration 0050).
 *
 * ต้องให้ผู้บริหารอนุมัติเหมือนการเสนอราคาต่ำกว่ามาตรฐาน — it gives away the
 * same money, and it is written after the goods have already gone out.
 * `uid` is what the approval is keyed on across a save, exactly as on a
 * payment: the rows are deleted and re-inserted every time the PO is saved.
 */
export type WsAdjustment = {
  amount: number;
  reason: string;
  date: string;
  uid?: string;
  /** รออนุมัติ / อนุมัติแล้ว / ปฏิเสธ. Empty from a pre-0050 client — read as อนุมัติแล้ว. */
  status?: string;
  approvedAt?: string;
  rejectNote?: string;
};

/**
 * การรับชำระหนึ่งรายการ (migration 0048).
 *
 * ขายส่งรับเป็นเช็คลงวันที่ล่วงหน้าเป็นส่วนใหญ่ — so one of these covers three
 * separate days: `date` is when it was taken in, `chequeDate` is what is
 * written on the cheque, and `clearedAt` is when the money actually arrived.
 * Only the last one is money.
 */
export type WsPayment = {
  amount: number;
  method: string;
  /** วันที่รับชำระ — `order_payments.paid_at`. */
  date: string;
  /**
   * คีย์ประจำรายการที่ไคลเอนต์สร้าง.
   *
   * `save_order_children` deletes and re-inserts every child row, so the
   * database id changes on each save. This is what a confirmation is keyed on,
   * and what carries the confirmed state back across a save. Empty on a row
   * typed by an older client; those cannot be confirmed until saved again.
   */
  uid?: string;
  /** แจ้งแล้ว / รับเงินแล้ว / เด้ง. Empty from a pre-0048 client — read as รับเงินแล้ว. */
  status?: string;
  chequeNo?: string;
  chequeBank?: string;
  /** วันที่หน้าเช็ค — วันที่ที่คาดว่าเงินจะเข้า. */
  chequeDate?: string;
  /** วันที่เงินเข้าจริง. Set by ยืนยันเงินเข้า, never typed on this form. */
  clearedAt?: string;
  bouncedAt?: string;
  bounceNote?: string;
  attachments: string[];
};

export type WsOrder = {
  id: string;
  shop: string;
  customerId: number | null;
  status: string;
  /**
   * วันที่ส่งของ — the date the sale is earned, set by issuing ใบส่งของ.
   *
   * Empty means the goods have not gone out (or, on a PO from before
   * migration 0045, that nobody wrote the date down). Wholesale sells on
   * credit, so this and not the payment date is when the revenue belongs.
   */
  deliveredAt?: string;
  /** หมายเหตุของ PO — free text the sale needs to pass on (migration 0054). */
  note?: string;
  /**
   * ผลการตัดสินใจเรื่องราคา และใครตัดสิน (migration 0051).
   *
   * A discount that went through used to leave only a status behind, which
   * anybody could have set. `priceDecidedBy` is the auth user id; the screen
   * resolves it to a name where it has one.
   */
  priceDecision?: string;
  priceDecidedAt?: string;
  priceDecidedBy?: string;
  /**
   * กำหนดชำระเงิน (migration 0049) — printed on ใบแจ้งหนี้ and ใบส่งของ.
   *
   * Empty means nobody agreed a date, and the documents then say nothing
   * rather than inventing one from the delivery date.
   */
  dueAt?: string;
  /**
   * พนักงานขายที่ขาย PO ใบนี้ — a NAME (migration 0047), not an id.
   *
   * Their phone heads the documents this PO produces, and their name signs
   * them. Empty on POs raised before the field existed; those read as
   * "ไม่ระบุ" rather than being assigned to whoever is on the list today.
   */
  salesBy?: string;
  /**
   * `orders.created_at`, the date the period filter windows the list on. Absent
   * on an unsaved draft from `blankOrder`, which the filter then always shows.
   */
  createdAt?: string;
  items: WsItem[];
  returns: WsReturn[];
  adjustments: WsAdjustment[];
  payments: WsPayment[];
};

/**
 * A PO in ถังขยะ (migration 0040). The deleter is resolved to a name at load
 * time rather than embedded, so a PO whose deleter has since been removed from
 * the staff list still lists.
 */
export type WsDeletedOrder = WsOrder & {
  deletedAt: Date | null;
  deletedByName: string;
};

/**
 * เอกสารขายส่ง. ขายส่งไม่ออกใบกำกับภาษี — สี่ใบนี้เท่านั้น.
 *
 * `delivery` and `ret` are not only paperwork: issuing them records the two
 * dates the money figures are built on (migration 0045).
 */
/**
 * `label` คือจ่าหน้ากล่อง ไม่ใช่เอกสาร — it is taped to a carton, printed A5
 * landscape, and carries no amounts at all. Listed here because it shares the
 * same print portal as the four documents.
 */
export type WsPrintMode = 'invoice' | 'delivery' | 'ret' | 'receipt' | 'label' | null;

/**
 * พนักงานขายของสาขาหนึ่ง (migration 0047).
 *
 * A table rather than an option list because the phone is a second field, and
 * it is printed on a customer’s document: a wholesale buyer rings the rep who
 * sold to them, not a branch switchboard.
 */
export type SalesPerson = { id: number; shop: string; name: string; phone: string };

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
