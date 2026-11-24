'use client';

import { useEffect, useId, useState } from 'react';

import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { SearchableSelect, type SearchableOption } from '@/components/ui/SearchableSelect';
import type { Shop } from '@/components/ui/PeriodShopFilter';

import type { StockItem } from './StockModule';

/**
 * รับสินค้าเข้าสต็อก — หนึ่งใบส่งของ หลายรายการ (ร้านขอ 24 พ.ย. 2569).
 *
 * ━━ ทำไมต้องเป็นหลายบรรทัด ━━
 *
 * ใบส่งของใบหนึ่งมีสินค้าหลายตัวเป็นปกติ ของเดิมรับได้ทีละตัว คนจึงต้องกรอก
 * ชื่อผู้ขายกับเลขที่ใบส่งของซ้ำทุกรอบ พิมพ์ผิดรอบเดียวล็อตนั้นก็หลุดจากใบของ
 * มันไปเงียบ ๆ แล้วตอนไล่ย้อนว่าของล็อตนี้มาจากใบไหน ก็หาไม่เจอ
 *
 * ผู้ขายกับเลขที่ใบส่งของจึงอยู่หัวฟอร์ม กรอกครั้งเดียว ส่วนรายการอยู่ข้างล่าง
 * เพิ่มได้เรื่อย ๆ — ซึ่งเป็นรูปร่างเดียวกับกระดาษที่คนถืออยู่ตรงหน้า
 *
 * ━━ ของเดิมกับของใหม่ ปนกันได้ในใบเดียว ━━
 *
 * ของจริงใบส่งของใบเดียวมีทั้งฟิล์มที่สั่งประจำ และสินค้าตัวใหม่ที่เพิ่งลอง
 * การบังคับให้แยกเป็นสองรอบ แปลว่าใบเดียวถูกบันทึกเป็นสองใบ โหมดจึงอยู่ที่
 * บรรทัด ไม่ใช่ที่ทั้งฟอร์ม
 */

export type ReceiveLine = {
  /** คีย์ของ React เท่านั้น ไม่ได้ส่งไปไหน. */
  key: number;
  mode: 'existing' | 'new';
  existingId: number;
  newName: string;
  shortName: string;
  sku: string;
  category: string;
  shop: string;
  sellPrice: number | string;
  min: number | string;
  unitSize: number | string;
  unitLabel: string;
  qty: number | string;
  cost: number | string;
};

export type ReceiveLineCall =
  | { mode: 'existing'; existingId: number; qty: number; cost: number }
  | {
      mode: 'new';
      newName: string;
      shortName?: string;
      sku?: string;
      category: string;
      shop: string;
      qty: number;
      cost: number;
      sellPrice: number;
      min?: number;
      unitSize?: number;
      unitLabel?: string;
    };

export type ReceiveResult = { ok: boolean; received: number; error?: string };

let nextKey = 1;

export function blankReceiveLine(defaults: { stockId?: number; shop?: string }): ReceiveLine {
  return {
    key: nextKey++,
    mode: 'existing',
    existingId: defaults.stockId ?? 0,
    newName: '',
    shortName: '',
    sku: '',
    category: '',
    shop: defaults.shop ?? '',
    sellPrice: 0,
    min: 5,
    unitSize: '',
    unitLabel: '',
    qty: 1,
    cost: 0,
  };
}

/** บรรทัดที่กรอกพอจะบันทึกได้ — ที่เหลือถูกข้ามเงียบ ๆ ไม่ใช่ error. */
export function usableLines(lines: ReceiveLine[]): ReceiveLine[] {
  return lines.filter((l) => (l.mode === 'new' ? !!l.newName.trim() : !!l.existingId));
}

export function toLineInput(l: ReceiveLine): ReceiveLineCall {
  return l.mode === 'new'
    ? {
        mode: 'new',
        newName: l.newName.trim(),
        shortName: l.shortName,
        sku: l.sku,
        category: l.category,
        shop: l.shop,
        qty: Number(l.qty) || 0,
        cost: Number(l.cost) || 0,
        sellPrice: Number(l.sellPrice) || 0,
        min: Number(l.min) || 5,
        unitSize: Number(l.unitSize) || 0,
        unitLabel: l.unitLabel,
      }
    : {
        mode: 'existing',
        existingId: l.existingId,
        qty: Number(l.qty) || 0,
        cost: Number(l.cost) || 0,
      };
}

export function ReceiveStockPanel({
  stock,
  categories,
  setCategories,
  shops,
  suppliers,
  canSeePrices,
  receiveAction,
  onDirtyChange,
  onDone,
}: {
  /** สินค้าที่คนนี้แตะได้ — ตัวเลือกของบรรทัดแบบ "มีอยู่แล้ว". */
  stock: StockItem[];
  categories: string[];
  setCategories: (next: string[]) => void;
  shops: Shop[];
  /** ชื่อผู้ขายที่เคยกรอกไว้ — เลือกซ้ำได้ และพิมพ์ชื่อใหม่ก็ได้. */
  suppliers: string[];
  canSeePrices: boolean;
  /** บอกขึ้นไปว่ามีของค้างอยู่ในฟอร์ม — หน้าแม่เอาไปกันการปิดหน้าทิ้ง. */
  onDirtyChange?: (dirty: boolean) => void;
  receiveAction?: (input: {
    supplier?: string;
    docNo?: string;
    reason?: string;
    lines: ReceiveLineCall[];
  }) => Promise<ReceiveResult>;
  onDone: () => void;
}) {
  const defaults = { stockId: stock[0]?.id, shop: shops[0]?.id };
  const [supplier, setSupplier] = useState('');
  const [docNo, setDocNo] = useState('');
  const [reason, setReason] = useState('ซื้อเพิ่ม');
  const [lines, setLines] = useState<ReceiveLine[]>([blankReceiveLine(defaults)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supplierListId = useId();

  const productOptions: SearchableOption[] = stock.map((s) => ({
    value: String(s.id),
    label: s.name,
    note: shops.find((sh) => sh.id === s.shop)?.name ?? s.shop,
  }));

  const patch = (key: number, next: Partial<ReceiveLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...next } : l)));

  const ready = usableLines(lines);

  /*
    "ยังไม่ได้บันทึก" = มีอะไรที่พิมพ์ไปแล้วและจะหายถ้าปิดหน้านี้.

    บรรทัดเปล่าบรรทัดเดียวที่ฟอร์มเปิดมาพร้อมกับมัน ไม่นับ — ไม่งั้นแค่เปิดแผง
    มาดูเฉย ๆ แล้วกดออก ก็จะโดนถาม
  */
  const dirty =
    !!supplier.trim() ||
    !!docNo.trim() ||
    lines.length > 1 ||
    ready.length > 0 ||
    lines.some((l) => l.newName.trim() || l.sku.trim() || l.shortName.trim());
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  async function submit() {
    if (!ready.length || busy) return;
    setBusy(true);
    setError('');
    /*
      ดักทุกทาง ไม่ใช่เฉพาะทางที่ตอบกลับมาสวย ๆ.

      เจอตอนลองของจริง: action โยน error ออกมา (สิทธิ์สาขา) แล้วปุ่มค้างอยู่ที่
      "กำลังบันทึก…" ตลอดไป กดอะไรต่อไม่ได้ และไม่มีอะไรบนจอบอกว่าเกิดอะไรขึ้น
    */
    let res;
    try {
      res = await receiveAction?.({
        supplier,
        docNo,
        reason,
        lines: ready.map(toLineInput),
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
      return;
    }
    setBusy(false);
    if (res && !res.ok) {
      setError(res.error ?? 'บันทึกไม่สำเร็จ');
      return;
    }
    onDone();
  }

  const label = 'text-xs';
  const labelStyle = { color: 'var(--ink-soft)' };

  return (
    <div className="card p-5 mb-4 fade-page">
      <p className="text-sm font-semibold mb-1">รับสินค้าเข้าสต็อก</p>
      <p className="text-xs mb-3" style={labelStyle}>
        ใบส่งของหนึ่งใบ กรอกผู้ขายกับเลขที่ใบครั้งเดียว แล้วเพิ่มสินค้าได้หลายรายการ
        ทั้งของเดิมและของที่เพิ่งขึ้นทะเบียนใหม่
      </p>

      {/* หัวใบ — ของที่เป็นของทั้งใบ ไม่ใช่ของบรรทัดใดบรรทัดหนึ่ง */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className={label} style={labelStyle} htmlFor={`${supplierListId}-input`}>
            ผู้ขาย
          </label>
          {/*
            เลือกจากที่เคยกรอก หรือพิมพ์ชื่อใหม่ก็ได้ — ผู้ขายรายใหม่เกิดขึ้น
            ได้ตลอด ช่องที่เลือกได้อย่างเดียวจะบังคับให้คนไปขึ้นทะเบียนผู้ขาย
            ก่อน ทั้งที่ของมาถึงหน้าร้านแล้ว

            `datalist` ของเบราว์เซอร์ตรงนี้พอดีกับงาน: เป็นช่องพิมพ์ธรรมดาที่มี
            รายการเก่าห้อยอยู่ ไม่ต้องสร้างตารางผู้ขายขึ้นมาใหม่เพื่อเรื่องนี้
          */}
          <input
            id={`${supplierListId}-input`}
            list={supplierListId}
            aria-label="ผู้ขาย"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder={suppliers.length ? 'เลือกหรือพิมพ์ชื่อใหม่' : 'เช่น 3M'}
            className="field w-full text-sm px-3 py-2"
          />
          <datalist id={supplierListId}>
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={label} style={labelStyle}>
            เลขที่ใบส่งของ
          </label>
          <input
            aria-label="เลขที่ใบส่งของ"
            value={docNo}
            onChange={(e) => setDocNo(e.target.value)}
            placeholder="เช่น INV-4520"
            className="field w-full text-sm px-3 py-2"
          />
        </div>
        <div>
          <label className={label} style={labelStyle}>
            ที่มา
          </label>
          <select
            aria-label="เหตุผลที่รับสินค้าเข้า"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="field w-full text-sm px-3 py-2"
          >
            <option>ซื้อเพิ่ม</option>
            <option>ได้รับมาโดยไม่ได้ซื้อ (ของแถม/สปอนเซอร์)</option>
            <option>โอนย้ายจากสาขาอื่น</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {lines.map((l, i) => (
          <div
            key={l.key}
            className="rounded-xl p-3"
            style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}
          >
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <span className="text-xs font-bold" style={labelStyle}>
                รายการที่ {i + 1}
              </span>
              <button
                type="button"
                onClick={() => patch(l.key, { mode: 'existing' })}
                className={`text-xs px-3 py-1 rounded-full font-semibold ${l.mode === 'existing' ? 'pill-active' : 'pill-inactive'}`}
              >
                สินค้าที่มีอยู่แล้ว
              </button>
              <button
                type="button"
                onClick={() => patch(l.key, { mode: 'new' })}
                className={`text-xs px-3 py-1 rounded-full font-semibold ${l.mode === 'new' ? 'pill-active' : 'pill-inactive'}`}
              >
                ขึ้นทะเบียนสินค้าใหม่
              </button>
              {/* บรรทัดเดียวที่เหลืออยู่ ลบไม่ได้ — ฟอร์มที่ไม่มีบรรทัดเลย
                  ไม่ได้ช่วยอะไร และต้องกดเพิ่มกลับมาอยู่ดี */}
              {lines.length > 1 && (
                <button
                  type="button"
                  aria-label={`ลบรายการที่ ${i + 1}`}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  className="ml-auto text-xs px-2 py-1 rounded-lg"
                  style={{ color: '#B23A48' }}
                >
                  <i className="fa-solid fa-trash" /> ลบ
                </button>
              )}
            </div>

            {l.mode === 'existing' ? (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className={label} style={labelStyle}>
                    เลือกสินค้า
                  </label>
                  <SearchableSelect
                    label={`สินค้าของรายการที่ ${i + 1}`}
                    placeholder="พิมพ์ชื่อสินค้าหรือสาขาเพื่อค้นหา"
                    options={productOptions}
                    value={String(l.existingId)}
                    onChange={(v) => patch(l.key, { existingId: Number(v) })}
                  />
                </div>
                <div>
                  <label className={label} style={labelStyle}>
                    จำนวนที่รับเข้า
                  </label>
                  <input
                    type="number"
                    aria-label={`จำนวนที่รับเข้าของรายการที่ ${i + 1}`}
                    value={l.qty}
                    onChange={(e) => patch(l.key, { qty: e.target.value })}
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                {canSeePrices && (
                  <div>
                    <label className={label} style={labelStyle}>
                      ราคาต่อหน่วย (ทุน)
                    </label>
                    <input
                      type="number"
                      aria-label={`ราคาต่อหน่วยของรายการที่ ${i + 1}`}
                      value={l.cost}
                      onChange={(e) => patch(l.key, { cost: e.target.value })}
                      className="field w-full text-sm px-3 py-2"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label} style={labelStyle}>
                    ชื่อสินค้าใหม่
                  </label>
                  <input
                    aria-label={`ชื่อสินค้าใหม่ของรายการที่ ${i + 1}`}
                    value={l.newName}
                    onChange={(e) => patch(l.key, { newName: e.target.value })}
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                <div>
                  <label className={label} style={labelStyle}>
                    ชื่อย่อสินค้า (keyword)
                  </label>
                  <input
                    aria-label={`ชื่อย่อสินค้าของรายการที่ ${i + 1}`}
                    value={l.shortName}
                    onChange={(e) => patch(l.key, { shortName: e.target.value })}
                    placeholder="เช่น 3M60"
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                <div>
                  <label className={label} style={labelStyle}>
                    SKU
                  </label>
                  <input
                    aria-label={`SKU ของรายการที่ ${i + 1}`}
                    value={l.sku}
                    onChange={(e) => patch(l.key, { sku: e.target.value })}
                    placeholder="เว้นว่างให้ระบบตั้งให้"
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                <div>
                  <label className={label} style={labelStyle}>
                    ชนิดสินค้า
                  </label>
                  <ManagedDropdown
                    ariaLabel={`ชนิดสินค้าของรายการที่ ${i + 1}`}
                    value={l.category}
                    onChange={(v) => patch(l.key, { category: v })}
                    options={categories}
                    setOptions={setCategories}
                    placeholder="เลือกชนิดสินค้า"
                  />
                </div>
                <div>
                  <label className={label} style={labelStyle}>
                    สาขา
                  </label>
                  <select
                    aria-label={`สาขาของรายการที่ ${i + 1}`}
                    value={l.shop}
                    onChange={(e) => patch(l.key, { shop: e.target.value })}
                    className="field w-full text-sm px-3 py-2"
                  >
                    {shops.map((sh) => (
                      <option key={sh.id} value={sh.id}>
                        {sh.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} style={labelStyle}>
                    จุดสั่งซื้อ (ขั้นต่ำ)
                  </label>
                  <input
                    type="number"
                    aria-label={`จุดสั่งซื้อของรายการที่ ${i + 1}`}
                    value={l.min}
                    onChange={(e) => patch(l.key, { min: e.target.value })}
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                <div>
                  <label className={label} style={labelStyle}>
                    ปริมาณต่อหน่วย
                  </label>
                  <input
                    type="number"
                    aria-label={`ปริมาณต่อหน่วยของรายการที่ ${i + 1}`}
                    value={l.unitSize}
                    onChange={(e) => patch(l.key, { unitSize: e.target.value })}
                    placeholder="เช่น 500"
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                <div>
                  <label className={label} style={labelStyle}>
                    ชื่อหน่วยย่อย
                  </label>
                  <input
                    aria-label={`ชื่อหน่วยย่อยของรายการที่ ${i + 1}`}
                    value={l.unitLabel}
                    onChange={(e) => patch(l.key, { unitLabel: e.target.value })}
                    placeholder="เช่น ตร.ฟ."
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                <div>
                  <label className={label} style={labelStyle}>
                    จำนวนที่รับเข้า
                  </label>
                  <input
                    type="number"
                    aria-label={`จำนวนที่รับเข้าของรายการที่ ${i + 1}`}
                    value={l.qty}
                    onChange={(e) => patch(l.key, { qty: e.target.value })}
                    className="field w-full text-sm px-3 py-2"
                  />
                </div>
                {canSeePrices && (
                  <>
                    <div>
                      <label className={label} style={labelStyle}>
                        ราคาต่อหน่วย (ทุน)
                      </label>
                      <input
                        type="number"
                        aria-label={`ราคาต่อหน่วยของรายการที่ ${i + 1}`}
                        value={l.cost}
                        onChange={(e) => patch(l.key, { cost: e.target.value })}
                        className="field w-full text-sm px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className={label} style={labelStyle}>
                        ราคาต่อหน่วย (ขาย)
                      </label>
                      <input
                        type="number"
                        aria-label={`ราคาขายของรายการที่ ${i + 1}`}
                        value={l.sellPrice}
                        onChange={(e) => patch(l.key, { sellPrice: e.target.value })}
                        className="field w-full text-sm px-3 py-2"
                      />
                    </div>
                  </>
                )}
                <p className="text-xs sm:col-span-2" style={{ color: 'var(--ink-faint)' }}>
                  ฟิล์มที่เขียนขนาดไว้ท้ายชื่อ เช่น “… 40% (250)” ระบบอ่านเอาเอง ไม่ต้องกรอก —
                  กรอกเมื่อชื่อไม่ได้บอกขนาด หรือบอกไม่ตรง
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setLines((ls) => [...ls, blankReceiveLine(defaults)])}
        className="btn-outline w-full rounded-xl py-2 text-xs font-semibold mt-3"
      >
        <i className="fa-solid fa-plus" /> เพิ่มสินค้าอีกรายการ
      </button>

      {error && (
        <p className="text-xs mt-3" role="alert" style={{ color: '#B23A48' }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || ready.length === 0}
        className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold mt-3"
        style={busy || ready.length === 0 ? { opacity: 0.5 } : undefined}
      >
        {busy ? 'กำลังบันทึก…' : `บันทึกรับสินค้าเข้าสต็อก (${ready.length} รายการ)`}
      </button>
    </div>
  );
}
