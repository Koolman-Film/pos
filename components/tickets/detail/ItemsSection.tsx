'use client';

import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { ManagedMultiChipPicker } from '@/components/ui/ManagedMultiChipPicker';
import { ProductPicker, productDisplayFor } from '@/components/ui/ProductPicker';
import { fmt } from '@/lib/domain/format';
import { itemNetPrice } from '@/lib/domain/tickets';

import type { StockRow, Ticket, TicketItem, TicketPosition } from '../types';

/**
 * สินค้า/การติดตั้ง — items-by-category with per-position pickers.
 * Ported from reference/v0.4/finnix-film.html:1514-1656.
 */
export function ItemsSection({
  t,
  stock,
  productCategories,
  filmPositions,
  setFilmPositions,
  wrapPositions,
  setWrapPositions,
  serviceItems,
  setServiceItems,
  addItem,
  removeItem,
  updateItem,
  updateItemFields,
  updateFilmPositions,
  lookupPrice,
  lookupFilmPrice,
  commitPrice,
}: {
  t: Ticket;
  stock: StockRow[];
  productCategories: string[];
  filmPositions: string[];
  setFilmPositions: (v: string[]) => void;
  wrapPositions: string[];
  setWrapPositions: (v: string[]) => void;
  serviceItems: string[];
  setServiceItems: (v: string[]) => void;
  addItem: () => void;
  removeItem: (idx: number) => void;
  updateItem: (idx: number, key: keyof TicketItem, val: unknown) => void;
  updateItemFields: (idx: number, fields: Partial<TicketItem>) => void;
  updateFilmPositions: (idx: number, positions: TicketPosition[]) => void;
  lookupPrice: (product: string, fallback: number) => number;
  lookupFilmPrice: (
    category: string,
    product: string,
    position: string,
    fallback: number,
  ) => number;
  commitPrice: (product: string, price: number | string) => void;
}) {
  // สินค้าที่สนใจ is the one baseline the cheer-up is measured against. It used
  // to be `booked` here and `interested` on the printed sheet, off two separate
  // pairs of boxes — so the ticket and its own ใบงานขาย could disagree about
  // how much the upsell was worth. One source, both places.
  const cheerItems = t.items.filter((i) => i.interested || Number(i.interestedPrice || 0) > 0);
  const upsell = cheerItems.reduce(
    (s, i) => s + (Number(i.soldPrice || 0) - Number(i.interestedPrice || 0)),
    0,
  );

  // The figure on its own says how much the upsell was worth but not what it
  // was FROM, so the baseline product's name and price sit next to it — GROUPED
  // BY CATEGORY, because a ticket carrying film and audio produced a flat list
  // of rows with no way to tell which upsell belonged to which job.
  const cheerRows = cheerItems.map((i) => ({
    category: i.category || 'ไม่ระบุชนิดสินค้า',
    booked: productDisplayFor(i.interested || '', stock) || 'ไม่ได้ระบุสินค้าที่สนใจ',
    bookedPrice: Number(i.interestedPrice || 0),
    sold: productDisplayFor(i.sold, stock) || 'ยังไม่ได้เลือกสินค้าที่ขาย',
    soldPrice: Number(i.soldPrice || 0),
    diff: Number(i.soldPrice || 0) - Number(i.interestedPrice || 0),
  }));
  const cheerByCategory = [...new Set(cheerRows.map((r) => r.category))].map((category) => {
    const rows = cheerRows.filter((r) => r.category === category);
    return { category, rows, total: rows.reduce((s, r) => s + r.diff, 0) };
  });

  // The heading lives in the FormSection wrapper — see detail/FormSection.tsx.
  return (
    <div className="mb-1">
      {upsell !== 0 && (
        <div className="flex justify-end mb-3">
          <span
            className="text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{
              background: upsell >= 0 ? '#E6EFDC' : '#FBEAEC',
              color: upsell >= 0 ? '#4C7A3E' : '#B23A48',
            }}
          >
            ส่วนต่างเชียร์ขาย {upsell >= 0 ? '+' : ''}
            {fmt(upsell)}
          </span>
        </div>
      )}
      {cheerByCategory.length > 0 && (
        <div className="rounded-xl p-2.5 mb-3" style={{ background: 'var(--paper)' }}>
          {cheerByCategory.map((group) => (
            <div key={group.category} className="mb-2 last:mb-0">
              <div className="flex justify-between gap-2 text-xs font-semibold mb-0.5">
                <span style={{ color: 'var(--primary)' }}>{group.category}</span>
                <span style={{ color: group.total >= 0 ? '#4C7A3E' : '#B23A48' }}>
                  {group.total >= 0 ? '+' : ''}
                  {fmt(group.total)}
                </span>
              </div>
              {group.rows.map((r, i) => (
                <div key={i} className="text-xs py-0.5 pl-2">
                  <div className="flex justify-between gap-2">
                    <span style={{ color: 'var(--ink-soft)' }}>
                      สนใจ {r.booked} &middot; {fmt(r.bookedPrice)}
                    </span>
                    <span
                      className="flex-shrink-0"
                      style={{ color: r.diff >= 0 ? '#4C7A3E' : '#B23A48' }}
                    >
                      {r.diff >= 0 ? '+' : ''}
                      {fmt(r.diff)}
                    </span>
                  </div>
                  <div style={{ color: 'var(--ink-faint)' }}>
                    ขาย {r.sold} &middot; {fmt(r.soldPrice)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {t.items.map((it, idx) => {
        // EVERY product in the category is selectable, not just this shop's.
        //
        // The old rule showed only `s.shop === t.shop`, and fell back to the
        // full list only when this shop stocked nothing in the category at all.
        // A product another branch carries was therefore invisible — which is
        // what "สินค้าบางชนิดไม่แสดงให้เลือก" was. The shop's own stock still
        // comes first and carries its remaining count; the rest follow, dimmed
        // and labelled, because selling one means ordering it in.
        const inShop = stock.filter((s) => s.category === it.category && s.shop === t.shop);
        const elsewhere = stock.filter(
          (s) =>
            s.category === it.category &&
            s.shop !== t.shop &&
            !inShop.some((own) => own.name === s.name),
        );
        const seen = new Set<string>();
        const productOptions = [
          ...inShop.map((s) => ({ ...s, note: `คงเหลือ ${s.qty}` })),
          ...elsewhere
            .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
            .map((s) => ({ ...s, note: 'ไม่มีในสาขานี้', muted: true })),
        ];
        const usesPositions = it.category === 'ฟิล์มกรองแสง' || it.category === 'ฟิล์มกันรอย';
        const isService = it.category === 'งานบริการ';
        const positionOptions = it.category === 'ฟิล์มกรองแสง' ? filmPositions : wrapPositions;
        const setPositionOptions =
          it.category === 'ฟิล์มกรองแสง' ? setFilmPositions : setWrapPositions;
        return (
          <div
            key={idx}
            className="rounded-2xl p-3.5 mb-2.5"
            style={{ border: '1px solid var(--line)' }}
          >
            <div className="flex justify-between mb-2.5 gap-2">
              <select
                value={it.category}
                aria-label="ชนิดสินค้า"
                onChange={(e) =>
                  updateItemFields(idx, {
                    category: e.target.value,
                    sold: '',
                    booked: '',
                    positions: [],
                  })
                }
                className="field text-xs px-2.5 py-1.5 flex-1"
              >
                <option value="" disabled>
                  ชนิดสินค้า...
                </option>
                {productCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeItem(idx)}
                className="text-xs px-2 rounded-lg"
                style={{ color: '#B23A48' }}
                aria-label="ลบรายการ"
              >
                <i className="fa-solid fa-trash"></i>
              </button>
            </div>
            {it.category && (
              /*
                สินค้าที่สนใจ is the only baseline now (the duplicate
                "สินค้าที่จองไว้ตอนแรก" pair below it is gone), so it gets a
                surface of its own: two unlabelled pairs of boxes holding
                different prices for the same product is what made this section
                hard to read in the first place.
              */
              <div
                className="rounded-xl p-2.5 mb-3"
                style={{ background: '#FFF7E8', border: '1px dashed #D8A83A' }}
              >
                <label className="text-xs font-semibold" style={{ color: '#8A5A12' }}>
                  {/* Wording unchanged from what staff already know — the box,
                      the star and the colour are what make it findable now. */}
                  <i className="fa-solid fa-star mr-1.5"></i>
                  สินค้าที่สนใจ (ไม่บังคับ — ใช้เทียบ cheer-up)
                </label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <ProductPicker
                    value={it.interested || ''}
                    label="สินค้าที่ลูกค้าสนใจ"
                    placeholder="ไม่ระบุ"
                    emptyLabel="ไม่ระบุ"
                    options={productOptions}
                    className="field w-full text-xs px-2.5 py-1.5"
                    onChange={(prodName) => {
                      const p = productOptions.find((x) => x.name === prodName);
                      const fallback = p ? p.sellPrice || p.cost * 2 : 0;
                      updateItemFields(idx, {
                        interested: prodName,
                        interestedPrice: prodName ? lookupPrice(prodName, fallback) : '',
                      });
                    }}
                  />
                  <input
                    type="number"
                    placeholder="ราคา"
                    value={it.interestedPrice ?? ''}
                    onChange={(e) => updateItem(idx, 'interestedPrice', e.target.value)}
                    className="field text-xs px-2.5 py-1.5"
                  />
                </div>
                {it.interested && (
                  <div
                    className="flex justify-between text-xs mt-2"
                    style={{
                      color:
                        Number(it.soldPrice || 0) - Number(it.interestedPrice || 0) >= 0
                          ? '#4C7A3E'
                          : '#B23A48',
                    }}
                  >
                    <span>ส่วนต่างจากสินค้าที่สนใจ (Cheer-up)</span>
                    <span>
                      {Number(it.soldPrice || 0) - Number(it.interestedPrice || 0) >= 0 ? '+' : ''}
                      {fmt(Number(it.soldPrice || 0) - Number(it.interestedPrice || 0))}
                    </span>
                  </div>
                )}
              </div>
            )}
            {usesPositions ? (
              <div>
                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  ตำแหน่งติดตั้ง (เลือกได้หลายตำแหน่ง)
                </label>
                <div className="mt-1.5 mb-2.5">
                  <ManagedMultiChipPicker
                    values={(it.positions || []).map((p) => p.position)}
                    onChange={(selected) => {
                      const existing = it.positions || [];
                      const positions = selected.map(
                        (pos) =>
                          existing.find((p) => p.position === pos) || {
                            position: pos,
                            product: '',
                            price: 0,
                          },
                      );
                      updateFilmPositions(idx, positions);
                    }}
                    options={positionOptions}
                    setOptions={setPositionOptions}
                  />
                </div>
                {(it.positions || []).length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                    เลือกตำแหน่งที่ต้องการติดตั้งด้านบน
                  </p>
                )}
                {(it.positions || []).map((p, pIdx) => (
                  <div
                    key={p.position}
                    className="rounded-xl p-2.5 mb-2"
                    style={{ background: 'var(--paper)' }}
                  >
                    <p className="text-xs font-semibold mb-1.5">
                      {p.position} <span style={{ color: '#B23A48' }}>*</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <ProductPicker
                        value={p.product}
                        label={`สินค้าประจำตำแหน่ง ${p.position}`}
                        placeholder="เลือกสินค้า..."
                        options={productOptions}
                        className="field w-full text-xs px-2.5 py-1.5"
                        onChange={(prodName) => {
                          const match = productOptions.find((x) => x.name === prodName);
                          const fallback = match ? match.sellPrice || match.cost * 2 : 0;
                          const price = lookupFilmPrice(
                            it.category,
                            prodName,
                            p.position,
                            fallback,
                          );
                          const positions = [...(it.positions || [])];
                          positions[pIdx] = { ...positions[pIdx], product: prodName, price };
                          updateFilmPositions(idx, positions);
                        }}
                      />
                      <input
                        type="number"
                        placeholder="ราคา"
                        value={p.price}
                        onChange={(e) => {
                          const positions = [...(it.positions || [])];
                          positions[pIdx] = { ...positions[pIdx], price: e.target.value };
                          updateFilmPositions(idx, positions);
                        }}
                        className="field text-xs px-2.5 py-1.5"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/*
                  Both rows below were unlabelled: once a product was chosen the
                  placeholder disappeared and the ticket showed two identical
                  pairs of boxes, the lower one holding a different number for
                  the same product. Saying which is which is the whole fix.
                */}
                <label className="text-xs block mb-1" style={{ color: 'var(--ink-soft)' }}>
                  สินค้าที่ขายจริง / ราคาที่ขาย
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {isService ? (
                    <ManagedDropdown
                      value={it.sold}
                      onChange={(v) =>
                        updateItemFields(idx, {
                          sold: v,
                          soldPrice: lookupPrice(v, Number(it.soldPrice || 0)),
                        })
                      }
                      options={serviceItems}
                      setOptions={setServiceItems}
                      placeholder="เลือกบริการ..."
                    />
                  ) : (
                    <ProductPicker
                      value={it.sold}
                      label="สินค้าที่ขายจริง"
                      placeholder={it.category ? 'สินค้าที่ขาย...' : 'เลือกชนิดสินค้าก่อน'}
                      options={productOptions}
                      disabled={!it.category}
                      className="field w-full text-sm px-3 py-2 font-medium"
                      onChange={(prodName) => {
                        const p = productOptions.find((x) => x.name === prodName);
                        const fallback = p ? p.sellPrice || p.cost * 2 : 0;
                        updateItemFields(idx, {
                          sold: prodName,
                          soldPrice: lookupPrice(prodName, fallback),
                        });
                      }}
                    />
                  )}
                  <input
                    type="number"
                    placeholder="ราคาที่ขาย"
                    value={it.soldPrice}
                    onChange={(e) => {
                      updateItem(idx, 'soldPrice', e.target.value);
                      commitPrice(it.sold, e.target.value);
                    }}
                    className="field text-sm px-3 py-2"
                  />
                </div>
                {it.category && !isService && productOptions.length === 0 && (
                  <p className="text-xs mt-1.5" style={{ color: '#B23A48' }}>
                    <i className="fa-solid fa-triangle-exclamation mr-1"></i>ยังไม่มีสินค้าหมวด
                    &quot;{it.category}&quot; ในสต็อก — ไปเพิ่มสินค้าที่เมนู &quot;สต็อกสินค้า&quot;
                    &rarr; &quot;เพิ่มสินค้า&quot; ก่อน
                  </p>
                )}
                {/*
                  "สินค้าที่จองไว้ตอนแรก / ราคาที่จอง" used to sit here. It asked
                  the same question as สินค้าที่สนใจ above and fed a second
                  cheer-up figure that could disagree with it, so the ticket
                  showed two different answers to "how much did we make on the
                  upsell". The column stays in the database — old tickets keep
                  what they recorded — but nothing writes it any more.
                */}
              </>
            )}
            {it.sold && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="flex justify-between text-sm font-semibold mb-2">
                  <span>ยอดรวม</span>
                  <span>{fmt(Number(it.soldPrice || 0))}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <select
                    value={it.discountType || ''}
                    aria-label="ประเภทส่วนลด"
                    onChange={(e) => updateItem(idx, 'discountType', e.target.value || null)}
                    className="field text-xs px-2 py-1.5"
                  >
                    <option value="">ไม่มีส่วนลด</option>
                    <option value="percent">ส่วนลด %</option>
                    <option value="amount">ส่วนลด บาท</option>
                  </select>
                  {it.discountType && (
                    <input
                      type="number"
                      placeholder={it.discountType === 'percent' ? 'เช่น 10' : 'เช่น 500'}
                      value={it.discountValue || ''}
                      onChange={(e) => updateItem(idx, 'discountValue', e.target.value)}
                      className="field text-xs px-2.5 py-1.5 flex-1"
                    />
                  )}
                </div>
                {it.discountType && it.discountValue ? (
                  <div
                    className="flex justify-between text-sm font-bold mt-2"
                    style={{ color: '#4C7A3E' }}
                  >
                    <span>ยอดสุทธิหลังส่วนลด</span>
                    <span>
                      {fmt(
                        itemNetPrice({
                          soldPrice: Number(it.soldPrice || 0),
                          discountType: it.discountType,
                          discountValue: Number(it.discountValue),
                        }),
                      )}
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={addItem}
        className="btn-outline w-full text-sm rounded-2xl py-2.5 flex items-center justify-center gap-2 font-medium"
      >
        <i className="fa-solid fa-plus"></i>เพิ่มสินค้าในคันนี้
      </button>
    </div>
  );
}
