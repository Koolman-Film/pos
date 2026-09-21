import { fmt, fmtThaiDateTime, fmtThaiDayString } from '@/lib/domain/format';

/**
 * ประวัติการใช้งาน — turning `activity_log` rows into lines a person can read.
 *
 * The database stores what changed in its own terms (migration 0061): column
 * names, raw values, and for the collections that are rewritten on every save,
 * the whole set before and after. None of that is readable to the shop, and a
 * history nobody can read answers nothing. Everything that makes it readable
 * lives here, in one pure module, so it can be tested without a database.
 */

export type ActivityAction = 'สร้าง' | 'แก้ไข' | 'ลบ';

export type ActivityEntry = {
  id: number;
  at: string;
  tx: number;
  actorName: string;
  shop: string | null;
  entity: string;
  recordId: string;
  docRef: string;
  action: ActivityAction;
  changes: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// What each table is, to the shop
// ---------------------------------------------------------------------------

export const ACTIVITY_MODULES = [
  'ใบงาน',
  'ขายส่ง',
  'ค่าใช้จ่าย',
  'เงิน',
  'สต็อก',
  'ประกัน/เซอร์วิส',
  'ลูกค้า',
  'ผู้ใช้/สิทธิ์',
  'ตั้งค่า',
] as const;
export type ActivityModule = (typeof ACTIVITY_MODULES)[number];

type EntityMeta = { module: ActivityModule; label: string; link?: 'ticket' | 'order' };

export const ENTITY_META: Record<string, EntityMeta> = {
  tickets: { module: 'ใบงาน', label: 'ใบงาน', link: 'ticket' },
  ticket_lines: { module: 'ใบงาน', label: 'รายการสินค้า / การรับเงิน', link: 'ticket' },
  ticket_documents: { module: 'ใบงาน', label: 'เอกสารที่ออก', link: 'ticket' },
  orders: { module: 'ขายส่ง', label: 'PO', link: 'order' },
  order_lines: { module: 'ขายส่ง', label: 'รายการใน PO', link: 'order' },
  expenses: { module: 'ค่าใช้จ่าย', label: 'ค่าใช้จ่าย' },
  expense_attachments: { module: 'ค่าใช้จ่าย', label: 'ไฟล์แนบค่าใช้จ่าย' },
  money_accounts: { module: 'เงิน', label: 'แหล่งเงิน' },
  money_transfers: { module: 'เงิน', label: 'โอน/ฝากเงิน' },
  money_reconciliations: { module: 'เงิน', label: 'กระทบยอด' },
  petty_cash: { module: 'เงิน', label: 'เงินสดย่อย' },
  stock: { module: 'สต็อก', label: 'สินค้า' },
  stock_batches: { module: 'สต็อก', label: 'ล็อตรับสินค้า' },
  withdrawals: { module: 'สต็อก', label: 'เบิกใช้ภายใน' },
  price_matrix: { module: 'สต็อก', label: 'ราคาตามรุ่นรถ' },
  film_price_matrix: { module: 'สต็อก', label: 'ราคาฟิล์ม' },
  insurance_plans: { module: 'ประกัน/เซอร์วิส', label: 'แผนประกัน' },
  insurance_policies: { module: 'ประกัน/เซอร์วิส', label: 'ประกัน', link: 'ticket' },
  insurance_claims: { module: 'ประกัน/เซอร์วิส', label: 'การเคลม', link: 'ticket' },
  service_visits: { module: 'ประกัน/เซอร์วิส', label: 'การเซอร์วิส', link: 'ticket' },
  service_visit_lines: {
    module: 'ประกัน/เซอร์วิส',
    label: 'จุดตรวจ / การเคลมในการเซอร์วิส',
    link: 'ticket',
  },
  retail_customers: { module: 'ลูกค้า', label: 'ลูกค้าหน้าร้าน' },
  wholesale_customers: { module: 'ลูกค้า', label: 'ลูกค้าขายส่ง' },
  corporate_buyers: { module: 'ลูกค้า', label: 'ลูกค้านิติบุคคล' },
  app_users: { module: 'ผู้ใช้/สิทธิ์', label: 'ผู้ใช้' },
  user_shops_lines: { module: 'ผู้ใช้/สิทธิ์', label: 'สาขาที่ผู้ใช้เข้าถึง' },
  roles: { module: 'ผู้ใช้/สิทธิ์', label: 'ตำแหน่ง' },
  role_permissions: { module: 'ผู้ใช้/สิทธิ์', label: 'สิทธิ์ของตำแหน่ง' },
  sales_people: { module: 'ผู้ใช้/สิทธิ์', label: 'พนักงานขาย' },
  shops: { module: 'ตั้งค่า', label: 'สาขา' },
  shop_info: { module: 'ตั้งค่า', label: 'ข้อมูลนิติบุคคลของสาขา' },
  statuses: { module: 'ตั้งค่า', label: 'สถานะใบงาน' },
  ws_statuses: { module: 'ตั้งค่า', label: 'สถานะ PO' },
  option_list_lines: { module: 'ตั้งค่า', label: 'รายการตัวเลือก' },
  commission_rules: { module: 'ตั้งค่า', label: 'กฎค่าคอม' },
  commission_rule_teams: { module: 'ตั้งค่า', label: 'ทีมในกฎค่าคอม' },
  car_models: { module: 'ตั้งค่า', label: 'รุ่นรถ' },
};

export const entityMeta = (entity: string): EntityMeta =>
  ENTITY_META[entity] ?? { module: 'ตั้งค่า', label: entity };

/** Every table name a module covers — what the server filters on. */
export function entitiesOf(module: ActivityModule): string[] {
  return Object.entries(ENTITY_META)
    .filter(([, m]) => m.module === module)
    .map(([entity]) => entity);
}

/** Where a document number opens, when it opens anywhere. */
export function docHref(entity: string, docRef: string): string | null {
  if (!docRef) return null;
  const link = entityMeta(entity).link;
  if (link === 'ticket') return `/tickets/${encodeURIComponent(docRef)}`;
  if (link === 'order') return `/wholesale/${encodeURIComponent(docRef)}`;
  return null;
}

// ---------------------------------------------------------------------------
// Field names and values
// ---------------------------------------------------------------------------

export const FIELD_LABELS: Record<string, string> = {
  // ใบงาน
  customer_name: 'ชื่อลูกค้า',
  phone: 'เบอร์โทร',
  plate: 'ทะเบียนรถ',
  car_type: 'ประเภทรถ',
  brand: 'ยี่ห้อ',
  model: 'รุ่น',
  color: 'สี',
  service_type: 'ประเภทงาน',
  status: 'สถานะ',
  booking_channel: 'จองผ่าน',
  tech_by_category: 'ช่างที่รับผิดชอบ',
  drop_off_date: 'วันรับรถ',
  pickup_date: 'วันส่งรถ',
  extras: 'ข้อมูลเพิ่มเติม',
  locked: 'ล็อกใบงาน',
  revenue_kind: 'เงินจากใบงานนี้',
  deleted_at: 'ลบเมื่อ',
  retail_customer_id: 'ลูกค้าในทะเบียน',
  // รายการสินค้า
  category: 'ชนิดสินค้า/กลุ่ม',
  booked: 'สินค้าที่จอง',
  booked_price: 'ราคาจอง',
  sold: 'สินค้าที่ขาย',
  sold_price: 'ราคาขาย',
  interested: 'สินค้าที่สนใจ',
  interested_price: 'ราคาที่สนใจ',
  discount_type: 'ประเภทส่วนลด',
  discount_value: 'ส่วนลด',
  actual_qty: 'จำนวนที่ใช้จริง',
  positions: 'ตำแหน่ง',
  // เงิน
  type: 'ประเภท',
  method: 'วิธีชำระ',
  amount: 'จำนวนเงิน',
  paid_at: 'วันที่จ่าย/รับเงิน',
  due_at: 'กำหนดจ่าย',
  slips: 'สลิปแนบ',
  source: 'จ่ายจาก',
  description: 'รายการ',
  doc_no: 'เลขที่เอกสาร',
  expense_kind: 'ค่าใช้จ่ายของใคร',
  cheque_no: 'เลขที่เช็ค',
  cheque_bank: 'ธนาคาร',
  cheque_date: 'วันที่หน้าเช็ค',
  cleared_at: 'วันที่เงินเข้า',
  bounced_at: 'วันที่เช็คเด้ง',
  moved_at: 'วันที่โอน',
  from_account_id: 'จาก',
  to_account_id: 'ไป',
  opening_balance: 'ยอดตั้งต้น',
  counted_balance: 'ยอดที่นับได้',
  counted_at: 'ยอด ณ วันที่',
  note: 'หมายเหตุ',
  // ขายส่ง
  customer_id: 'ลูกค้า',
  qty: 'จำนวน',
  list_price: 'ราคาตั้ง',
  requested_price: 'ราคาขอ',
  reason: 'เหตุผล',
  item_name: 'สินค้า',
  returned_at: 'วันที่คืน',
  received_at: 'วันที่รับ',
  adjusted_at: 'วันที่ปรับ',
  sales_by: 'เซลล์',
  delivered_at: 'วันที่จัดส่ง',
  // Only a PO's created_at is ever edited (วันที่เปิด PO, 21 ก.ย. 2569); on every
  // other table it is bookkeeping and stays out of creates and deletes.
  created_at: 'วันที่เปิด PO',
  pay_to_account_id: 'บัญชีรับชำระ (รหัสแหล่งเงิน)',
  // สต็อก / ตั้งค่า
  name: 'ชื่อ',
  short_name: 'ชื่อย่อ',
  sku: 'รหัสสินค้า',
  min_qty: 'จุดสั่งซื้อ',
  cost: 'ต้นทุน',
  sell_price: 'ราคาขาย',
  price: 'ราคา',
  unit_cost: 'ต้นทุนต่อหน่วย',
  supplier: 'ผู้ขาย',
  value: 'ค่า',
  sort_order: 'ลำดับ',
  // ผู้ใช้ / สิทธิ์
  email: 'อีเมล',
  role_id: 'ตำแหน่ง',
  active: 'ใช้งาน',
  sees_all_shops: 'เห็นทุกสาขา',
  allowed: 'อนุญาต',
  permission_key: 'สิทธิ์',
  permission_type: 'ชนิดสิทธิ์',
  // เซอร์วิส / ประกัน
  visit_no: 'ครั้งที่',
  technicians: 'ช่าง',
  qc_by: 'QC โดย',
  notes: 'หมายเหตุ',
  plan_name: 'แผนประกัน',
  starts_at: 'เริ่มคุ้มครอง',
  ends_at: 'สิ้นสุด',
  big_used: 'ชิ้นใหญ่ที่เคลม',
  small_used: 'ชิ้นเล็กที่เคลม',
  detail: 'รายละเอียด',
  position: 'ตำแหน่ง',
  shop_id: 'สาขา',
};

export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

/** Bookkeeping columns: never worth a line of their own on a create or delete. */
const QUIET_FIELDS = new Set(['id', 'created_at', 'created_by', 'created_by_name', 'uid', 'tx']);

const MONEY_FIELDS = new Set([
  'amount',
  'price',
  'cost',
  'sell_price',
  'sold_price',
  'booked_price',
  'interested_price',
  'list_price',
  'requested_price',
  'opening_balance',
  'counted_balance',
  'system_balance',
  'unit_cost',
]);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function formatValue(value: unknown, field = ''): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่';
  if (typeof value === 'number') {
    return MONEY_FIELDS.has(field) ? fmt(value) : value.toLocaleString('th-TH');
  }
  if (typeof value === 'string') {
    if (MONEY_FIELDS.has(field) && value.trim() !== '' && Number.isFinite(Number(value))) {
      return fmt(Number(value));
    }
    if (DATE_ONLY.test(value)) return fmtThaiDayString(value);
    if (TIMESTAMP.test(value)) return fmtThaiDateTime(new Date(value));
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value.map((v) => (isPlainObject(v) ? summarizeObject(v) : formatValue(v))).join(', ');
  }
  if (isPlainObject(value)) {
    const s = summarizeObject(value);
    return s || '—';
  }
  return String(value);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A short reading of an object: its non-empty fields, labelled. */
function summarizeObject(o: Record<string, unknown>): string {
  // A ตำแหน่ง line reads as "หน้า: ฟิล์ม X (1,000.00)", not as three fields.
  if ('position' in o && 'product' in o) {
    const price = Number(o.price ?? 0);
    return `${o.position || '—'}${o.product ? `: ${o.product}` : ''}${price ? ` (${fmt(price)})` : ''}`;
  }
  return Object.entries(o)
    .filter(([k, v]) => !QUIET_FIELDS.has(k) && v !== null && v !== '' && v !== undefined)
    .filter(([, v]) => !(Array.isArray(v) && v.length === 0))
    .filter(([, v]) => !(isPlainObject(v) && Object.keys(v).length === 0))
    .map(([k, v]) => `${fieldLabel(k)} ${formatValue(v, k)}`)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// One field that changed
// ---------------------------------------------------------------------------

export type FieldChange = { path: string; before: string; after: string };

/**
 * A changed field, flattened so a jsonb column reads by its parts.
 *
 * `extras` on a ticket is one column holding every บริการเสริม; shown whole,
 * one ticked box is a wall of text before and after that differs in one word.
 * Walking into plain objects gives "ข้อมูลเพิ่มเติม › Service › serviceCount:
 * 6 → 12" instead.
 */
export function flattenChange(field: string, before: unknown, after: unknown): FieldChange[] {
  const label = fieldLabel(field);
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((k) =>
      JSON.stringify(before[k]) === JSON.stringify(after[k])
        ? []
        : flattenChange(k, before[k], after[k]).map((c) => ({
            ...c,
            path: `${label} › ${c.path}`,
          })),
    );
  }
  return [{ path: label, before: formatValue(before, field), after: formatValue(after, field) }];
}

// ---------------------------------------------------------------------------
// A collection rewritten on save — what actually moved
// ---------------------------------------------------------------------------

export const PART_LABELS: Record<string, string> = {
  items: 'รายการสินค้า',
  payments: 'การรับเงิน',
  returns: 'การคืนสินค้า',
  adjustments: 'ส่วนลด/ปรับราคา',
  points: 'จุดตรวจ',
  claims: 'การเคลม',
  values: 'ตัวเลือก',
  shops: 'สาขาที่เข้าถึง',
};

export type LineChange =
  | { kind: 'added'; label: string; detail: string }
  | { kind: 'removed'; label: string; detail: string }
  | { kind: 'changed'; label: string; fields: FieldChange[] };

/** What a line is called in a sentence: the product, the payment, the value. */
export function lineLabel(part: string, line: unknown): string {
  if (!isPlainObject(line)) return formatValue(line);
  const s = (k: string) => (typeof line[k] === 'string' ? (line[k] as string) : '');
  switch (part) {
    case 'items':
      return s('sold') || s('interested') || s('booked') || s('name') || s('category') || 'รายการ';
    case 'payments':
      return [s('type'), s('method'), formatValue(line.amount, 'amount')]
        .filter((x) => x && x !== '—')
        .join(' ');
    case 'returns':
      return s('item_name') || 'การคืน';
    case 'adjustments':
      return s('reason') || formatValue(line.amount, 'amount');
    case 'points':
      return s('position') || s('detail') || 'จุดตรวจ';
    case 'claims':
      return s('detail') || 'การเคลม';
    default:
      return summarizeObject(line) || 'รายการ';
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const uidOf = (line: unknown) =>
  isPlainObject(line) && typeof line.uid === 'string' && line.uid ? line.uid : null;

/**
 * Before and after of one collection, as additions, removals and edits.
 *
 * Rows that carry a `uid` (payments, returns, adjustments) are matched on it,
 * so an edited payment reads as an edit even when it moved in the list. Rows
 * without one (ticket lines, points) are matched by what they are: identical
 * rows first — an untouched line is not news — and what is left pairs up in
 * order, so a price changed on the second line reads as that line changing
 * rather than one line removed and another added.
 */
export function diffLines(part: string, before: unknown, after: unknown): LineChange[] {
  const b = Array.isArray(before) ? [...before] : [];
  const a = Array.isArray(after) ? [...after] : [];
  const out: LineChange[] = [];

  const describe = (line: unknown) =>
    isPlainObject(line) ? summarizeObject(line) : formatValue(line);

  const edit = (from: unknown, to: unknown) => {
    if (!isPlainObject(from) || !isPlainObject(to)) {
      out.push({ kind: 'removed', label: lineLabel(part, from), detail: describe(from) });
      out.push({ kind: 'added', label: lineLabel(part, to), detail: describe(to) });
      return;
    }
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter(
      (k) => !QUIET_FIELDS.has(k),
    );
    const fields = keys.flatMap((k) =>
      same(from[k], to[k]) ? [] : flattenChange(k, from[k], to[k]),
    );
    if (fields.length) out.push({ kind: 'changed', label: lineLabel(part, to), fields });
  };

  // 1. by uid
  const bByUid = new Map(b.map((l) => [uidOf(l), l] as const).filter(([u]) => u));
  for (let i = a.length - 1; i >= 0; i--) {
    const u = uidOf(a[i]);
    if (u && bByUid.has(u)) {
      const from = bByUid.get(u);
      b.splice(b.indexOf(from), 1);
      const [to] = a.splice(i, 1);
      edit(from, to);
    }
  }
  // 2. identical rows are not news
  for (let i = a.length - 1; i >= 0; i--) {
    const j = b.findIndex((x) => same(x, a[i]));
    if (j >= 0) {
      b.splice(j, 1);
      a.splice(i, 1);
    }
  }
  // 3. what is left pairs in order; the rest were added or removed
  const pairs = Math.min(a.length, b.length);
  for (let i = 0; i < pairs; i++) edit(b[i], a[i]);
  for (const l of b.slice(pairs))
    out.push({ kind: 'removed', label: lineLabel(part, l), detail: describe(l) });
  for (const l of a.slice(pairs))
    out.push({ kind: 'added', label: lineLabel(part, l), detail: describe(l) });
  return out;
}

// ---------------------------------------------------------------------------
// A whole entry
// ---------------------------------------------------------------------------

export type EntryReading =
  | { shape: 'fields'; fields: FieldChange[] }
  | { shape: 'snapshot'; fields: { label: string; value: string }[] }
  | { shape: 'lines'; parts: { part: string; label: string; lines: LineChange[] }[] };

export const isLinesEntity = (entity: string) => entity.endsWith('_lines');

export function readEntry(e: Pick<ActivityEntry, 'entity' | 'action' | 'changes'>): EntryReading {
  const changes = e.changes ?? {};

  if (isLinesEntity(e.entity)) {
    return {
      shape: 'lines',
      parts: Object.entries(changes).map(([part, pair]) => {
        const [before, after] = Array.isArray(pair) ? pair : [null, pair];
        return {
          part,
          label: PART_LABELS[part] ?? part,
          lines: diffLines(part, before, after),
        };
      }),
    };
  }

  if (e.action === 'แก้ไข') {
    return {
      shape: 'fields',
      fields: Object.entries(changes).flatMap(([field, pair]) => {
        const [before, after] = Array.isArray(pair) ? pair : [null, pair];
        return flattenChange(field, before, after);
      }),
    };
  }

  // สร้าง / ลบ: the row as it was, minus bookkeeping and blanks.
  return {
    shape: 'snapshot',
    fields: Object.entries(changes)
      .filter(([k, v]) => !QUIET_FIELDS.has(k) && formatValue(v, k) !== '—')
      .map(([k, v]) => ({ label: fieldLabel(k), value: formatValue(v, k) })),
  };
}

/**
 * Entries of one save belong together: a ticket saved once writes its header
 * and its lines in one transaction, and reading them as two unrelated events
 * would split one act across the page.
 */
export function groupByTransaction(entries: ActivityEntry[]): ActivityEntry[][] {
  const groups: ActivityEntry[][] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last[0].tx === e.tx && last[0].actorName === e.actorName) last.push(e);
    else groups.push([e]);
  }
  return groups;
}
