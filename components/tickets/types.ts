// Client-side ticket shape used by the Tickets module UI. This mirrors the
// prototype's in-memory `t` object (reference/v0.4/finnix-film.html:239-269,
// BLANK_TICKET at :269) rather than any single database row — the server pages
// map the normalized DB rows (tickets / ticket_items / ticket_item_positions /
// ticket_payments) into this shape and the server actions map it back.

export type DiscountType = 'percent' | 'amount' | null;

export type TicketPosition = { position: string; product: string; price: number | string };

export type TicketItem = {
  category: string;
  booked: string;
  bookedPrice: number | string;
  sold: string;
  soldPrice: number | string;
  discountType?: DiscountType;
  discountValue?: number | string;
  positions?: TicketPosition[];
  interested?: string;
  interestedPrice?: number | string;
  actualQtyMap?: Record<string, number | string>;
  autoInsurance?: boolean;
};

export type TicketPayment = {
  type: string;
  method: string;
  amount: number | string;
  date?: string;
  attachments?: string[];
};

export type TicketExtra = {
  checked?: boolean;
  // free-form per-extra detail (map link, slide legs, service count, …)
  [key: string]: unknown;
};

export type StatusHistoryEntry = { status: string; date: Date };

/** One numbered row of จุดพิเศษลูกค้าต้องการแก้ไข on the service sheet. */
export type ServiceVisitPoint = {
  seq: number;
  position: string;
  detail: string;
  note: string;
};

/**
 * One visit the car actually made, recorded against the ticket that entitled it
 * (migration 0020).
 *
 * The ticket's `extras.Service` holds the ENTITLEMENT — how many visits were
 * sold and when the next one is due. This is the record of what happened: when
 * the car came in, who worked on it, what was checked and what was fixed.
 */
export type ServiceVisit = {
  /** Absent until saved. */
  id?: number;
  /** 1..N within the ticket, issued by the database. */
  visitNo: number;
  plate: string;
  receivedAt: string;
  receivedTime: string;
  deliveredAt: string;
  deliveredTime: string;
  salesBy: string;
  qcBy: string;
  technicians: string[];
  /**
   * ชื่อสินค้าฟิล์มที่ใช้ — a snapshot, so an old sheet reprints the film that
   * was actually fitted. The SKU name already carries the thickness, so there is
   * nothing else to record.
   */
  filmProduct: string;
  /** null = nobody has said yet, which is not the same as "ไม่รอ". */
  customerWaits: boolean | null;
  overallOk: boolean | null;
  /** Part name -> result, keyed by the SERVICE_*_PARTS lists. */
  checks: Record<string, string>;
  notes: string;
  points: ServiceVisitPoint[];
};

/**
 * แผนประกัน — the branch price list the counter picks from (migration 0023).
 *
 * Cover is two counts, not a sentence: "ครอบคลุม 2 ชิ้นใหญ่, 20 ชิ้นเล็ก" is
 * `bigPieces` and `smallPieces`, which is what lets the shop answer "เหลือกี่
 * ชิ้น" once claims start coming in. `terms` carries anything else the plan says.
 */
export type InsurancePlan = {
  id: number;
  /** null/undefined = ทุกสาขา. */
  shop?: string | null;
  name: string;
  price: number;
  bigPieces: number;
  smallPieces: number;
  months: number;
  terms: string;
  active: boolean;
};

/** การเคลมหนึ่งครั้ง — หักจำนวนชิ้นออกจากความคุ้มครอง. */
export type InsuranceClaim = {
  id?: number;
  claimedAt: string;
  bigUsed: number;
  smallUsed: number;
  detail: string;
  technician: string;
};

/**
 * กรมธรรม์ที่ขายแล้ว — one sale, with its own date and its own money.
 *
 * Never part of the ticket total, whenever it was sold: ประกัน can be bought
 * with the install or months later on a closed ticket, and one rule for both is
 * what keeps a finished job from having its numbers moved. Revenue is read from
 * `soldAt`.
 *
 * Every field is a SNAPSHOT of the plan at the moment of sale. Editing a plan
 * next year must not reach backwards into what a customer already bought.
 */
export type InsurancePolicy = {
  /** Absent until saved. */
  id?: number;
  ticketId?: string;
  plate: string;
  planName: string;
  price: number;
  bigPieces: number;
  smallPieces: number;
  terms: string;
  /** วันที่ขาย — the revenue date, not necessarily the ticket’s. */
  soldAt: string;
  startsAt: string;
  endsAt: string;
  notes: string;
  claims: InsuranceClaim[];
};

export type Ticket = {
  id: string;
  shop: string;
  customer: string;
  phone: string;
  plate: string;
  carType: string;
  brand: string;
  model: string;
  color: string;
  serviceType: string;
  status: string;
  bookingChannel: string;
  techByCategory: Record<string, string[]>;
  dropOffDateObj: Date;
  pickupDateObj: Date;
  extras: Record<string, TicketExtra>;
  items: TicketItem[];
  payments: TicketPayment[];
  notes?: string;
  /**
   * หมายเหตุแยกตามชนิดสินค้า — keyed by `TicketItem.category`.
   *
   * ใบงานติดตั้ง prints one page per category, so a single ticket-wide note put
   * the film instructions on the audio page and vice versa. This is the note
   * that belongs to one category's page; `notes` stays the ticket-wide one and
   * prints on every sheet.
   */
  notesByCategory?: Record<string, string>;
  /**
   * งานฟิล์มกันรอย — the ticked entries of the paper form's "Option / รายการแถม"
   * row (see WRAP_OPTIONS). Values, not flags, so an option the shop later
   * renames does not silently un-tick every old ticket.
   */
  wrapOptions?: string[];
  qcPhotos?: string[];
  /**
   * An album of QC photos hosted somewhere else — Google Drive and the like.
   *
   * A walk-around of one car runs to dozens of photos, which is a slow upload on
   * shop wifi and a lot of storage for something the shop already keeps in a
   * drive. This holds the album's URL instead; it counts as QC evidence exactly
   * like an upload does, and it is what gets shared with the customer when set.
   */
  qcAlbumUrl?: string;
  /** Visits recorded against this ticket, newest first. */
  serviceVisits?: ServiceVisit[];
  /**
   * How many visits this PLATE has had across every ticket. The entitlement is
   * per ticket, but "รถคันนี้เซอร์วิสไปกี่ครั้ง" is a question about the car.
   */
  serviceVisitsForPlate?: number;
  /** ประกันที่ขายจากใบงานนี้ ใหม่สุดก่อน (migration 0023). */
  insurancePolicies?: InsurancePolicy[];
  /**
   * ประกันทุกฉบับของทะเบียนนี้ ข้ามใบงาน — "รถคันนี้เคยทำประกันอะไรไว้บ้าง".
   * Each carries its own ticket id so the list can link back.
   */
  insuranceForPlate?: InsurancePolicy[];
  createdBy?: string;
  statusHistory?: StatusHistoryEntry[];
  installConfirmed?: boolean;
  installConfirmedAt?: string;
  /**
   * Closed record — ส่งมอบแล้ว and paid in full (migration 0017). Read-only in
   * the form; only a `list.unlock` holder can reopen it.
   */
  locked?: boolean;
};

// Row shapes the list receives (a projection of the ticket for the list view).
export type TicketListRow = {
  id: string;
  shop: string;
  customer: string;
  plate: string;
  status: string;
  // discountType is narrowed to the two non-null variants so the row is
  // structurally assignable to lib/domain's `TicketForTotals`.
  items: {
    category?: string;
    soldPrice: number;
    discountType?: 'percent' | 'amount';
    discountValue?: number;
  }[];
  payments: { amount: number }[];
  dropOffDateObj?: Date | null;
  pickupDateObj?: Date | null;
  techByCategory?: Record<string, string[]>;
  /** Set only on rows from the bin (`loadDeletedTicketList`). */
  deletedAt?: Date | null;
  deletedByName?: string;
};

export type Shop = { id: string; name: string };

export type StockRow = {
  id: number;
  name: string;
  shortName: string;
  category: string;
  shop: string;
  qty: number;
  cost: number;
  sellPrice: number;
  serviceCount?: number;
};

export type CarModel = { model: string; brand: string; carType: string };
export type PriceMatrixRow = { carType: string; product: string; price: number };
export type FilmPriceRow = {
  category: string;
  product: string;
  position: string;
  carType: string;
  price: number;
};
export type RetailCustomer = { id: number; name: string; phone: string };
export type CorporateBuyer = { name: string; address: string; taxId: string };
export type ShopInfo = {
  companyName?: string;
  address?: string;
  phone?: string;
  taxId?: string;
  paymentChannels?: string[];
};

// The full bag of admin-managed option lists + lookups a TicketDetail needs.
// Every `*` list is a value list persisted in `option_lists`; the `set*`
// callbacks persist through the `updateOptionList` server action and update
// local state optimistically.
export type OptionListName =
  | 'booking_channels'
  | 'service_types'
  | 'car_types'
  | 'car_brands'
  | 'time_slots'
  | 'film_positions'
  | 'wrap_positions'
  | 'extra_options'
  | 'slide_types'
  | 'technicians'
  | 'product_categories'
  | 'service_items'
  | 'payment_methods';

// The serializable payload the create/update server actions accept. Dates are
// ISO strings; everything is plain JSON so it survives the Server Action POST.
export type TicketSavePayload = {
  id: string; // '' / 'JT-NEW-*' for a create; the real id for an update
  isNew: boolean;
  shop: string;
  customer: string;
  phone: string;
  plate: string;
  carType: string;
  brand: string;
  model: string;
  color: string;
  serviceType: string;
  status: string;
  bookingChannel: string;
  techByCategory: Record<string, string[]>;
  dropOffDate: string;
  pickupDate: string;
  extras: Record<string, unknown>;
  items: {
    category: string;
    booked: string;
    bookedPrice: number;
    sold: string;
    soldPrice: number;
    /** สินค้าที่สนใจ — the cheer-up baseline (`ticket_items.interested`). */
    interested: string;
    interestedPrice: number;
    discountType: DiscountType;
    discountValue: number | null;
    positions: { position: string; product: string; price: number }[];
    /**
     * Product -> quantity actually used. Persisted to `ticket_items.actual_qty`
     * and diffed against the stored value on save to drive automatic stock
     * movement (see lib/stock/movements.ts).
     */
    actualQty: Record<string, number>;
  }[];
  payments: {
    type: string;
    method: string;
    amount: number;
    paidAt: string;
    /** Storage paths in the `ticket-attachments` bucket (migration 0018). */
    attachments: string[];
  }[];
};

export const BRAND_TH: Record<string, string> = {
  Toyota: 'โตโยต้า',
  Honda: 'ฮอนด้า',
  Mazda: 'มาสด้า',
  Isuzu: 'อีซูซุ',
  Ford: 'ฟอร์ด',
  Nissan: 'นิสสัน',
  Mitsubishi: 'มิตซูบิชิ',
  Suzuki: 'ซูซูกิ',
  MG: 'เอ็มจี',
  BMW: 'บีเอ็มดับเบิลยู',
  Mercedes: 'เมอร์เซเดส',
};
export const MODEL_TH: Record<string, string> = {
  Vios: 'วีออส',
  City: 'ซิตี้',
  Camry: 'แคมรี่',
  'D-Max': 'ดีแม็กซ์',
  Jazz: 'แจ๊ส',
  Yaris: 'ยาริส',
  Civic: 'ซีวิค',
  Altis: 'อัลติส',
  Ranger: 'เรนเจอร์',
  '2': 'ทู',
  Fortuner: 'ฟอร์จูนเนอร์',
  Revo: 'รีโว่',
  Almera: 'อัลเมร่า',
};
