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
  qcPhotos?: string[];
  createdBy?: string;
  statusHistory?: StatusHistoryEntry[];
  installConfirmed?: boolean;
  installConfirmedAt?: string;
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
    discountType: DiscountType;
    discountValue: number | null;
    positions: { position: string; product: string; price: number }[];
  }[];
  payments: { type: string; method: string; amount: number; paidAt: string }[];
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
