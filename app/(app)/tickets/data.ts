import { daysFromNow } from '@/lib/domain/format';
import { createClient } from '@/lib/supabase/server';
import type { StatusConfig } from '@/components/ui/Badge';
import type {
  CarModel,
  CorporateBuyer,
  FilmPriceRow,
  OptionListName,
  PriceMatrixRow,
  RetailCustomer,
  Shop,
  ShopInfo,
  StockRow,
  Ticket,
  TicketListRow,
} from '@/components/tickets/types';

const OPTION_LISTS: OptionListName[] = [
  'booking_channels',
  'service_types',
  'car_types',
  'car_brands',
  'time_slots',
  'film_positions',
  'wrap_positions',
  'extra_options',
  'slide_types',
  'technicians',
  'product_categories',
  'service_items',
  'payment_methods',
];

export async function loadShops(): Promise<Shop[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('shops').select('id, name').order('sort_order');
  return (data ?? []).map((s) => ({ id: s.id, name: s.name }));
}

export async function loadStatuses(): Promise<StatusConfig[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('statuses')
    .select('key, short, bg, text_color, dot')
    .order('sort_order');
  return (data ?? []).map((s) => ({
    key: s.key,
    short: s.short,
    bg: s.bg,
    text: s.text_color,
    dot: s.dot,
  }));
}

type ListRow = {
  id: string;
  shop_id: string;
  customer_name: string;
  plate: string;
  status: string;
  tech_by_category: Record<string, string[]> | null;
  drop_off_date: string | null;
  pickup_date: string | null;
  ticket_items: {
    category: string;
    sold_price: number;
    discount_type: string | null;
    discount_value: number | null;
  }[];
  ticket_payments: { amount: number }[];
  deleted_at: string | null;
  deleted_by: string | null;
};

const LIST_SELECT =
  'id, shop_id, customer_name, plate, status, tech_by_category, drop_off_date, pickup_date, deleted_at, deleted_by, ' +
  'ticket_items(category, sold_price, discount_type, discount_value), ticket_payments(amount)';

export async function loadTicketList(): Promise<TicketListRow[]> {
  const supabase = await createClient();
  // RLS scopes rows to the caller's shops — this is the real backstop.
  const { data } = await supabase
    .from('tickets')
    .select(LIST_SELECT)
    // Soft-deleted tickets (migration 0013) live on in the table but are gone
    // from every list; the bin below is the only place they surface.
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  return ((data ?? []) as unknown as ListRow[]).map((t) => ({
    id: t.id,
    shop: t.shop_id,
    customer: t.customer_name,
    plate: t.plate,
    status: t.status,
    items: (t.ticket_items ?? []).map((i) => ({
      category: i.category,
      soldPrice: Number(i.sold_price || 0),
      discountType: (i.discount_type as 'percent' | 'amount' | null) || undefined,
      discountValue: i.discount_value != null ? Number(i.discount_value) : undefined,
    })),
    payments: (t.ticket_payments ?? []).map((p) => ({ amount: Number(p.amount || 0) })),
    dropOffDateObj: t.drop_off_date ? new Date(t.drop_off_date) : null,
    pickupDateObj: t.pickup_date ? new Date(t.pickup_date) : null,
    techByCategory: (t.tech_by_category as Record<string, string[]>) || {},
  }));
}

/**
 * The bin: tickets flagged by `deleteTicket`, newest deletion first. Only ever
 * rendered for a caller holding `list.restore`, and RLS still scopes the rows to
 * their shops. `deleted_by` is resolved to a name here rather than embedded, so
 * a ticket whose deleter has since been removed still lists.
 */
export async function loadDeletedTicketList(): Promise<TicketListRow[]> {
  const supabase = await createClient();
  const [{ data }, { data: users }] = await Promise.all([
    supabase
      .from('tickets')
      .select(LIST_SELECT)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
    supabase.from('app_users').select('id, name'),
  ]);
  const nameById = new Map((users ?? []).map((u) => [u.id, u.name]));

  return ((data ?? []) as unknown as ListRow[]).map((t) => ({
    id: t.id,
    shop: t.shop_id,
    customer: t.customer_name,
    plate: t.plate,
    status: t.status,
    items: (t.ticket_items ?? []).map((i) => ({
      category: i.category,
      soldPrice: Number(i.sold_price || 0),
      discountType: (i.discount_type as 'percent' | 'amount' | null) || undefined,
      discountValue: i.discount_value != null ? Number(i.discount_value) : undefined,
    })),
    payments: (t.ticket_payments ?? []).map((p) => ({ amount: Number(p.amount || 0) })),
    dropOffDateObj: t.drop_off_date ? new Date(t.drop_off_date) : null,
    pickupDateObj: t.pickup_date ? new Date(t.pickup_date) : null,
    techByCategory: (t.tech_by_category as Record<string, string[]>) || {},
    deletedAt: t.deleted_at ? new Date(t.deleted_at) : null,
    deletedByName: t.deleted_by ? (nameById.get(t.deleted_by) ?? '') : '',
  }));
}

export type DetailRegistries = {
  options: Record<OptionListName, string[]>;
  stock: StockRow[];
  carModels: CarModel[];
  priceMatrix: PriceMatrixRow[];
  filmPriceMatrix: FilmPriceRow[];
  retailCustomers: RetailCustomer[];
  corporateBuyers: CorporateBuyer[];
  shopInfo: Record<string, ShopInfo>;
};

export async function loadDetailRegistries(): Promise<DetailRegistries> {
  const supabase = await createClient();
  const [
    optionsRes,
    stockRes,
    carModelsRes,
    priceRes,
    filmPriceRes,
    customersRes,
    buyersRes,
    shopInfoRes,
  ] = await Promise.all([
    supabase
      .from('option_lists')
      .select('list_key, value, sort_order')
      .is('shop_id', null)
      .order('sort_order'),
    supabase.from('stock').select('id, name, short_name, category, shop_id, qty, cost, sell_price'),
    supabase.from('car_models').select('model, brand, car_type'),
    supabase.from('price_matrix').select('car_type, product, price'),
    supabase.from('film_price_matrix').select('category, product, position, car_type, price'),
    supabase.from('retail_customers').select('id, name, phone'),
    supabase.from('corporate_buyers').select('name, address, tax_id'),
    supabase
      .from('shop_info')
      .select('shop_id, company_name, address, phone, tax_id, payment_channels'),
  ]);

  const options = Object.fromEntries(OPTION_LISTS.map((k) => [k, [] as string[]])) as Record<
    OptionListName,
    string[]
  >;
  for (const row of optionsRes.data ?? []) {
    const key = row.list_key as OptionListName;
    if (key in options) options[key].push(row.value);
  }

  const shopInfo: Record<string, ShopInfo> = {};
  for (const s of shopInfoRes.data ?? []) {
    shopInfo[s.shop_id] = {
      companyName: s.company_name,
      address: s.address,
      phone: s.phone,
      taxId: s.tax_id,
      paymentChannels: s.payment_channels ?? [],
    };
  }

  return {
    options,
    stock: (stockRes.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      shortName: s.short_name,
      category: s.category,
      shop: s.shop_id,
      qty: Number(s.qty || 0),
      cost: Number(s.cost || 0),
      sellPrice: Number(s.sell_price || 0),
    })),
    carModels: (carModelsRes.data ?? []).map((m) => ({
      model: m.model,
      brand: m.brand,
      carType: m.car_type,
    })),
    priceMatrix: (priceRes.data ?? []).map((p) => ({
      carType: p.car_type,
      product: p.product,
      price: Number(p.price || 0),
    })),
    filmPriceMatrix: (filmPriceRes.data ?? []).map((p) => ({
      category: p.category,
      product: p.product,
      position: p.position,
      carType: p.car_type,
      price: Number(p.price || 0),
    })),
    retailCustomers: (customersRes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
    })),
    corporateBuyers: (buyersRes.data ?? []).map((b) => ({
      name: b.name,
      address: b.address,
      taxId: b.tax_id,
    })),
    shopInfo,
  };
}

type ExtraMeta = {
  notes?: string;
  createdBy?: string;
  qcPhotos?: string[];
  installConfirmed?: boolean;
  installConfirmedAt?: string;
};

type DetailRow = {
  id: string;
  shop_id: string;
  customer_name: string;
  phone: string;
  plate: string;
  car_type: string;
  brand: string;
  model: string;
  color: string;
  service_type: string;
  status: string;
  booking_channel: string;
  tech_by_category: Record<string, string[]> | null;
  drop_off_date: string;
  pickup_date: string;
  extras: Record<string, unknown> | null;
  ticket_items: {
    id: number;
    category: string;
    booked: string;
    booked_price: number;
    sold: string;
    sold_price: number;
    discount_type: string | null;
    discount_value: number | null;
    actual_qty: Record<string, number> | null;
    ticket_item_positions: { position: string; product: string; price: number }[];
  }[];
  ticket_payments: { type: string; method: string; amount: number; paid_at: string | null }[];
};

export async function loadTicket(id: string): Promise<Ticket | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('tickets')
    .select(
      'id, shop_id, customer_name, phone, plate, car_type, brand, model, color, service_type, status, ' +
        'booking_channel, tech_by_category, drop_off_date, pickup_date, extras, ' +
        'ticket_items(id, category, booked, booked_price, sold, sold_price, discount_type, discount_value, actual_qty, ' +
        'ticket_item_positions(position, product, price)), ' +
        'ticket_payments(type, method, amount, paid_at)',
    )
    .eq('id', id)
    .maybeSingle();
  const t = data as unknown as DetailRow | null;
  if (!t) return null;

  const rawExtras = (t.extras as Record<string, unknown>) || {};
  const meta = (rawExtras.__meta as ExtraMeta) || {};
  const extras = { ...rawExtras };
  delete (extras as Record<string, unknown>).__meta;

  return {
    id: t.id,
    shop: t.shop_id,
    customer: t.customer_name,
    phone: t.phone,
    plate: t.plate,
    carType: t.car_type,
    brand: t.brand,
    model: t.model,
    color: t.color,
    serviceType: t.service_type,
    status: t.status,
    bookingChannel: t.booking_channel,
    techByCategory: (t.tech_by_category as Record<string, string[]>) || {},
    dropOffDateObj: new Date(t.drop_off_date),
    pickupDateObj: new Date(t.pickup_date),
    extras: extras as Ticket['extras'],
    notes: meta.notes ?? '',
    createdBy: meta.createdBy ?? '',
    qcPhotos: meta.qcPhotos ?? [],
    installConfirmed: !!meta.installConfirmed,
    installConfirmedAt: meta.installConfirmedAt ?? '',
    items: (t.ticket_items ?? []).map((i) => ({
      category: i.category,
      booked: i.booked,
      bookedPrice: Number(i.booked_price || 0),
      sold: i.sold,
      soldPrice: Number(i.sold_price || 0),
      discountType: (i.discount_type as 'percent' | 'amount' | null) ?? null,
      discountValue: i.discount_value != null ? Number(i.discount_value) : undefined,
      positions: (i.ticket_item_positions ?? []).map((p) => ({
        position: p.position,
        product: p.product,
        price: Number(p.price || 0),
      })),
      // Hydrating this matters: the save diffs the incoming map against what is
      // stored, so loading it as empty would read as "all usage reverted" and
      // return everything to stock on the next save.
      actualQtyMap: i.actual_qty ?? {},
    })),
    payments: (t.ticket_payments ?? []).map((p) => ({
      type: p.type,
      method: p.method,
      amount: Number(p.amount || 0),
      date: p.paid_at ?? '',
      attachments: [],
    })),
  };
}

export function blankTicket(shop: string): Ticket {
  return {
    id: 'JT-NEW-' + Math.floor(Math.random() * 9000 + 1000),
    shop,
    customer: '',
    phone: '',
    plate: '',
    carType: '',
    brand: '',
    model: '',
    color: '',
    serviceType: '',
    status: 'จองแล้ว',
    bookingChannel: '',
    techByCategory: {},
    dropOffDateObj: daysFromNow(0),
    pickupDateObj: daysFromNow(1),
    statusHistory: [{ status: 'จองแล้ว', date: daysFromNow(0) }],
    items: [],
    payments: [],
    extras: {},
    notes: '',
    qcPhotos: [],
  };
}
