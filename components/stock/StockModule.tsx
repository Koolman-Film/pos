'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { PeriodShopFilter, type Shop } from '@/components/ui/PeriodShopFilter';
import { StatusPill } from '@/components/ui/StatusPill';
import { fmt } from '@/lib/domain/format';
import { currentMonthValue, daysAgoValue, exportStamp, todayValue } from '@/lib/domain/now';
import { useIsMounted } from '@/lib/hooks/useIsMounted';

/**
 * Ported from reference/v0.4/finnix-film.html:2980-3462 (`StockModule`).
 *
 * Key port adaptations from the prototype's local-state original:
 *  - The prototype held `stock` / `withdrawals` in `useState` and mutated them
 *    inline. Here those arrays arrive as props from the Server Component
 *    (`app/(app)/stock/page.tsx`); every mutation is a Server Action (passed in
 *    via `actions`) that re-checks auth + capability server-side (C2) and calls
 *    `revalidatePath('/stock')`, so fresh props flow back after each write.
 *  - Cost / sell-price are gated by `canSeeStockPrices`
 *    (`session.hasDashboardWidget('seeStockPrices')`, prototype :194,:2995). This
 *    is a real data-visibility gate: when false the Server Component never even
 *    sends `cost`/`sellPrice`, and the UI never renders them.
 *  - Low-stock is a strict `qty < min`, matching the prototype (reference
 *    :2980-3462). The plan's Task 16 text said `<=`, but the prototype is the
 *    behavioral source of truth, so `qty === min` does NOT count as low
 *    (execution correction C11).
 *  - Withdrawal status pill takes a KEYED label->colour map (C1), exactly as the
 *    prototype call site at :3436 — a flat object would render every pill grey.
 */

export type StockItem = {
  id: number;
  sku: string;
  name: string;
  shortName?: string;
  category: string;
  shop: string;
  qty: number;
  min: number;
  cost?: number;
  sellPrice?: number;
  serviceCount?: number;
};

export type Withdrawal = {
  id: number;
  item: string;
  shop: string;
  qty: number;
  type: string;
  by: string;
  date: string;
  status: string;
};

export type FilmPriceEntry = {
  category: string;
  product: string;
  position: string;
  carType: string;
  price: number;
};

/**
 * Server actions bound by the Server Component and passed in as props. Inputs
 * are typed `any` deliberately: the concrete argument shapes live with the
 * actions in `app/(app)/stock/actions.ts`, and typing them narrower here would
 * make the strict-variance assignment from those concretely-typed actions fail
 * without coupling this client component to the server module.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type StockActions = {
  addProduct?: (input: any) => Promise<void>;
  bulkImport?: (rows: any[]) => Promise<void>;
  adjustStock?: (input: { id: number; counted: number }) => Promise<void>;
  withdraw?: (input: { id: number; qty: number; type: string }) => Promise<void>;
  saveProduct?: (input: any) => Promise<void>;
  deleteProduct?: (id: number) => Promise<void>;
  setFilmPrice?: (input: FilmPriceEntry) => Promise<void>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export function StockModule({
  stock,
  withdrawals = [],
  canDo,
  caps,
  canSeeStockPrices,
  isAdmin = false,
  accessibleShops = [],
  canSeeAllShops = true,
  productCategories = [],
  carTypes = [],
  filmPositions = [],
  wrapPositions = [],
  filmPriceMatrix = [],
  actions = {},
}: {
  stock: StockItem[];
  withdrawals?: Withdrawal[];
  /**
   * Capability check. A Server Component CANNOT pass this — it is a closure, and
   * this module is a Client Component, so React refuses to serialise it and the
   * whole route 500s. Pages must pass the serialisable `caps` map instead; the
   * function form exists for unit tests that render this component directly.
   * Same contract as WholesaleDetail.
   */
  canDo?: (cap: string) => boolean;
  caps?: Record<string, boolean>;
  canSeeStockPrices: boolean;
  isAdmin?: boolean;
  accessibleShops?: Shop[];
  canSeeAllShops?: boolean;
  productCategories?: string[];
  carTypes?: string[];
  filmPositions?: string[];
  wrapPositions?: string[];
  filmPriceMatrix?: FilmPriceEntry[];
  actions?: StockActions;
}) {
  // Deny by default when neither form is supplied, so a wiring mistake hides
  // controls rather than exposing them.
  const can = canDo ?? ((k: string) => !!caps?.[k]);
  const canSeePrices = canSeeStockPrices;
  const shopName = (id: string) => accessibleShops.find((s) => s.id === id)?.name || id;

  // The print-area is portaled to <body> (prototype :3441) so it escapes the
  // `.app-shell` subtree — Task 1's print CSS hides `.app-shell` and shows only
  // `.print-area`, so a nested print-area would be hidden with it. Portaling
  // needs `document`, which is absent during SSR, hence the mount gate.
  const mounted = useIsMounted();

  const [categories, setCategories] = useState<string[]>(productCategories);
  const [priceMatrix, setPriceMatrix] = useState<FilmPriceEntry[]>(filmPriceMatrix);
  const [priceProdCat, setPriceProdCat] = useState('ฟิล์มกรองแสง');
  const [priceProd, setPriceProd] = useState('');

  function getFilmPrice(category: string, product: string, position: string, carType: string) {
    const m = priceMatrix.find(
      (e) => e.category === category && e.product === product && e.position === position && e.carType === carType
    );
    return m ? m.price : '';
  }
  async function setFilmPrice(
    category: string,
    product: string,
    position: string,
    carType: string,
    price: string
  ) {
    const entry: FilmPriceEntry = { category, product, position, carType, price: Number(price) || 0 };
    setPriceMatrix((prev) => {
      const idx = prev.findIndex(
        (e) => e.category === category && e.product === product && e.position === position && e.carType === carType
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [...prev, entry];
    });
    await actions.setFilmPrice?.(entry);
  }

  const [shopFilter, setShopFilter] = useState(canSeeAllShops ? 'all' : accessibleShops[0]?.id || 'all');
  const [period, setPeriod] = useState('today');
  const [periodValue, setPeriodValue] = useState(() => currentMonthValue());
  const [rangeStart, setRangeStart] = useState(() => daysAgoValue(6));
  const [rangeEnd, setRangeEnd] = useState(() => todayValue());
  const [panel, setPanel] = useState<string | null>(null); // null | 'withdraw' | 'add' | 'adjust' | 'price' | 'bulk'

  const stockScopedToAccess = stock.filter((s) => accessibleShops.some((a) => a.id === s.shop));

  const [wd, setWd] = useState({ id: stock[0]?.id ?? 0, qty: 1, type: 'สินค้าตัวอย่าง', reason: '' });
  const [addStk, setAddStk] = useState({
    mode: 'existing' as 'existing' | 'new',
    existingId: stock[0]?.id ?? 0,
    newName: '',
    shortName: '',
    sku: '',
    category: '',
    shop: accessibleShops[0]?.id || 'cm',
    qty: 1,
    cost: 0,
    sellPrice: 0,
    serviceCount: '' as string | number,
    reason: 'ซื้อเพิ่ม',
  });
  const [adjustments, setAdjustments] = useState<
    { id: number; item: string; before: number; after: number; diff: number; note: string; date: string }[]
  >([]);
  const [adj, setAdj] = useState({ id: stock[0]?.id ?? 0, counted: 0, note: '' });

  const [bulkRows, setBulkRows] = useState<
    {
      sku: string;
      name: string;
      shortName: string;
      category: string;
      shop: string;
      shopRaw: string;
      qty: number;
      cost: number;
      sellPrice: number;
      serviceCount: number;
      valid: boolean;
    }[]
  >([]);
  const [bulkFileName, setBulkFileName] = useState('');

  async function downloadStockTemplate() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const data = [
      {
        SKU: 'SKU-EXAMPLE-01',
        ชื่อสินค้า: 'ฟิล์ม 3M CRM 40%',
        ชื่อย่อ: '3M40',
        หมวดหมู่: 'ฟิล์มกรองแสง',
        สาขา: 'FINNIX FILM เชียงใหม่',
        จำนวน: 10,
        ราคาทุน: 800,
        ราคาขาย: 1600,
        'จำนวนครั้ง Service (เฉพาะฟิล์มกันรอย)': '',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'stock-import-template.xlsx');
  }

  async function handleBulkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const parsed = rows.map((r) => {
      const shopRaw = String(r['สาขา'] || '').trim();
      const shopMatch = accessibleShops.find((s) => s.name === shopRaw || s.id === shopRaw);
      const name = String(r['ชื่อสินค้า'] || '').trim();
      const category = String(r['หมวดหมู่'] || '').trim();
      return {
        sku: String(r['SKU'] || '').trim(),
        name,
        shortName: String(r['ชื่อย่อ'] || '').trim(),
        category,
        shop: shopMatch ? shopMatch.id : '',
        shopRaw,
        qty: Number(r['จำนวน']) || 0,
        cost: Number(r['ราคาทุน']) || 0,
        sellPrice: Number(r['ราคาขาย']) || 0,
        serviceCount: Number(r['จำนวนครั้ง Service (เฉพาะฟิล์มกันรอย)']) || 0,
        valid: !!(name && category && shopMatch),
      };
    });
    setBulkRows(parsed);
    e.target.value = '';
  }

  async function confirmBulkImport() {
    const validRows = bulkRows.filter((r) => r.valid);
    if (validRows.length === 0) return;
    const newCats = [...new Set(validRows.map((r) => r.category))].filter((c) => !categories.includes(c));
    if (newCats.length) setCategories([...categories, ...newCats]);
    await actions.bulkImport?.(
      validRows.map((r) => ({
        sku: r.sku,
        name: r.name,
        shortName: r.shortName,
        category: r.category,
        shop: r.shop,
        qty: r.qty,
        cost: r.cost,
        sellPrice: r.sellPrice,
      }))
    );
    const skipped = bulkRows.length - validRows.length;
    setBulkRows([]);
    setBulkFileName('');
    setPanel(null);
    window.alert(
      `นำเข้าสำเร็จ ${validRows.length} รายการ` + (skipped > 0 ? ` (ข้าม ${skipped} แถวที่ข้อมูลไม่ครบ)` : '')
    );
  }

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<StockItem | null>(null);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [nameFilterSel, setNameFilterSel] = useState('all');

  const visible = shopFilter === 'all' ? stock : stock.filter((s) => s.shop === shopFilter);
  const visibleWithdrawals =
    shopFilter === 'all' ? withdrawals : withdrawals.filter((w) => w.shop === shopFilter);
  const lowStock = visible.filter((s) => s.qty < s.min).length;
  const totalValue = visible.reduce((sum, i) => sum + i.qty * (i.cost || 0), 0);
  const shopScoped = branchFilter === 'all' ? visible : visible.filter((s) => s.shop === branchFilter);
  const catOptions = [...new Set(shopScoped.map((s) => s.category))];
  const catScoped = catFilter === 'all' ? shopScoped : shopScoped.filter((s) => s.category === catFilter);
  const nameOptions = [...new Set(catScoped.map((s) => s.name))];
  const searchQ = search.trim().toLowerCase();
  const filtered = catScoped.filter(
    (s) =>
      (nameFilterSel === 'all' || s.name === nameFilterSel) &&
      (!searchQ ||
        s.name.toLowerCase().includes(searchQ) ||
        (s.shortName || '').toLowerCase().includes(searchQ) ||
        s.sku.toLowerCase().includes(searchQ))
  );
  const filteredTotalValue = filtered.reduce((sum, i) => sum + i.qty * (i.cost || 0), 0);
  const exportShopIds = accessibleShops.map((sh) => sh.id).filter((id) => filtered.some((s) => s.shop === id));
  const exportGroups = exportShopIds.map((id) => ({
    shopId: id,
    items: filtered
      .filter((s) => s.shop === id)
      .sort((a, b) => a.category.localeCompare(b.category, 'th') || a.name.localeCompare(b.name, 'th')),
  }));

  async function submitWithdraw() {
    if (!wd.id) return;
    await actions.withdraw?.({ id: wd.id, qty: Number(wd.qty), type: wd.type });
    setPanel(null);
  }

  async function submitAddStock() {
    if (addStk.mode === 'new') {
      await actions.addProduct?.({
        mode: 'new',
        newName: addStk.newName,
        shortName: addStk.shortName,
        sku: addStk.sku,
        category: addStk.category,
        shop: addStk.shop,
        qty: Number(addStk.qty),
        cost: Number(addStk.cost),
        sellPrice: Number(addStk.sellPrice),
      });
    } else {
      await actions.addProduct?.({
        mode: 'existing',
        existingId: addStk.existingId,
        qty: Number(addStk.qty),
        cost: Number(addStk.cost),
      });
    }
    setPanel(null);
    setAddStk({
      mode: 'existing',
      existingId: stock[0]?.id ?? 0,
      newName: '',
      shortName: '',
      sku: '',
      category: '',
      shop: accessibleShops[0]?.id || 'cm',
      qty: 1,
      cost: 0,
      sellPrice: 0,
      serviceCount: '',
      reason: 'ซื้อเพิ่ม',
    });
  }

  function startEdit(s: StockItem) {
    setEditingId(s.id);
    setEditForm({ ...s });
  }
  async function saveEdit() {
    if (!editForm) return;
    await actions.saveProduct?.({
      id: editingId,
      name: editForm.name,
      shortName: editForm.shortName,
      sku: editForm.sku,
      category: editForm.category,
      qty: Number(editForm.qty),
      min: Number(editForm.min),
      cost: Number(editForm.cost),
      sellPrice: Number(editForm.sellPrice),
    });
    setEditingId(null);
    setEditForm(null);
  }
  async function deleteStockItem(id: number) {
    if (window.confirm('ยืนยันการลบสินค้านี้ออกจากสต็อก?')) await actions.deleteProduct?.(id);
  }

  async function submitAdjust() {
    const item = stock.find((s) => s.id === adj.id);
    const diff = Number(adj.counted) - (item?.qty || 0);
    setAdjustments([
      {
        id: Date.now(),
        item: item?.name || '',
        before: item?.qty || 0,
        after: Number(adj.counted),
        diff,
        note: adj.note,
        date: 'วันนี้',
      },
      ...adjustments,
    ]);
    await actions.adjustStock?.({ id: adj.id, counted: Number(adj.counted) });
    setPanel(null);
    setAdj({ id: stock[0]?.id ?? 0, counted: 0, note: '' });
  }

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    if (exportGroups.length === 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'สต็อก');
    } else {
      exportGroups.forEach((g) => {
        const data = g.items.map((s) => ({
          ชื่อย่อสินค้า: s.shortName || '-',
          สินค้า: s.name,
          หมวด: s.category,
          คงเหลือ: s.qty,
          ขั้นต่ำ: s.min,
          'ราคา/หน่วย': s.cost || 0,
          มูลค่ารวม: s.qty * (s.cost || 0),
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const sheetName = shopName(g.shopId).replace(/[:\\/?*[\]]/g, '').slice(0, 31) || g.shopId;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
    }
    XLSX.writeFile(wb, `stock-${branchFilter}-${exportStamp()}.xlsx`);
  }
  function exportPDF() {
    window.print();
  }

  const adjustItem = stock.find((s) => s.id === adj.id);

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold">สต็อกสินค้า</h1>
        <div className="flex gap-2 flex-wrap">
          {can('stock.addProduct') && (
            <button
              onClick={() => setPanel(panel === 'add' ? null : 'add')}
              className={`text-sm px-3.5 py-2 rounded-xl font-semibold flex items-center gap-2 ${panel === 'add' ? 'btn-primary' : 'btn-outline'}`}
            >
              <i className="fa-solid fa-cart-plus"></i>เพิ่มสินค้า
            </button>
          )}
          {can('stock.adjustStock') && (
            <button
              onClick={() => setPanel(panel === 'adjust' ? null : 'adjust')}
              className={`text-sm px-3.5 py-2 rounded-xl font-semibold flex items-center gap-2 ${panel === 'adjust' ? 'btn-primary' : 'btn-outline'}`}
            >
              <i className="fa-solid fa-scale-balanced"></i>ปรับสต็อก
            </button>
          )}
          {can('stock.withdraw') && (
            <button
              onClick={() => setPanel(panel === 'withdraw' ? null : 'withdraw')}
              className={`text-sm px-3.5 py-2 rounded-xl font-semibold flex items-center gap-2 ${panel === 'withdraw' ? 'btn-primary' : 'btn-outline'}`}
            >
              <i className="fa-solid fa-arrow-up-from-bracket"></i>เบิกใช้ภายใน
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setPanel(panel === 'price' ? null : 'price')}
              className={`text-sm px-3.5 py-2 rounded-xl font-semibold flex items-center gap-2 ${panel === 'price' ? 'btn-primary' : 'btn-outline'}`}
            >
              <i className="fa-solid fa-tags"></i>ตั้งราคาฟิล์ม/กันรอย
            </button>
          )}
          {can('stock.addProduct') && (
            <button
              onClick={() => setPanel(panel === 'bulk' ? null : 'bulk')}
              className={`text-sm px-3.5 py-2 rounded-xl font-semibold flex items-center gap-2 ${panel === 'bulk' ? 'btn-primary' : 'btn-outline'}`}
            >
              <i className="fa-solid fa-file-arrow-up"></i>นำเข้าหลาย SKU
            </button>
          )}
        </div>
      </div>

      {panel === 'bulk' && (
        <div className="card p-5 mb-4 fade-page">
          <p className="text-sm font-semibold mb-1">นำเข้าสินค้าหลาย SKU พร้อมกัน</p>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-soft)' }}>
            ดาวน์โหลด template กรอกข้อมูลในไฟล์ แล้วอัปโหลดกลับเข้าระบบเพื่อขึ้นทะเบียนสินค้าใหม่หลายรายการพร้อมกัน
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={downloadStockTemplate}
              className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5"
            >
              <i className="fa-solid fa-file-arrow-down"></i>ดาวน์โหลด Template
            </button>
            <label className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 cursor-pointer">
              <i className="fa-solid fa-file-arrow-up"></i>
              {bulkFileName || 'เลือกไฟล์ที่กรอกแล้ว...'}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleBulkFile} />
            </label>
          </div>
          {bulkRows.length > 0 && (
            <>
              <div className="overflow-x-auto mb-3">
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr>
                      {['SKU', 'ชื่อสินค้า', 'หมวดหมู่', 'สาขา'].map((h) => (
                        <th
                          key={h}
                          className="text-xs text-left px-2 py-2"
                          style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}
                        >
                          {h}
                        </th>
                      ))}
                      <th
                        className="text-xs text-right px-2 py-2"
                        style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}
                      >
                        จำนวน
                      </th>
                      <th
                        className="text-xs text-right px-2 py-2"
                        style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}
                      >
                        ราคาขาย
                      </th>
                      <th
                        className="text-xs text-center px-2 py-2"
                        style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}
                      >
                        สถานะ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((r, i) => (
                      <tr key={i}>
                        <td className="text-xs px-2 py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
                          {r.sku || '-'}
                        </td>
                        <td className="text-xs px-2 py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
                          {r.name || '-'}
                        </td>
                        <td className="text-xs px-2 py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
                          {r.category || '-'}
                        </td>
                        <td className="text-xs px-2 py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
                          {r.shopRaw || '-'}
                        </td>
                        <td
                          className="text-xs text-right px-2 py-1.5"
                          style={{ borderBottom: '1px solid var(--line)' }}
                        >
                          {r.qty}
                        </td>
                        <td
                          className="text-xs text-right px-2 py-1.5"
                          style={{ borderBottom: '1px solid var(--line)' }}
                        >
                          {fmt(r.sellPrice)}
                        </td>
                        <td
                          className="text-xs text-center px-2 py-1.5"
                          style={{ borderBottom: '1px solid var(--line)' }}
                        >
                          {r.valid ? (
                            <span style={{ color: '#4C7A3E' }} title="พร้อมนำเข้า">
                              <i className="fa-solid fa-circle-check"></i>
                            </span>
                          ) : (
                            <span
                              style={{ color: '#B23A48' }}
                              title="ข้อมูลไม่ครบ (ต้องมีชื่อสินค้า, หมวดหมู่, และสาขาที่ตรงกับชื่อสาขาในระบบ)"
                            >
                              <i className="fa-solid fa-triangle-exclamation"></i>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--ink-soft)' }}>
                พร้อมนำเข้า {bulkRows.filter((r) => r.valid).length} จาก {bulkRows.length} แถว{' '}
                {bulkRows.some((r) => !r.valid) && '(แถวที่มีเครื่องหมายเตือนจะถูกข้าม)'}
              </p>
              <button
                onClick={confirmBulkImport}
                disabled={bulkRows.filter((r) => r.valid).length === 0}
                className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold"
                style={{ opacity: bulkRows.filter((r) => r.valid).length === 0 ? 0.5 : 1 }}
              >
                ยืนยันนำเข้า {bulkRows.filter((r) => r.valid).length} รายการ
              </button>
            </>
          )}
        </div>
      )}

      {panel === 'price' && (
        <div className="card p-5 mb-4 fade-page">
          <p className="text-sm font-semibold mb-1">ตั้งราคาฟิล์มกรองแสง / ฟิล์มกันรอย</p>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-soft)' }}>
            ราคาแปรผันตาม ชื่อสินค้า &rarr; ตำแหน่งติดตั้ง &rarr; ประเภทรถ ตั้งค่าได้เฉพาะแอดมิน
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ชนิดสินค้า
              </label>
              <select
                value={priceProdCat}
                onChange={(e) => {
                  setPriceProdCat(e.target.value);
                  setPriceProd('');
                }}
                className="field w-full text-sm px-3 py-2"
              >
                <option value="ฟิล์มกรองแสง">ฟิล์มกรองแสง</option>
                <option value="ฟิล์มกันรอย">ฟิล์มกันรอย</option>
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                สินค้า
              </label>
              <select
                value={priceProd}
                onChange={(e) => setPriceProd(e.target.value)}
                className="field w-full text-sm px-3 py-2"
              >
                <option value="">เลือกสินค้า...</option>
                {[...new Set(stock.filter((s) => s.category === priceProdCat).map((s) => s.name))].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {priceProd ? (
            <div className="overflow-x-auto">
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th
                      className="text-xs text-left px-2 py-2"
                      style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}
                    >
                      ตำแหน่งติดตั้ง \ ประเภทรถ
                    </th>
                    {carTypes.map((ct) => (
                      <th
                        key={ct}
                        className="text-xs px-2 py-2 whitespace-nowrap"
                        style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}
                      >
                        {ct}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(priceProdCat === 'ฟิล์มกรองแสง' ? filmPositions : wrapPositions).map((pos) => (
                    <tr key={pos}>
                      <td
                        className="text-xs font-medium px-2 py-1.5 whitespace-nowrap"
                        style={{ borderBottom: '1px solid var(--line)' }}
                      >
                        {pos}
                      </td>
                      {carTypes.map((ct) => (
                        <td key={ct} className="px-1 py-1" style={{ borderBottom: '1px solid var(--line)' }}>
                          <input
                            type="number"
                            value={getFilmPrice(priceProdCat, priceProd, pos, ct)}
                            onChange={(e) => setFilmPrice(priceProdCat, priceProd, pos, ct, e.target.value)}
                            placeholder="0"
                            className="field text-xs px-2 py-1.5 w-24"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              เลือกสินค้าด้านบนเพื่อตั้งราคา
            </p>
          )}
        </div>
      )}

      <PeriodShopFilter
        shopFilter={shopFilter}
        setShopFilter={setShopFilter}
        period={period}
        setPeriod={setPeriod}
        periodValue={periodValue}
        setPeriodValue={setPeriodValue}
        rangeStart={rangeStart}
        setRangeStart={setRangeStart}
        rangeEnd={rangeEnd}
        setRangeEnd={setRangeEnd}
        allowAllShops={canSeeAllShops}
        shopOptions={accessibleShops}
      />

      {panel === 'add' && (
        <div className="card p-5 mb-4 fade-page">
          <p className="text-sm font-semibold mb-3">เพิ่มสินค้าเข้าสต็อก / ขึ้นทะเบียนสินค้าใหม่</p>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setAddStk({ ...addStk, mode: 'existing' })}
              className={`text-xs px-3 py-1.5 rounded-full font-semibold ${addStk.mode === 'existing' ? 'pill-active' : 'pill-inactive'}`}
            >
              สินค้าที่มีอยู่แล้ว
            </button>
            <button
              onClick={() => setAddStk({ ...addStk, mode: 'new' })}
              className={`text-xs px-3 py-1.5 rounded-full font-semibold ${addStk.mode === 'new' ? 'pill-active' : 'pill-inactive'}`}
            >
              ขึ้นทะเบียนสินค้าใหม่
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {addStk.mode === 'existing' ? (
              <div className="sm:col-span-2">
                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  เลือกสินค้า
                </label>
                <select
                  value={addStk.existingId}
                  onChange={(e) => setAddStk({ ...addStk, existingId: Number(e.target.value) })}
                  className="field w-full text-sm px-3 py-2"
                >
                  {stockScopedToAccess.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} &middot; {shopName(s.shop)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                    ชื่อสินค้าใหม่
                  </label>
                  <input
                    value={addStk.newName}
                    onChange={(e) => setAddStk({ ...addStk, newName: e.target.value })}
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                    ชื่อย่อสินค้า (keyword)
                  </label>
                  <input
                    value={addStk.shortName}
                    onChange={(e) => setAddStk({ ...addStk, shortName: e.target.value })}
                    placeholder="เช่น 3M60"
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                    SKU
                  </label>
                  <input
                    value={addStk.sku}
                    onChange={(e) => setAddStk({ ...addStk, sku: e.target.value })}
                    placeholder="เว้นว่างให้ระบบตั้งให้"
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                    หมวดหมู่ (ชนิดสินค้า)
                  </label>
                  <ManagedDropdown
                    value={addStk.category}
                    onChange={(v) => setAddStk({ ...addStk, category: v })}
                    options={categories}
                    setOptions={setCategories}
                    placeholder="เลือกหมวดหมู่..."
                  />
                </div>
                <div>
                  <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                    สาขา
                  </label>
                  <select
                    value={addStk.shop}
                    onChange={(e) => setAddStk({ ...addStk, shop: e.target.value })}
                    className="field w-full text-sm px-3 py-2"
                  >
                    {accessibleShops.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                {canSeePrices && (
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      ราคาต่อหน่วย (ขาย)
                    </label>
                    <input
                      type="number"
                      value={addStk.sellPrice}
                      onChange={(e) => setAddStk({ ...addStk, sellPrice: Number(e.target.value) })}
                      className="field w-full text-sm px-3 py-2"
                    />
                  </div>
                )}
                {addStk.category === 'ฟิล์มกันรอย' && (
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      จำนวนครั้ง Service ที่ให้ฟรี
                    </label>
                    <input
                      type="number"
                      value={addStk.serviceCount || ''}
                      onChange={(e) => setAddStk({ ...addStk, serviceCount: e.target.value })}
                      placeholder="เช่น 3"
                      className="field w-full text-sm px-3 py-2"
                    />
                  </div>
                )}
              </>
            )}
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                จำนวนที่รับเข้า
              </label>
              <input
                type="number"
                value={addStk.qty}
                onChange={(e) => setAddStk({ ...addStk, qty: Number(e.target.value) })}
                className="field w-full text-sm px-3 py-2"
              />
            </div>
            {canSeePrices && (
              <div>
                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  ราคาต่อหน่วย (ทุน)
                </label>
                <input
                  type="number"
                  value={addStk.cost}
                  onChange={(e) => setAddStk({ ...addStk, cost: Number(e.target.value) })}
                  className="field w-full text-sm px-3 py-2"
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ที่มา
              </label>
              <select
                value={addStk.reason}
                onChange={(e) => setAddStk({ ...addStk, reason: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              >
                <option>ซื้อเพิ่ม</option>
                <option>ได้รับมาโดยไม่ได้ซื้อ (ของแถม/สปอนเซอร์)</option>
                <option>โอนย้ายจากสาขาอื่น</option>
              </select>
            </div>
          </div>
          <button
            onClick={submitAddStock}
            className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold"
          >
            บันทึกรับสินค้าเข้าสต็อก
          </button>
        </div>
      )}

      {panel === 'adjust' && (
        <div className="card p-5 mb-4 fade-page">
          <p className="text-sm font-semibold mb-3">ปรับสต็อกให้ตรงกับการนับจริง</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="sm:col-span-1">
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                สินค้า
              </label>
              <select
                value={adj.id}
                onChange={(e) => setAdj({ ...adj, id: Number(e.target.value) })}
                className="field w-full text-sm px-3 py-2"
              >
                {stockScopedToAccess.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} &middot; {shopName(s.shop)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ในระบบ
              </label>
              <div className="field text-sm px-3 py-2" style={{ color: 'var(--ink-soft)' }}>
                {adjustItem?.qty ?? '-'}
              </div>
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                นับได้จริง
              </label>
              <input
                type="number"
                value={adj.counted}
                onChange={(e) => setAdj({ ...adj, counted: Number(e.target.value) })}
                className="field w-full text-sm px-3 py-2"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              หมายเหตุ
            </label>
            <input
              value={adj.note}
              onChange={(e) => setAdj({ ...adj, note: e.target.value })}
              placeholder="เช่น นับสต็อกประจำเดือน"
              className="field w-full text-sm px-3 py-2"
            />
          </div>
          <button onClick={submitAdjust} className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold">
            บันทึกการปรับสต็อก
          </button>
        </div>
      )}

      {panel === 'withdraw' && (
        <div className="card p-5 mb-4 fade-page">
          <p className="text-sm font-semibold mb-3">เบิกสต็อกใช้ภายใน</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                สินค้า
              </label>
              <select
                value={wd.id}
                onChange={(e) => setWd({ ...wd, id: Number(e.target.value) })}
                className="field w-full text-sm px-3 py-2"
              >
                {stockScopedToAccess.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                จำนวน
              </label>
              <input
                type="number"
                value={wd.qty}
                onChange={(e) => setWd({ ...wd, qty: Number(e.target.value) })}
                className="field w-full text-sm px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ประเภทการเบิก
              </label>
              <select
                value={wd.type}
                onChange={(e) => setWd({ ...wd, type: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              >
                <option>สินค้าตัวอย่าง</option>
                <option>ของแถมลูกค้า</option>
                <option>ใช้ภายในร้าน</option>
                <option>ของเสีย/ตัดบัญชี</option>
                <option>อื่นๆ</option>
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                เหตุผล
              </label>
              <input
                value={wd.reason}
                onChange={(e) => setWd({ ...wd, reason: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              />
            </div>
          </div>
          <button onClick={submitWithdraw} className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold">
            บันทึกการเบิก
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="card p-4">
          <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            รายการทั้งหมด
          </p>
          <p className="text-xl font-bold mt-1">{visible.length}</p>
        </div>
        <div
          className="card p-4"
          style={{
            background: lowStock > 0 ? '#FBEAEC' : 'var(--surface)',
            borderColor: lowStock > 0 ? 'transparent' : 'var(--line)',
          }}
        >
          <p className="text-xs" style={{ color: lowStock > 0 ? '#B23A48' : 'var(--ink-soft)' }}>
            ใกล้หมด
          </p>
          <p className="text-xl font-bold mt-1" style={{ color: lowStock > 0 ? '#B23A48' : 'var(--ink)' }}>
            {lowStock}
          </p>
        </div>
        {canSeePrices && (
          <div className="card p-4" style={{ background: 'var(--primary-soft)', borderColor: 'transparent' }}>
            <p className="text-xs" style={{ color: 'var(--primary)' }}>
              มูลค่าสต็อกรวม
            </p>
            <p className="text-xl font-bold mt-1" style={{ color: 'var(--primary)' }}>
              {fmt(totalValue)}
            </p>
          </div>
        )}
      </div>

      <div className="card p-5 sm:p-6 mb-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className="text-sm font-semibold">รายการสต็อก</p>
          <div className="flex gap-2 flex-wrap items-center">
            <select
              value={branchFilter}
              onChange={(e) => {
                setBranchFilter(e.target.value);
                setCatFilter('all');
                setNameFilterSel('all');
              }}
              className="field text-xs px-2.5 py-2 rounded-lg"
            >
              <option value="all">ทุกสาขา</option>
              {accessibleShops.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.name}
                </option>
              ))}
            </select>
            <select
              value={catFilter}
              onChange={(e) => {
                setCatFilter(e.target.value);
                setNameFilterSel('all');
              }}
              className="field text-xs px-2.5 py-2 rounded-lg"
            >
              <option value="all">ทุกชนิดสินค้า</option>
              {catOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={nameFilterSel}
              onChange={(e) => setNameFilterSel(e.target.value)}
              className="field text-xs px-2.5 py-2 rounded-lg"
            >
              <option value="all">ทุกชื่อสินค้า</option>
              {nameOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {can('stock.export') && (
              <div className="flex gap-2">
                <button
                  onClick={exportExcel}
                  className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-file-excel" style={{ color: '#1D6F42' }}></i>Excel
                </button>
                <button
                  onClick={exportPDF}
                  className="btn-outline text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-file-pdf" style={{ color: '#C0392B' }}></i>PDF
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="relative mb-4">
          <i
            className="fa-solid fa-magnifying-glass absolute left-3.5 top-3 text-xs"
            style={{ color: 'var(--ink-faint)' }}
          ></i>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อสินค้า / ชื่อย่อ / SKU"
            className="field w-full text-sm pl-9 pr-3.5 py-2.5"
          />
        </div>
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-xs font-medium" style={{ color: 'var(--ink-faint)' }}>
            สินค้า
          </span>
          <span className="text-xs font-medium flex-shrink-0" style={{ color: 'var(--ink-faint)' }}>
            คงเหลือ
          </span>
        </div>
        {(() => {
          const cats = [...new Set(filtered.map((s) => s.category))];
          if (filtered.length === 0)
            return (
              <p className="text-sm py-8 text-center" style={{ color: 'var(--ink-faint)' }}>
                ไม่พบสินค้าตรงกับคำค้นหา
              </p>
            );
          return cats.map((cat) => (
            <div key={cat} className="mb-4">
              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--primary)' }}>
                {cat} ({filtered.filter((s) => s.category === cat).length})
              </p>
              <div className="flex flex-col gap-2.5">
                {filtered
                  .filter((s) => s.category === cat)
                  .map((s) =>
                    editingId === s.id && editForm ? (
                      <div
                        key={s.id}
                        className="rounded-2xl p-3.5"
                        style={{ border: '1px solid var(--primary)', background: 'var(--primary-soft)' }}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            placeholder="ชื่อสินค้า"
                            className="field text-sm px-2.5 py-1.5"
                          />
                          <input
                            value={editForm.shortName || ''}
                            onChange={(e) => setEditForm({ ...editForm, shortName: e.target.value })}
                            placeholder="ชื่อย่อ (keyword)"
                            className="field text-sm px-2.5 py-1.5"
                          />
                          <input
                            value={editForm.sku}
                            onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                            placeholder="SKU"
                            className="field text-sm px-2.5 py-1.5"
                          />
                          <ManagedDropdown
                            value={editForm.category}
                            onChange={(v) => setEditForm({ ...editForm, category: v })}
                            options={categories}
                            setOptions={setCategories}
                          />
                          <div>
                            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                              คงเหลือ
                            </label>
                            <input
                              type="number"
                              value={editForm.qty}
                              onChange={(e) => setEditForm({ ...editForm, qty: Number(e.target.value) })}
                              className="field text-sm px-2.5 py-1.5 w-full"
                            />
                          </div>
                          <div>
                            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                              ขั้นต่ำ
                            </label>
                            <input
                              type="number"
                              value={editForm.min}
                              onChange={(e) => setEditForm({ ...editForm, min: Number(e.target.value) })}
                              className="field text-sm px-2.5 py-1.5 w-full"
                            />
                          </div>
                          {canSeePrices && (
                            <>
                              <div>
                                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                                  ราคาทุน
                                </label>
                                <input
                                  type="number"
                                  value={editForm.cost ?? 0}
                                  onChange={(e) => setEditForm({ ...editForm, cost: Number(e.target.value) })}
                                  className="field text-sm px-2.5 py-1.5 w-full"
                                />
                              </div>
                              <div>
                                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                                  ราคาขาย
                                </label>
                                <input
                                  type="number"
                                  value={editForm.sellPrice ?? 0}
                                  onChange={(e) =>
                                    setEditForm({ ...editForm, sellPrice: Number(e.target.value) })
                                  }
                                  className="field text-sm px-2.5 py-1.5 w-full"
                                />
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditForm(null);
                            }}
                            className="btn-outline flex-1 rounded-lg py-1.5 text-xs"
                          >
                            ยกเลิก
                          </button>
                          <button
                            onClick={saveEdit}
                            className="btn-primary flex-1 rounded-lg py-1.5 text-xs font-semibold"
                          >
                            บันทึก
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={s.id}
                        className="group rounded-2xl p-3.5 flex items-center justify-between gap-2"
                        style={{ border: s.qty < s.min ? '1px solid #C24B57' : '1px solid var(--line)' }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">
                            {s.name}{' '}
                            {s.shortName && (
                              <span className="text-xs font-normal" style={{ color: 'var(--ink-faint)' }}>
                                ({s.shortName})
                              </span>
                            )}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                            {s.sku} &middot; {shopFilter === 'all' ? shopName(s.shop) : ''}
                            {canSeePrices
                              ? `${shopFilter === 'all' ? ' · ' : ''}ทุน ${fmt(s.cost || 0)} · ขาย ${fmt(s.sellPrice || 0)}`
                              : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-right">
                            <p
                              className="text-base font-bold"
                              style={{ color: s.qty < s.min ? '#B23A48' : 'var(--ink)' }}
                            >
                              {s.qty}
                            </p>
                            <p
                              className="text-xs"
                              style={{ color: s.qty < s.min ? '#B23A48' : 'var(--ink-faint)' }}
                            >
                              {s.qty < s.min
                                ? `ต่ำกว่าขั้นต่ำ (${s.min})`
                                : canSeePrices
                                  ? `มูลค่า ${fmt(s.qty * (s.cost || 0))}`
                                  : ''}
                            </p>
                          </div>
                          {can('stock.editDelete') && (
                            <div className="flex flex-col gap-1 row-action">
                              {/* Icon-only, so the SKU carries the accessible name —
                                  otherwise every row's pair is indistinguishable. */}
                              <button
                                onClick={() => startEdit(s)}
                                aria-label={`แก้ไขสินค้า ${s.sku}`}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                                style={{ background: 'var(--paper)', color: 'var(--primary)' }}
                              >
                                <i className="fa-solid fa-pen"></i>
                              </button>
                              <button
                                onClick={() => deleteStockItem(s.id)}
                                aria-label={`ลบสินค้า ${s.sku}`}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                                style={{ background: 'var(--paper)', color: '#B23A48' }}
                              >
                                <i className="fa-solid fa-trash"></i>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
              </div>
            </div>
          ));
        })()}
      </div>

      {adjustments.length > 0 && (
        <>
          <p className="text-sm font-semibold mb-3">ประวัติการปรับสต็อก</p>
          <div className="card p-5 sm:p-6 mb-4">
            <div className="flex flex-col gap-2.5">
              {adjustments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between py-2"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <div>
                    <p className="text-sm font-medium">{a.item}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                      {a.before} &rarr; {a.after} &middot; {a.note || '-'} &middot; {a.date}
                    </p>
                  </div>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: a.diff >= 0 ? '#4C7A3E' : '#B23A48' }}
                  >
                    {a.diff >= 0 ? '+' : ''}
                    {a.diff}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <p className="text-sm font-semibold mb-3">ประวัติการตัดสต็อก (เบิก / ใบงาน / ขายส่ง)</p>
      <div className="card p-5 sm:p-6">
        <div className="flex flex-col gap-2.5">
          {visibleWithdrawals.length === 0 && (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--ink-faint)' }}>
              ยังไม่มีประวัติการตัดสต็อก
            </p>
          )}
          {visibleWithdrawals.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between py-2"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <div>
                <p className="text-sm font-medium">
                  {w.item}{' '}
                  <span style={{ color: w.qty >= 0 ? '#B23A48' : '#4C7A3E' }}>
                    {w.qty >= 0 ? `-${w.qty}` : `+${Math.abs(w.qty)}`}
                  </span>
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                  {shopName(w.shop)} &middot; {w.type} &middot; {w.by} &middot; {w.date}
                </p>
              </div>
              <StatusPill
                label={w.status}
                colorMap={{
                  รออนุมัติ: { bg: '#FBF1DA', text: '#8A5A12', dot: '#E8B23D' },
                  อนุมัติแล้ว: { bg: '#E6EFDC', text: '#4C7A3E', dot: '#6BA24F' },
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {mounted &&
        createPortal(
          <div className="print-area">
            <h2>
              รายการสต็อกสินค้า{branchFilter !== 'all' ? ' · ' + shopName(branchFilter) : ''}
            </h2>
        <p>วันที่พิมพ์: {new Date().toLocaleDateString('th-TH')}</p>
        {exportGroups.map((g) => (
          <div key={g.shopId} style={{ marginBottom: 16 }}>
            <h3>{shopName(g.shopId)}</h3>
            <table>
              <thead>
                <tr>
                  <th>ชื่อย่อสินค้า</th>
                  <th>สินค้า</th>
                  <th>หมวด</th>
                  <th>คงเหลือ</th>
                  <th>ขั้นต่ำ</th>
                  <th style={{ textAlign: 'right' }}>ราคา/หน่วย</th>
                  <th style={{ textAlign: 'right' }}>มูลค่ารวม</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.shortName || '-'}</td>
                    <td>{s.name}</td>
                    <td>{s.category}</td>
                    <td>{s.qty}</td>
                    <td>{s.min}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(s.cost || 0)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(s.qty * (s.cost || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
            <p style={{ textAlign: 'right' }}>
              <strong style={{ background: '#FFEB3B', padding: '2px 8px', borderRadius: 4 }}>
                มูลค่าสต็อกรวม: {fmt(filteredTotalValue)} บาท
              </strong>
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}
