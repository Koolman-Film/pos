/**
 * Presentation metadata for the Permissions admin UI, ported verbatim from
 * reference/v0.4/finnix-film.html:160,167-227,237.
 *
 * These lists carry the human-readable Thai *labels* for each permission key.
 * The database (`role_permissions`) stores only which role holds which key; the
 * label that a key renders as lives here in the UI layer. Keeping them here (a
 * pure, React-free module) lets both the client component and the server
 * actions import the canonical key lists without duplication.
 */

export type Role = { id: string; name: string; icon: string };

/** roleId -> permissionKey -> allowed. One of these per `permission_type`. */
export type PermMap = Record<string, Record<string, boolean>>;

export type StatusRow = { key: string; short: string; bg: string; text: string; dot: string };
export type WsStatusRow = { key: string; bg: string; text: string; dot: string };
export type ShopRow = { id: string; name: string };
export type ShopInfoRow = {
  companyName: string;
  taxId: string;
  address: string;
  phone: string;
  paymentChannels: string[];
};
export type PermUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  shopAccess: 'all' | string[];
};

export type LabeledKey = { key: string; label: string };

/** reference/v0.4/finnix-film.html:160 */
export const ROLE_ICON_CHOICES = [
  'fa-user',
  'fa-user-tie',
  'fa-user-gear',
  'fa-user-shield',
  'fa-screwdriver-wrench',
  'fa-cash-register',
  'fa-truck-fast',
  'fa-warehouse',
];

/** reference/v0.4/finnix-film.html:167-175 — only `enabled` rows are shown. */
export const NAV_ITEMS: { id: string; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'แดชบอร์ด', icon: 'fa-gauge-high' },
  { id: 'list', label: 'Book งาน', icon: 'fa-clipboard-list' },
  { id: 'customers', label: 'ทะเบียนลูกค้า', icon: 'fa-address-book' },
  { id: 'wholesale', label: 'ขายส่ง', icon: 'fa-truck-fast' },
  { id: 'stock', label: 'สต็อกสินค้า', icon: 'fa-boxes-stacked' },
  { id: 'commission', label: 'ค่าคอมมิชชั่น', icon: 'fa-percent' },
  { id: 'accounting', label: 'บัญชี/ค่าใช้จ่าย', icon: 'fa-file-invoice-dollar' },
  { id: 'permissions', label: 'จัดการสิทธิ์', icon: 'fa-user-shield' },
];

/** reference/v0.4/finnix-film.html:182-191 */
export const DASHBOARD_WIDGETS: LabeledKey[] = [
  { key: 'revenue', label: 'การ์ดยอดขายรวม' },
  { key: 'expense', label: 'การ์ดยอดรวมค่าใช้จ่าย' },
  { key: 'pettycash', label: 'การ์ดเงินสดย่อยคงเหลือ' },
  { key: 'trendChart', label: 'กราฟรายได้/ค่าใช้จ่าย/กำไร' },
  { key: 'stockSummary', label: 'การ์ดสินค้าคงเหลือแยกตามชนิด' },
  { key: 'jobCalendar', label: 'การ์ดปฏิทินงานรายเดือน' },
  { key: 'receivablesPayables', label: 'การ์ดเจ้าหนี้/ลูกหนี้' },
  { key: 'pendingApprovals', label: 'การ์ดรอการอนุมัติ' },
];

/** reference/v0.4/finnix-film.html:192-195 */
export const OTHER_CAPABILITIES: LabeledKey[] = [
  { key: 'seeAllShops', label: 'เห็นข้อมูลทุกสาขา (ไม่ใช่แค่สาขาตัวเอง)' },
  { key: 'seeStockPrices', label: 'เห็นราคาทุน/ราคาขายในสต็อก (ไม่ใช่แค่จำนวนนับ)' },
];

/** reference/v0.4/finnix-film.html:204-220 */
export const MODULE_CAPABILITIES: LabeledKey[] = [
  { key: 'list.createNew', label: 'ใบงานติดตั้ง: สร้างใบงานใหม่' },
  { key: 'list.printSheet', label: 'ใบงานติดตั้ง: พิมพ์ใบงานสำหรับช่าง' },
  { key: 'list.delete', label: 'ใบงานติดตั้ง: ลบใบงาน (ลงถังขยะ)' },
  { key: 'list.restore', label: 'ใบงานติดตั้ง: ดูถังขยะและกู้คืนใบงาน' },
  { key: 'list.unlock', label: 'ใบงานติดตั้ง: ปลดล็อกใบงานที่ปิดงานแล้วเพื่อแก้ไข' },
  { key: 'customers.edit', label: 'ทะเบียนลูกค้า: เพิ่ม/แก้ไข/ลบลูกค้า' },
  {
    key: 'options.manage',
    label: 'ทุกโมดูล: เพิ่ม/ลบตัวเลือกในรายการ (จองผ่าน, ประเภทรถ, ตำแหน่งติดตั้ง ฯลฯ)',
  },
  { key: 'wholesale.createNew', label: 'ขายส่ง: สร้าง PO ใหม่' },
  { key: 'wholesale.priceApproval', label: 'ขายส่ง: อนุมัติ/ปฏิเสธราคา' },
  { key: 'wholesale.badDebt', label: 'ขายส่ง: แจ้งตัดหนี้สูญ' },
  { key: 'wholesale.export', label: 'ขายส่ง: ส่งออก Excel/PDF' },
  { key: 'stock.addProduct', label: 'สต็อก: เพิ่มสินค้า/ขึ้นทะเบียนใหม่' },
  { key: 'stock.adjustStock', label: 'สต็อก: ปรับสต็อก' },
  { key: 'stock.withdraw', label: 'สต็อก: เบิกใช้ภายใน' },
  { key: 'stock.editDelete', label: 'สต็อก: แก้ไข/ลบสินค้า' },
  { key: 'stock.export', label: 'สต็อก: ส่งออก Excel/PDF' },
  { key: 'commission.addRule', label: 'ค่าคอมมิชชั่น: เพิ่มกฎใหม่' },
  { key: 'accounting.addExpense', label: 'บัญชี: เพิ่มรายการค่าใช้จ่าย' },
  { key: 'accounting.topupCash', label: 'บัญชี: เติมเงินสดย่อย' },
  { key: 'accounting.export', label: 'บัญชี: ส่งออก Excel/PDF' },
];

/** reference/v0.4/finnix-film.html:237 — derive pill colours from a single hex. */
export function colorFromHex(hex: string): { bg: string; text: string; dot: string } {
  return { bg: hex + '26', text: hex, dot: hex };
}

/**
 * A stable, disambiguated accessible name for a permission-matrix toggle. The
 * cell shows only a checkbox, so the row/column context has to come from
 * `aria-label`. Built from the key's English module prefix plus the Thai action
 * portion of the label, e.g. `stock.editDelete` / "สต็อก: แก้ไข/ลบสินค้า" ->
 * "พนักงานขาย – stock: แก้ไข/ลบสินค้า".
 */
export function toggleAriaLabel(roleName: string, item: LabeledKey): string {
  const modulePrefix = item.key.includes('.') ? item.key.slice(0, item.key.indexOf('.')) : item.key;
  const action = item.label.includes(': ')
    ? item.label.slice(item.label.indexOf(': ') + 2)
    : item.label;
  return `${roleName} – ${modulePrefix}: ${action}`;
}
