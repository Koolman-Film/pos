import { daysFromNow } from '@/lib/domain/format';
import { createClient } from '@/lib/supabase/server';
import type { StatusConfig } from '@/components/ui/Badge';
import type {
  CarModel,
  CorporateBuyer,
  FilmPriceRow,
  InsurancePlan,
  InsurancePolicy,
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
    supabase
      .from('film_price_matrix')
      .select('category, product, position, car_type, price, shop_id'),
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
      shop: p.shop_id ?? '',
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
  notesByCategory?: Record<string, string>;
  wrapOptions?: string[];
  createdBy?: string;
  qcBy?: string;
  qcPhotos?: string[];
  qcAlbumUrl?: string;
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
  revenue_kind: string;
  tech_by_category: Record<string, string[]> | null;
  drop_off_date: string;
  pickup_date: string;
  extras: Record<string, unknown> | null;
  locked: boolean | null;
  ticket_items: {
    id: number;
    category: string;
    booked: string;
    booked_price: number;
    sold: string;
    sold_price: number;
    interested: string | null;
    interested_price: number | null;
    discount_type: string | null;
    discount_value: number | null;
    actual_qty: Record<string, number> | null;
    ticket_item_positions: { position: string; product: string; price: number }[];
  }[];
  ticket_payments: {
    type: string;
    method: string;
    amount: number;
    paid_at: string | null;
    attachments: string[] | null;
  }[];
};

type ServiceVisitRow = {
  id: number;
  visit_no: number;
  plate: string;
  received_at: string | null;
  received_time: string;
  delivered_at: string | null;
  delivered_time: string;
  sales_by: string;
  qc_by: string;
  technicians: string[] | null;
  film_product: string;
  customer_waits: boolean | null;
  overall_ok: boolean | null;
  checks: Record<string, string> | null;
  notes: string;
  service_visit_points: { seq: number; position: string; detail: string; note: string }[] | null;
};

/**
 * The visits recorded against a ticket, plus how many this plate has had in
 * total. Two queries because they answer two different questions: the ticket's
 * own list drives "ครั้งที่ 2 / 10", the plate count drives "รถคันนี้เซอร์วิสไป
 * กี่ครั้ง" across every job it has ever had.
 */
async function loadServiceVisits(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  plate: string,
): Promise<{ visits: Ticket['serviceVisits']; forPlate: number }> {
  const { data } = await supabase
    .from('service_visits')
    .select(
      'id, visit_no, plate, received_at, received_time, delivered_at, delivered_time, ' +
        'sales_by, qc_by, technicians, film_product, ' +
        'customer_waits, overall_ok, checks, notes, ' +
        'service_visit_points(seq, position, detail, note)',
    )
    .eq('ticket_id', ticketId)
    .order('visit_no', { ascending: false });

  const visits = ((data ?? []) as unknown as ServiceVisitRow[]).map((v) => ({
    id: v.id,
    visitNo: v.visit_no,
    plate: v.plate,
    receivedAt: v.received_at ?? '',
    receivedTime: v.received_time ?? '',
    deliveredAt: v.delivered_at ?? '',
    deliveredTime: v.delivered_time ?? '',
    salesBy: v.sales_by ?? '',
    qcBy: v.qc_by ?? '',
    technicians: v.technicians ?? [],
    filmProduct: v.film_product ?? '',
    customerWaits: v.customer_waits,
    overallOk: v.overall_ok,
    checks: v.checks ?? {},
    notes: v.notes ?? '',
    points: (v.service_visit_points ?? [])
      .map((p) => ({ seq: p.seq, position: p.position, detail: p.detail, note: p.note }))
      .sort((a, b) => a.seq - b.seq),
  }));

  // A blank plate would count every other blank-plate ticket's visits as this
  // car's, so it reports only what this ticket carries.
  let forPlate = visits.length;
  if (plate.trim()) {
    const { count } = await supabase
      .from('service_visits')
      .select('id', { count: 'exact', head: true })
      .eq('plate', plate);
    forPlate = count ?? visits.length;
  }
  return { visits, forPlate };
}

type InsurancePolicyRow = {
  id: number;
  ticket_id: string;
  plate: string;
  plan_name: string;
  price: number;
  big_pieces: number;
  small_pieces: number;
  terms: string;
  sold_at: string;
  starts_at: string | null;
  ends_at: string | null;
  notes: string;
  insurance_claims:
    | {
        id: number;
        claimed_at: string;
        big_used: number;
        small_used: number;
        detail: string;
        technician: string;
      }[]
    | null;
};

const POLICY_SELECT =
  'id, ticket_id, plate, plan_name, price, big_pieces, small_pieces, terms, ' +
  'sold_at, starts_at, ends_at, notes, ' +
  'insurance_claims(id, claimed_at, big_used, small_used, detail, technician)';

function toPolicy(p: InsurancePolicyRow): InsurancePolicy {
  return {
    id: p.id,
    ticketId: p.ticket_id,
    plate: p.plate ?? '',
    planName: p.plan_name ?? '',
    price: Number(p.price || 0),
    bigPieces: Number(p.big_pieces || 0),
    smallPieces: Number(p.small_pieces || 0),
    terms: p.terms ?? '',
    soldAt: p.sold_at ?? '',
    startsAt: p.starts_at ?? '',
    endsAt: p.ends_at ?? '',
    notes: p.notes ?? '',
    claims: (p.insurance_claims ?? [])
      .map((c) => ({
        id: c.id,
        claimedAt: c.claimed_at ?? '',
        bigUsed: Number(c.big_used || 0),
        smallUsed: Number(c.small_used || 0),
        detail: c.detail ?? '',
        technician: c.technician ?? '',
      }))
      .sort((a, b) => (a.claimedAt < b.claimedAt ? 1 : -1)),
  };
}

/**
 * ประกันของใบงานนี้ และของรถคันนี้ทั้งหมด.
 *
 * Two reads for the same reason the service visits need two: the ticket owns
 * the policies sold through it, but "รถคันนี้เคยทำประกันอะไรไว้" is a question
 * about the CAR, and a car comes back on new tickets. A blank plate would match
 * every other blank-plate ticket, so it falls back to this ticket alone.
 */
async function loadInsurance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  plate: string,
): Promise<{ policies: InsurancePolicy[]; forPlate: InsurancePolicy[] }> {
  const { data } = await supabase
    .from('insurance_policies')
    .select(POLICY_SELECT)
    .eq('ticket_id', ticketId)
    .order('sold_at', { ascending: false });
  const policies = ((data ?? []) as unknown as InsurancePolicyRow[]).map(toPolicy);

  if (!plate.trim()) return { policies, forPlate: policies };

  const { data: byPlate } = await supabase
    .from('insurance_policies')
    .select(POLICY_SELECT)
    .eq('plate', plate)
    .order('sold_at', { ascending: false });
  return {
    policies,
    forPlate: ((byPlate ?? []) as unknown as InsurancePolicyRow[]).map(toPolicy),
  };
}

/** แผนประกันที่สาขานี้เลือกได้ — ทุกสาขา (shop_id null) บวกของสาขาเอง. */
export async function loadInsurancePlans(shop?: string): Promise<InsurancePlan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('insurance_plans')
    .select('id, shop_id, name, price, big_pieces, small_pieces, months, terms, active')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  return (data ?? [])
    .filter((p) => !shop || p.shop_id == null || p.shop_id === shop)
    .map((p) => ({
      id: p.id,
      shop: p.shop_id,
      name: p.name,
      price: Number(p.price || 0),
      bigPieces: Number(p.big_pieces || 0),
      smallPieces: Number(p.small_pieces || 0),
      months: Number(p.months || 0),
      terms: p.terms ?? '',
      active: p.active,
    }));
}

export async function loadTicket(id: string): Promise<Ticket | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('tickets')
    .select(
      'id, shop_id, customer_name, phone, plate, car_type, brand, model, color, service_type, status, ' +
        'booking_channel, revenue_kind, tech_by_category, drop_off_date, pickup_date, extras, locked, ' +
        'ticket_items(id, category, booked, booked_price, sold, sold_price, interested, interested_price, discount_type, discount_value, actual_qty, ' +
        'ticket_item_positions(position, product, price)), ' +
        'ticket_payments(type, method, amount, paid_at, attachments)',
    )
    .eq('id', id)
    .maybeSingle();
  const t = data as unknown as DetailRow | null;
  if (!t) return null;

  const rawExtras = (t.extras as Record<string, unknown>) || {};
  const meta = (rawExtras.__meta as ExtraMeta) || {};
  const extras = { ...rawExtras };
  delete (extras as Record<string, unknown>).__meta;

  const service = await loadServiceVisits(supabase, t.id, t.plate);
  const insurance = await loadInsurance(supabase, t.id, t.plate);

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
    revenueKind: t.revenue_kind === 'รับแทน' ? 'รับแทน' : 'รายได้',
    techByCategory: (t.tech_by_category as Record<string, string[]>) || {},
    dropOffDateObj: new Date(t.drop_off_date),
    pickupDateObj: new Date(t.pickup_date),
    extras: extras as Ticket['extras'],
    notes: meta.notes ?? '',
    notesByCategory: meta.notesByCategory ?? {},
    wrapOptions: meta.wrapOptions ?? [],
    createdBy: meta.createdBy ?? '',
    qcBy: meta.qcBy ?? '',
    qcPhotos: meta.qcPhotos ?? [],
    qcAlbumUrl: meta.qcAlbumUrl ?? '',
    serviceVisits: service.visits,
    serviceVisitsForPlate: service.forPlate,
    insurancePolicies: insurance.policies,
    insuranceForPlate: insurance.forPlate,
    installConfirmed: !!meta.installConfirmed,
    installConfirmedAt: meta.installConfirmedAt ?? '',
    locked: !!t.locked,
    items: (t.ticket_items ?? []).map((i) => ({
      category: i.category,
      booked: i.booked,
      bookedPrice: Number(i.booked_price || 0),
      sold: i.sold,
      soldPrice: Number(i.sold_price || 0),
      interested: i.interested ?? '',
      // Left blank rather than 0 when nothing was chosen, so the price box shows
      // its placeholder instead of a misleading zero.
      interestedPrice: i.interested ? Number(i.interested_price || 0) : '',
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
      attachments: p.attachments ?? [],
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
    notesByCategory: {},
    wrapOptions: [],
    qcPhotos: [],
    qcAlbumUrl: '',
    serviceVisits: [],
    serviceVisitsForPlate: 0,
  };
}
