'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { OptionManageProvider } from '@/components/ui/optionManage';
import { fmt, thaiBahtText } from '@/lib/domain/format';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { confirmDiscardIfDirty, useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { orderTotal, orderPaid } from '@/lib/domain/orders';

import { CustomerPicker } from './CustomerPicker';
import {
  customerName,
  customerPurchasedProducts,
  shopName,
  DEFAULT_WS_STATUS,
  DEFAULT_PAYMENT_METHODS,
  type Shop,
  type WsCustomer,
  type WsOrder,
  type WsShopInfo,
  type WsStatusMap,
  type WsStockItem,
} from './types';

/**
 * Ported from reference/v0.4/finnix-film.html:2690-2967.
 *
 * Editing stays entirely client-side against a local draft `o` (exactly as the
 * prototype did); persistence and the capability-gated status transitions are
 * delegated to the optional server-action props supplied by
 * `app/(app)/wholesale/[id]/page.tsx`:
 *   - `onSaveOrder`     persists the whole PO (and redirects back to the list).
 *   - `onApprovePrice`  / `onRejectPrice` — gated by `wholesale.priceApproval`.
 *   - `onMarkBadDebt`   — gated by `wholesale.badDebt`.
 * Per correction C2 those server actions re-check the capability on the server;
 * the `canDo(...)` gates here only hide the controls. When the actions are
 * omitted (isolated unit test), the buttons fall back to the prototype's
 * local-only state change so the component still works standalone.
 *
 * Everything except `order` is optional so the component can be rendered bare
 * (see the Step-3 component test).
 */
export function WholesaleDetail({
  order,
  canDo,
  caps,
  customers = [],
  stock = [],
  orders = [],
  paymentMethods = DEFAULT_PAYMENT_METHODS,
  shopInfo = {},
  wsStatuses = DEFAULT_WS_STATUS,
  shops = [],
  isNew = false,
  onSaveOrder,
  onApprovePrice,
  onRejectPrice,
  onMarkBadDebt,
  onSaveCustomer,
  onBack,
  updateOptionListAction,
}: {
  order: WsOrder;
  /**
   * Capability check. Pass a function directly (as the prototype and the unit
   * test do) or a serializable `caps` map from a Server Component — the page
   * cannot hand a closure across the server/client boundary. When both are
   * absent every capability is denied.
   */
  canDo?: (capabilityKey: string) => boolean;
  caps?: Record<string, boolean>;
  customers?: WsCustomer[];
  stock?: WsStockItem[];
  orders?: WsOrder[];
  paymentMethods?: string[];
  shopInfo?: Record<string, WsShopInfo>;
  wsStatuses?: WsStatusMap;
  shops?: Shop[];
  isNew?: boolean;
  onBack?: () => void;
  onSaveOrder?: (order: WsOrder, isNew: boolean) => Promise<void> | void;
  onApprovePrice?: (orderId: string) => Promise<void> | void;
  onRejectPrice?: (orderId: string) => Promise<void> | void;
  onMarkBadDebt?: (orderId: string) => Promise<void> | void;
  onSaveCustomer?: (input: {
    id?: number;
    name: string;
    phone: string;
    address: string;
  }) => Promise<number> | number;
  /**
   * Persists วิธีชำระเงิน. Without it the picker only edits React state, so a
   * method added here was gone on the next load.
   */
  updateOptionListAction?: (
    listKey: string,
    values: string[],
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const can = canDo ?? ((k: string) => !!caps?.[k]);
  const [o, setO] = useState<WsOrder>(order);
  const [methods, setMethodsState] = useState<string[]>(paymentMethods);
  /** Optimistic locally, persisted through the shared option-list action. */
  function setMethods(next: string[]) {
    setMethodsState(next);
    void updateOptionListAction?.('payment_methods', next);
  }
  const mounted = useIsMounted();
  const [printMode, setPrintMode] = useState<'invoice' | 'receipt' | null>(null);

  const isDirty = JSON.stringify(o) !== JSON.stringify(order);
  useUnsavedChangesGuard(isDirty, 'มีข้อมูลใน PO นี้ที่ยังไม่ได้บันทึก');

  function doPrint(mode: 'invoice' | 'receipt') {
    setPrintMode(mode);
    setTimeout(() => window.print(), 50);
  }

  async function save() {
    // `onSaveOrder` (the `saveOrder` server action) persists then redirects back
    // to the list, so there is nothing to navigate here on success.
    if (onSaveOrder) await onSaveOrder(o, isNew);
  }

  // Discard edits and return to the list. Router-free (this component is unit
  // tested rendered bare, so it must not call `useRouter`); the page supplies
  // `onBack` for a soft navigation, otherwise fall back to a hard nav.
  function goBack() {
    // Confirm before throwing away edits, as the prototype does (:2743). The port
    // had only the beforeunload guard here, so the in-app back button silently
    // discarded a half-edited PO.
    if (
      !confirmDiscardIfDirty(
        isDirty,
        'มีข้อมูลใน PO นี้ที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้โดยไม่บันทึกหรือไม่?',
      )
    ) {
      return;
    }
    if (onBack) onBack();
    else if (typeof window !== 'undefined') window.location.assign('/wholesale');
  }

  function field<K extends keyof WsOrder>(k: K, v: WsOrder[K]) {
    setO({ ...o, [k]: v });
  }
  function addItem() {
    setO({
      ...o,
      items: [...o.items, { name: '', qty: 1, listPrice: 0, requestedPrice: 0, reason: '' }],
    });
  }
  function updateItem(idx: number, k: keyof WsOrder['items'][number], v: string | number) {
    const items = [...o.items];
    items[idx] = { ...items[idx], [k]: v };
    setO({ ...o, items });
  }
  function selectProduct(idx: number, name: string) {
    const match = stock.find((s) => s.shop === o.shop && s.name === name);
    const items = [...o.items];
    items[idx] = {
      ...items[idx],
      name,
      listPrice: match ? match.sellPrice : items[idx].listPrice,
      requestedPrice: match ? match.sellPrice : items[idx].requestedPrice,
    };
    setO({ ...o, items });
  }
  const purchasedProducts = [
    ...new Set([
      ...o.items.map((it) => it.name).filter(Boolean),
      ...customerPurchasedProducts(o.customerId, orders),
    ]),
  ];
  function addReturn() {
    setO({
      ...o,
      returns: [...o.returns, { item: purchasedProducts[0] || '', qty: 1, reason: '' }],
    });
  }
  function updateReturn(idx: number, k: keyof WsOrder['returns'][number], v: string | number) {
    const returns = [...o.returns];
    returns[idx] = { ...returns[idx], [k]: v };
    setO({ ...o, returns });
  }
  function addAdjustment() {
    setO({ ...o, adjustments: [...o.adjustments, { amount: 0, reason: '', date: 'วันนี้' }] });
  }
  function updateAdjustment(
    idx: number,
    k: keyof WsOrder['adjustments'][number],
    v: string | number,
  ) {
    const adjustments = [...o.adjustments];
    adjustments[idx] = { ...adjustments[idx], [k]: v };
    setO({ ...o, adjustments });
  }
  function removeAdjustment(idx: number) {
    setO({ ...o, adjustments: o.adjustments.filter((_, i) => i !== idx) });
  }
  function addPayment() {
    setO({
      ...o,
      payments: [...o.payments, { amount: 0, method: 'เงินสด', date: '', attachments: [] }],
    });
  }
  function updatePayment(
    idx: number,
    k: keyof WsOrder['payments'][number],
    v: string | number | string[],
  ) {
    const payments = [...o.payments];
    payments[idx] = { ...payments[idx], [k]: v };
    setO({ ...o, payments });
  }

  // Approve/reject/bad-debt: optimistic local status change (prototype
  // behaviour) plus the server transition when wired. The server action is the
  // real authorization boundary (C2); the buttons are only visible because of
  // the `canDo` gate below.
  async function approvePrice() {
    field('status', 'รอจัดส่ง');
    if (onApprovePrice) await onApprovePrice(o.id);
  }
  async function rejectPrice() {
    field('status', 'รออนุมัติราคา');
    if (onRejectPrice) await onRejectPrice(o.id);
  }
  async function markBadDebt() {
    field('status', 'ค้างชำระ');
    if (onMarkBadDebt) await onMarkBadDebt(o.id);
  }

  const total = orderTotal(o);
  const paid = orderPaid(o);
  const itemsTotal = o.items.reduce((s, i) => s + i.qty * i.requestedPrice, 0);
  const returnsTotal = o.returns.reduce((s, r) => {
    const it = o.items.find((i) => i.name === r.item);
    return s + (it ? r.qty * it.requestedPrice : 0);
  }, 0);
  const adjustmentsTotal = o.adjustments.reduce((s, a) => s + Number(a.amount || 0), 0);
  const hasBreakdown = o.returns.length > 0 || o.adjustments.length > 0;
  const canInvoice = !isNew;
  const canReceipt = o.payments.length > 0 && paid > 0;
  const hasDiscount = o.items.some((i) => i.requestedPrice < i.listPrice);
  const st = wsStatuses[o.status] || {};

  return (
    <OptionManageProvider canManage={can('options.manage')}>
      <div className="max-w-2xl fade-page">
        <button
          onClick={goBack}
          className="text-sm mb-4 flex items-center gap-2 font-medium"
          style={{ color: 'var(--ink-soft)' }}
        >
          <i className="fa-solid fa-arrow-left"></i>กลับไปรายการขายส่ง
        </button>
        <div className="card p-5 sm:p-7">
          <div className="flex items-start justify-between mb-3">
            {/*
              Which branch the PO belongs to — a choice while it is new, a fact
              once it is saved. Somebody who can see several branches opens POs
              for all of them; before this it silently landed on whichever
              branch sorted first. An existing PO keeps its branch: the number,
              the stock it draws and the customer's paperwork all name it.
            */}
            {isNew && shops.length > 1 ? (
              <select
                value={o.shop}
                aria-label="สาขาที่เปิด PO"
                onChange={(e) => field('shop', e.target.value)}
                className="field text-xs px-2.5 py-1.5"
              >
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <p
                className="text-xs font-semibold flex items-center gap-1.5"
                style={{ color: 'var(--primary)' }}
              >
                <i className="fa-solid fa-store"></i>
                {shopName(o.shop, shops)}
              </p>
            )}
            <select
              value={o.status}
              aria-label="สถานะของ PO"
              onChange={(e) => field('status', e.target.value)}
              className="text-xs font-semibold px-2.5 py-1 rounded-full border-none cursor-pointer"
              style={{ background: st.bg || '#F1EDE7', color: st.text || '#6B5F55' }}
            >
              {Object.keys(wsStatuses).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-5">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink-soft)' }}>
              ลูกค้า/ร้าน
            </label>
            <CustomerPicker
              customerId={o.customerId}
              customers={customers}
              onSelect={(id) => field('customerId', id)}
              onSaveCustomer={onSaveCustomer}
            />
          </div>
          <div className="mb-5">
            <p className="text-xs font-medium mb-3" style={{ color: 'var(--ink-soft)' }}>
              <i className="fa-solid fa-boxes-stacked mr-1.5"></i>รายการสินค้า
            </p>
            {o.items.map((it, idx) => (
              <div
                key={idx}
                className="rounded-2xl p-3.5 mb-2.5"
                style={{
                  border:
                    it.requestedPrice < it.listPrice
                      ? '1px solid #C24B57'
                      : '1px solid var(--line)',
                }}
              >
                <select
                  value={it.name}
                  aria-label="สินค้าในรายการ"
                  onChange={(e) => selectProduct(idx, e.target.value)}
                  className="field text-sm px-3 py-2 w-full mb-2 font-medium"
                >
                  <option value="" disabled>
                    เลือกสินค้า...
                  </option>
                  {it.name && !stock.some((s) => s.shop === o.shop && s.name === it.name) && (
                    <option value={it.name}>{it.name}</option>
                  )}
                  {stock
                    .filter((s) => s.shop === o.shop)
                    .map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name} ({s.shortName || '-'}) &middot; คงเหลือ {s.qty}
                      </option>
                    ))}
                </select>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      จำนวน
                    </label>
                    <input
                      type="number"
                      value={it.qty}
                      onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                      className="field text-sm px-2.5 py-1.5 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      ราคามาตรฐาน
                    </label>
                    <input
                      type="number"
                      value={it.listPrice}
                      onChange={(e) => updateItem(idx, 'listPrice', e.target.value)}
                      className="field text-sm px-2.5 py-1.5 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      ราคาที่เสนอ
                    </label>
                    <input
                      type="number"
                      value={it.requestedPrice}
                      onChange={(e) => updateItem(idx, 'requestedPrice', e.target.value)}
                      className="field text-sm px-2.5 py-1.5 w-full"
                    />
                  </div>
                </div>
                {it.requestedPrice < it.listPrice && (
                  <input
                    placeholder="เหตุผลที่ให้ส่วนลด"
                    value={it.reason}
                    onChange={(e) => updateItem(idx, 'reason', e.target.value)}
                    className="field text-xs px-2.5 py-1.5 w-full mt-2"
                    style={{ color: '#B23A48' }}
                  />
                )}
              </div>
            ))}
            <button
              onClick={addItem}
              className="btn-outline w-full text-sm rounded-2xl py-2.5 flex items-center justify-center gap-2 font-medium"
            >
              <i className="fa-solid fa-plus"></i>เพิ่มรายการสินค้า
            </button>
          </div>
          {hasDiscount && o.status === 'รออนุมัติราคา' && can('wholesale.priceApproval') && (
            <div className="rounded-2xl p-4 mb-5" style={{ background: '#FBEAEC' }}>
              <p className="text-sm font-semibold mb-3" style={{ color: '#B23A48' }}>
                <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>มีส่วนลดรออนุมัติ
              </p>
              <div className="flex gap-2">
                <button
                  onClick={approvePrice}
                  className="btn-primary flex-1 rounded-xl py-2 text-sm font-semibold"
                >
                  อนุมัติราคานี้
                </button>
                <button
                  onClick={rejectPrice}
                  className="btn-outline flex-1 rounded-xl py-2 text-sm font-medium"
                >
                  ปฏิเสธ
                </button>
              </div>
            </div>
          )}
          {hasDiscount && o.status === 'รออนุมัติราคา' && !can('wholesale.priceApproval') && (
            <div className="rounded-2xl p-4 mb-5" style={{ background: '#FBF1DA' }}>
              <p className="text-sm font-medium" style={{ color: '#8A5A12' }}>
                <i className="fa-solid fa-clock mr-1.5"></i>มีส่วนลดรออนุมัติจากผู้บริหาร/แอดมิน
              </p>
            </div>
          )}
          <div className="mb-5">
            <p className="text-xs font-medium mb-3" style={{ color: 'var(--ink-soft)' }}>
              <i className="fa-solid fa-rotate-left mr-1.5"></i>การคืนสินค้า
            </p>
            {o.returns.map((r, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <select
                  value={r.item}
                  aria-label="สินค้าที่รับคืน"
                  onChange={(e) => updateReturn(idx, 'item', e.target.value)}
                  className="field text-xs px-2.5 py-1.5 flex-1"
                >
                  <option value="" disabled>
                    เลือกสินค้าที่เคยซื้อ...
                  </option>
                  {purchasedProducts.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={r.qty}
                  onChange={(e) => updateReturn(idx, 'qty', e.target.value)}
                  className="field text-xs px-2.5 py-1.5 w-16"
                />
                <input
                  placeholder="เหตุผล"
                  value={r.reason}
                  onChange={(e) => updateReturn(idx, 'reason', e.target.value)}
                  className="field text-xs px-2.5 py-1.5 flex-1"
                />
              </div>
            ))}
            <button
              onClick={addReturn}
              className="btn-outline w-full text-sm rounded-2xl py-2 flex items-center justify-center gap-2 font-medium"
            >
              <i className="fa-solid fa-plus"></i>บันทึกการคืนสินค้า
            </button>
          </div>
          <div className="mb-5">
            <p className="text-xs font-medium mb-3" style={{ color: 'var(--ink-soft)' }}>
              <i className="fa-solid fa-money-bill-transfer mr-1.5"></i>ปรับราคา
              (กรณีเก็บเงินไม่ตรงยอดเรียกเก็บ แม้ส่งของแล้ว)
            </p>
            {o.adjustments.map((a, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <input
                  type="number"
                  placeholder="จำนวนที่ปรับลด"
                  value={a.amount}
                  onChange={(e) => updateAdjustment(idx, 'amount', e.target.value)}
                  className="field text-xs px-2.5 py-1.5 w-32"
                />
                <input
                  placeholder="เหตุผล เช่น ลูกค้าต่อรองราคาหลังส่งของ"
                  value={a.reason}
                  onChange={(e) => updateAdjustment(idx, 'reason', e.target.value)}
                  className="field text-xs px-2.5 py-1.5 flex-1"
                />
                <button
                  onClick={() => removeAdjustment(idx)}
                  className="text-xs px-2 rounded-lg"
                  style={{ color: '#B23A48' }}
                >
                  <i className="fa-solid fa-trash"></i>
                </button>
              </div>
            ))}
            <button
              onClick={addAdjustment}
              className="btn-outline w-full text-sm rounded-2xl py-2 flex items-center justify-center gap-2 font-medium"
            >
              <i className="fa-solid fa-plus"></i>เพิ่มรายการปรับราคา
            </button>
            <p className="text-xs mt-2" style={{ color: 'var(--ink-faint)' }}>
              ใส่ตัวเลขบวกเพื่อลดยอดเรียกเก็บ ใส่ค่าติดลบหากต้องปรับเพิ่ม (เช่น เก็บเงินขาดตอนแรก)
            </p>
          </div>
          <div className="rounded-2xl p-4 mb-5" style={{ background: 'var(--paper)' }}>
            {hasBreakdown && (
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: 'var(--ink-soft)' }}>ยอดสินค้ารวม</span>
                <span className="font-medium">{fmt(itemsTotal)}</span>
              </div>
            )}
            {o.returns.length > 0 && (
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: 'var(--ink-soft)' }}>
                  การคืนสินค้า ({o.returns.length} รายการ)
                </span>
                <span className="font-medium" style={{ color: '#B23A48' }}>
                  -{fmt(returnsTotal)}
                </span>
              </div>
            )}
            {o.adjustments.length > 0 && (
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: 'var(--ink-soft)' }}>
                  ปรับราคา ({o.adjustments.length} รายการ)
                </span>
                <span
                  className="font-medium"
                  style={{ color: adjustmentsTotal >= 0 ? '#B23A48' : '#4C7A3E' }}
                >
                  {adjustmentsTotal >= 0 ? '-' : '+'}
                  {fmt(Math.abs(adjustmentsTotal))}
                </span>
              </div>
            )}
            <div
              className="flex justify-between text-sm mb-1"
              style={hasBreakdown ? { borderTop: '1px solid var(--line)', paddingTop: 6 } : {}}
            >
              <span style={{ color: 'var(--ink-soft)' }}>ยอดสุทธิ</span>
              <span className="font-semibold">{fmt(total)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span style={{ color: 'var(--ink-soft)' }}>ชำระแล้ว</span>
              <span className="font-semibold">{fmt(paid)}</span>
            </div>
            <div
              className="flex justify-between text-sm pt-1"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <span style={{ color: 'var(--ink-soft)' }}>คงเหลือ</span>
              <span
                className="font-semibold"
                style={{ color: total - paid <= 0 ? '#4C7A3E' : '#B23A48' }}
              >
                {total - paid <= 0 ? 'ชำระครบแล้ว' : fmt(total - paid)}
              </span>
            </div>
          </div>
          <div className="mb-5">
            <p className="text-xs font-medium mb-3" style={{ color: 'var(--ink-soft)' }}>
              <i className="fa-solid fa-money-bill-wave mr-1.5"></i>การรับชำระ
            </p>
            {o.payments.map((p, idx) => (
              <div
                key={idx}
                className="rounded-xl p-2.5 mb-2.5"
                style={{ border: '1px solid var(--line)' }}
              >
                <div className="flex gap-2 mb-2">
                  <input
                    type="number"
                    placeholder="จำนวนเงิน"
                    value={p.amount}
                    onChange={(e) => updatePayment(idx, 'amount', e.target.value)}
                    className="field text-xs px-2.5 py-1.5 w-28"
                  />
                  <div className="flex-1">
                    <ManagedDropdown
                      value={p.method}
                      onChange={(v) => updatePayment(idx, 'method', v)}
                      options={methods}
                      setOptions={setMethods}
                      placeholder="เลือกวิธีชำระ..."
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-xs flex items-center gap-1.5 flex-1 field px-2.5 py-1.5 cursor-pointer"
                    style={{ color: 'var(--ink-soft)' }}
                  >
                    <i className="fa-solid fa-paperclip"></i>
                    แนบหลักฐานการชำระเงิน (เลือกได้หลายไฟล์)...
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length)
                          updatePayment(idx, 'attachments', [
                            ...(p.attachments || []),
                            ...files.map((f) => f.name),
                          ]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {(p.attachments || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {p.attachments.map((fn, fi) => (
                        <span
                          key={fi}
                          className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
                          style={{ background: 'var(--paper)', color: '#4C7A3E' }}
                        >
                          <i className="fa-solid fa-circle-check"></i>
                          {fn}
                          <i
                            className="fa-solid fa-xmark cursor-pointer"
                            style={{ color: '#B23A48' }}
                            onClick={() =>
                              updatePayment(
                                idx,
                                'attachments',
                                p.attachments.filter((_, fi2) => fi2 !== fi),
                              )
                            }
                          ></i>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <button
              onClick={addPayment}
              className="btn-outline w-full text-sm rounded-2xl py-2 flex items-center justify-center gap-2 font-medium"
            >
              <i className="fa-solid fa-plus"></i>เพิ่มรายการรับเงิน
            </button>
          </div>
          <div className="rounded-2xl p-4 mb-5" style={{ border: '1px solid var(--line)' }}>
            <p className="text-xs font-medium mb-3" style={{ color: 'var(--ink-soft)' }}>
              <i className="fa-solid fa-file-invoice mr-1.5"></i>ออกเอกสาร
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => canInvoice && doPrint('invoice')}
                disabled={!canInvoice}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background: canInvoice ? 'var(--primary)' : 'var(--line)',
                  color: canInvoice ? '#fff' : 'var(--ink-faint)',
                  cursor: canInvoice ? 'pointer' : 'not-allowed',
                }}
              >
                <i className="fa-solid fa-file-lines"></i>ใบแจ้งหนี้
              </button>
              <button
                onClick={() => canReceipt && doPrint('receipt')}
                disabled={!canReceipt}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background: canReceipt ? 'var(--primary)' : 'var(--line)',
                  color: canReceipt ? '#fff' : 'var(--ink-faint)',
                  cursor: canReceipt ? 'pointer' : 'not-allowed',
                }}
              >
                <i className="fa-solid fa-receipt"></i>ใบเสร็จรับเงิน
              </button>
            </div>
            {!canInvoice && (
              <p className="text-xs mt-2" style={{ color: 'var(--ink-faint)' }}>
                ต้องบันทึก PO ก่อนจึงจะออกใบแจ้งหนี้ได้
              </p>
            )}
            {!canReceipt && (
              <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>
                ต้องมีการรับชำระเงินก่อนจึงจะออกใบเสร็จรับเงินได้
              </p>
            )}
          </div>
          {total - paid > 0 && can('wholesale.badDebt') && (
            <button
              onClick={markBadDebt}
              className="w-full mb-3 text-xs py-2 rounded-xl font-medium"
              style={{ color: '#B23A48', border: '1px solid #C24B57' }}
            >
              <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>แจ้งตัดเป็นหนี้สูญ
              (ต้องผู้บริหารอนุมัติ)
            </button>
          )}
          <div className="flex gap-3">
            <button
              onClick={goBack}
              className="btn-outline flex-1 rounded-2xl py-3 text-sm font-medium"
            >
              ยกเลิก
            </button>
            <button
              onClick={save}
              className="btn-primary flex-1 rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-floppy-disk"></i>บันทึก PO
            </button>
          </div>
        </div>
        {mounted &&
          (printMode === 'invoice' || printMode === 'receipt') &&
          createPortal(
            <div className="print-area">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 16,
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>
                    {shopInfo?.[o.shop]?.companyName || shopName(o.shop, shops)}
                  </h2>
                  {shopInfo?.[o.shop]?.companyName && (
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: '#333' }}>
                      {shopName(o.shop, shops)}
                    </p>
                  )}
                  {(shopInfo?.[o.shop]?.address || shopInfo?.[o.shop]?.phone) && (
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: '#555', maxWidth: 280 }}>
                      {shopInfo?.[o.shop]?.address}
                      {shopInfo?.[o.shop]?.phone ? ` โทร ${shopInfo[o.shop].phone}` : ''}
                    </p>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: 12 }}>
                    เลขที่เอกสาร {printMode === 'invoice' ? 'INV' : 'RCT'}-{o.id.replace('WS-', '')}
                  </p>
                  <h3 style={{ margin: '4px 0 0' }}>
                    {printMode === 'invoice' ? 'ใบแจ้งหนี้' : 'ใบเสร็จรับเงิน'}
                  </h3>
                  <p style={{ fontSize: 12, margin: '2px 0 0' }}>
                    วันที่{' '}
                    {new Date().toLocaleDateString('th-TH', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              </div>
              <table style={{ marginBottom: 12 }}>
                <tbody>
                  <tr>
                    <th style={{ width: '1%', whiteSpace: 'nowrap' }}>ลูกค้า</th>
                    <td>{customerName(o.customerId, customers)}</td>
                  </tr>
                  {customers.find((c) => c.id === o.customerId)?.address && (
                    <tr>
                      <th style={{ width: '1%', whiteSpace: 'nowrap' }}>ที่อยู่</th>
                      <td>{customers.find((c) => c.id === o.customerId)?.address}</td>
                    </tr>
                  )}
                  <tr>
                    <th style={{ width: '1%', whiteSpace: 'nowrap' }}>เลขที่ PO</th>
                    <td>{o.id}</td>
                  </tr>
                </tbody>
              </table>
              <table style={{ marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th>รายการ</th>
                    <th style={{ width: 60, textAlign: 'right' }}>จำนวน</th>
                    <th style={{ width: 90, textAlign: 'right' }}>ราคา/หน่วย</th>
                    <th style={{ width: 110, textAlign: 'right' }}>จำนวนเงิน</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((it, idx) => (
                    <tr key={idx}>
                      <td>{it.name}</td>
                      <td style={{ textAlign: 'right' }}>{it.qty}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(it.requestedPrice)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(it.qty * it.requestedPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {o.returns.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: '#B23A48',
                    marginBottom: 4,
                  }}
                >
                  <span>หัก การคืนสินค้า</span>
                  <span>-{fmt(returnsTotal)}</span>
                </div>
              )}
              {o.adjustments.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: adjustmentsTotal >= 0 ? '#B23A48' : '#4C7A3E',
                    marginBottom: 8,
                  }}
                >
                  <span>ปรับราคา</span>
                  <span>
                    {adjustmentsTotal >= 0 ? '-' : '+'}
                    {fmt(Math.abs(adjustmentsTotal))}
                  </span>
                </div>
              )}
              <table style={{ marginBottom: 12 }}>
                <tbody>
                  <tr>
                    <th style={{ fontWeight: 'bold' }}>ยอดรวมสุทธิ</th>
                    <td style={{ width: 110, fontWeight: 'bold', textAlign: 'right' }}>
                      {fmt(total)}
                    </td>
                  </tr>
                  {printMode === 'invoice' && paid > 0 && (
                    <>
                      <tr>
                        <th>ชำระแล้ว</th>
                        <td style={{ width: 110, textAlign: 'right' }}>-{fmt(paid)}</td>
                      </tr>
                      <tr>
                        <th style={{ fontWeight: 'bold' }}>คงเหลือที่ต้องชำระ</th>
                        <td style={{ width: 110, fontWeight: 'bold', textAlign: 'right' }}>
                          {fmt(total - paid)}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
              <p
                style={{
                  textAlign: 'right',
                  fontStyle: 'italic',
                  margin: '0 0 16px',
                  fontSize: 12,
                }}
              >
                ({' '}
                {printMode === 'invoice'
                  ? thaiBahtText(paid > 0 ? total - paid : total)
                  : thaiBahtText(paid)}{' '}
                )
              </p>
              {printMode === 'receipt' && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                    รายละเอียดการรับชำระเงิน
                  </p>
                  <table style={{ fontSize: 11 }}>
                    <tbody>
                      {o.payments.map((p, idx) => (
                        <tr key={idx}>
                          <td style={{ padding: '3px 6px' }}>
                            {p.date || '-'} &middot; {p.method}
                          </td>
                          <td style={{ width: 110, textAlign: 'right', padding: '3px 6px' }}>
                            {fmt(p.amount)}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <th style={{ padding: '3px 6px' }}>รวมรับชำระ</th>
                        <td
                          style={{
                            width: 110,
                            fontWeight: 'bold',
                            textAlign: 'right',
                            padding: '3px 6px',
                          }}
                        >
                          {fmt(paid)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {printMode === 'invoice' &&
                (shopInfo?.[o.shop]?.paymentChannels || []).filter(Boolean).length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                      ช่องทางการชำระเงิน
                    </p>
                    <ul style={{ fontSize: 11, margin: 0, paddingLeft: 16 }}>
                      {shopInfo[o.shop].paymentChannels!.filter(Boolean).map((pc, idx) => (
                        <li key={idx}>{pc}</li>
                      ))}
                    </ul>
                  </div>
                )}
              <div
                style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 44, fontSize: 12 }}
              >
                <span>
                  ลงชื่อ.....................{' '}
                  {printMode === 'invoice' ? 'ผู้ออกเอกสาร' : 'ผู้รับเงิน'}
                </span>
              </div>
            </div>,
            document.body,
          )}
      </div>
    </OptionManageProvider>
  );
}
