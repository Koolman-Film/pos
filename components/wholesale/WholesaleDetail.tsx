'use client';

import { useState } from 'react';
import { ThaiDateInput } from '@/components/ui/ThaiDateInput';
import { createPortal } from 'react-dom';

import { ManagedDropdown } from '@/components/ui/ManagedDropdown';
import { ProductPicker, type ProductOption } from '@/components/ui/ProductPicker';
import { OptionManageProvider } from '@/components/ui/optionManage';
import { fmt, fmtThaiDateLong, fmtThaiDayString, thaiBahtText } from '@/lib/domain/format';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { confirmDiscardIfDirty, useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import {
  orderTotal,
  orderPaid,
  orderReported,
  PAYMENT_BOUNCED,
  PAYMENT_RECEIVED,
  PAYMENT_REPORTED,
} from '@/lib/domain/orders';
import { dateInputValue } from '@/lib/domain/now';

import { CustomerPicker } from './CustomerPicker';
import {
  customerName,
  customerPurchasedProducts,
  shopName,
  DEFAULT_WS_STATUS,
  DEFAULT_PAYMENT_METHODS,
  type Shop,
  type SalesPerson,
  type WsCustomer,
  type WsOrder,
  type WsPayment,
  type WsShopInfo,
  type WsStatusMap,
  type WsPrintMode,
  type WsStockItem,
} from './types';

/**
 * คีย์ประจำรายการรับชำระ.
 *
 * `save_order_children` deletes and re-inserts every child row on each save,
 * so the database id is not stable and a confirmation cannot be keyed on it.
 * This is: generated once when the row is added and carried through every
 * later save. `crypto.randomUUID` is not in every browser this shop runs
 * (nor in jsdom), and uniqueness within one PO is all that is asked of it.
 */
/*
  แผงรายการสินค้า และแผงการคืนสินค้า.

  These two are where a PO is actually built, and on a long form they read as
  two more headings among six. A tinted panel with a coloured spine lifts each
  one off the page, and the two colours differ so the eye can tell "สินค้าที่
  ขายไป" from "ของที่รับคืนมา" without reading either heading.

  Colours picked from the ones this screen has NOT already spent on meaning:
  red is a discount awaiting approval or a debt, amber is money reported but
  not confirmed, green is money received. Blue and violet are free, so neither
  panel accidentally reads as a warning.

  Both live in `globals.css` with a dark-mode pair: the light hues measure
  under 3:1 on the dark ground, and a 7% tint on it is invisible.
*/
const PANEL = {
  items: { spine: 'var(--panel-goods)', tint: 'var(--panel-goods-soft)' },
  returns: { spine: 'var(--panel-return)', tint: 'var(--panel-return-soft)' },
} as const;

/** The shared shape: a tinted box with a thicker spine down its left edge. */
const panelStyle = (p: { spine: string; tint: string }): React.CSSProperties => ({
  background: p.tint,
  border: '1px solid var(--line)',
  borderLeft: `3px solid ${p.spine}`,
});

function newPaymentUid(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

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
/** ขายส่งออกสี่ใบนี้ ไม่มีใบกำกับภาษี — ยืนยันกับร้านแล้ว. */
const DOCS: {
  key: Exclude<WsPrintMode, null>;
  label: string;
  icon: string;
  /** Why the button is off, shown only while it is. */
  blocked: string;
}[] = [
  {
    key: 'invoice',
    label: 'ใบแจ้งหนี้',
    icon: 'fa-file-lines',
    blocked: 'ต้องบันทึก PO ก่อนจึงจะออกใบแจ้งหนี้ได้',
  },
  {
    key: 'delivery',
    label: 'ใบส่งของ',
    icon: 'fa-truck-fast',
    blocked: 'ต้องมีรายการสินค้าก่อนจึงจะออกใบส่งของได้',
  },
  {
    key: 'ret',
    label: 'ใบรับคืนสินค้า',
    icon: 'fa-rotate-left',
    blocked: 'ต้องบันทึกการคืนสินค้าก่อนจึงจะออกใบรับคืนได้',
  },
  {
    key: 'receipt',
    label: 'ใบเสร็จรับเงิน',
    icon: 'fa-receipt',
    blocked: 'ต้องมีการรับชำระเงินก่อนจึงจะออกใบเสร็จรับเงินได้',
  },
];

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
  salesPeople = [],
  isNew = false,
  onSaveOrder,
  onApprovePrice,
  onRejectPrice,
  onMarkBadDebt,
  onDeleteOrder,
  onRecordDelivery,
  onConfirmPayment,
  onBouncePayment,
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
  /** พนักงานขายของทุกสาขาที่ผู้ใช้เข้าถึงได้ — filtered to `o.shop` in the picker. */
  salesPeople?: SalesPerson[];
  isNew?: boolean;
  onBack?: () => void;
  onSaveOrder?: (order: WsOrder, isNew: boolean) => Promise<void> | void;
  onApprovePrice?: (orderId: string) => Promise<void> | void;
  onRejectPrice?: (orderId: string) => Promise<void> | void;
  onMarkBadDebt?: (orderId: string) => Promise<void> | void;
  /** ลบ PO — gated by `wholesale.delete`. Absent in the bare unit test. */
  onDeleteOrder?: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * บันทึกวันส่งของ — called when ใบส่งของ is issued for the first time.
   *
   * Separate from `onSaveOrder` because it is not an edit the user typed: it
   * is the consequence of issuing the document, and it must land even if the
   * PO has no other unsaved changes.
   */
  onRecordDelivery?: (
    orderId: string,
    deliveredAt: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * ยืนยันว่าเงินเข้าจริง — gated by `wholesale.confirmPayment` (migration 0048).
   *
   * Not part of `onSaveOrder`: a sale may edit and save this PO all day, and
   * none of those saves may turn a cheque in the drawer into money. The
   * database refuses it too — the save function copies the confirmed state
   * forward and ignores whatever the browser claims about it.
   */
  onConfirmPayment?: (
    orderId: string,
    uid: string,
    clearedOn: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** บันทึกเช็คเด้ง — same capability; the debt returns on its own. */
  onBouncePayment?: (
    orderId: string,
    uid: string,
    bouncedOn: string,
    note: string,
  ) => Promise<{ ok: boolean; error?: string }>;
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
  /*
    เอกสารขายส่ง สี่ใบ.

    ขายส่งไม่ออกใบกำกับภาษี — ใบแจ้งหนี้ ใบส่งของ ใบรับคืนสินค้า ใบเสร็จรับเงิน
    เท่านั้น. Two of them are also the accounting events: issuing a ใบส่งของ IS
    the delivery, which is when a wholesale sale is earned, and a ใบรับคืนสินค้า
    IS the return.
  */
  const [printMode, setPrintMode] = useState<WsPrintMode>(null);

  const isDirty = JSON.stringify(o) !== JSON.stringify(order);
  useUnsavedChangesGuard(isDirty, 'มีข้อมูลใน PO นี้ที่ยังไม่ได้บันทึก');

  function doPrint(mode: Exclude<WsPrintMode, null>) {
    setPrintMode(mode);
    setTimeout(() => window.print(), 50);
  }

  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * ลบ PO — into ถังขยะ, not gone. The PO keeps its number so it cannot be
   * handed out twice, and the goods it took go back on the shelf.
   *
   * The unsaved-changes guard is cleared first: leaving the page would
   * otherwise ask whether to discard edits to a PO that no longer exists.
   */
  async function deleteOrder() {
    if (!onDeleteOrder) return;
    const paid = orderPaid(o);
    if (
      !window.confirm(
        `ลบ ${o.id}?` +
          '\n\nPO จะถูกย้ายไปถังขยะ ไม่แสดงในรายการและไม่ถูกนับในยอดขายอีก ' +
          'สินค้าที่ตัดสต็อกไปแล้วจะถูกคืนเข้าสต็อก แอดมินกู้คืนได้ภายหลัง' +
          (paid > 0 ? `\n\nPO นี้มีการรับเงินแล้ว ${fmt(paid)} บาท` : ''),
      )
    ) {
      return;
    }
    setDeleteError(null);
    try {
      const res = await onDeleteOrder(o.id);
      if (!res?.ok) {
        setDeleteError(res?.error || 'ลบ PO ไม่สำเร็จ');
        return;
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'ลบ PO ไม่สำเร็จ');
      return;
    }
    // Router-free, like goBack: this component is unit tested rendered bare.
    window.__hasUnsavedFormChanges = false;
    if (onBack) onBack();
    else if (typeof window !== 'undefined') window.location.assign('/wholesale');
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

  /**
   * Moving a new PO to another branch also moves which shelf it sells from.
   *
   * A product the new branch does not carry cannot be deducted from its stock
   * — the save would go through and the goods would never leave any shelf — so
   * those lines give up their product and keep their quantity, ready to be
   * pointed at the new branch’s equivalent. Lines the new branch does carry
   * are repriced to ITS price, because that is the price being sold at.
   */
  function changeShop(shopId: string) {
    const items = o.items.map((it) => {
      const match = stock.find((sk) => sk.shop === shopId && sk.name === it.name);
      if (!it.name) return it;
      if (!match) return { ...it, name: '', listPrice: 0, requestedPrice: 0 };
      return { ...it, listPrice: match.sellPrice, requestedPrice: match.sellPrice };
    });
    setO({ ...o, shop: shopId, items });
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
  /*
    สินค้าที่สาขานี้ขายได้ ในรูปแบบที่ค้นหาได้.

    Same `ProductPicker` the ใบงาน form uses, for the same reason: a shop
    carrying 135+ products whose names share long prefixes cannot be scrolled
    through, and staff know the short name ("3M CRM 35") rather than the full
    one. Typing beats scrolling, and the picker still opens as a list when
    nothing is typed — so the old way of working is untouched.
  */
  const productOptions: ProductOption[] = stock
    .filter((st) => st.shop === o.shop)
    .map((st) => ({
      id: st.id,
      name: st.name,
      shortName: st.shortName,
      note: `คงเหลือ ${st.qty}`,
    }));

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
      returns: [
        ...o.returns,
        // Dated today by default. A return typed with no date at all used to
        // be stamped with whenever the PO was next saved, which could be weeks
        // later and in the wrong month.
        { item: purchasedProducts[0] || '', qty: 1, reason: '', date: dateInputValue(new Date()) },
      ],
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
      payments: [
        ...o.payments,
        {
          amount: 0,
          method: 'เงินสด',
          date: dateInputValue(new Date()),
          uid: newPaymentUid(),
          status: PAYMENT_REPORTED,
          attachments: [],
        },
      ],
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

  /*
    การยืนยันเงินเข้า.

    `savedPaymentUids` comes from the PROP, not from the draft: a payment
    typed a moment ago exists only in this browser, and asking the server to
    confirm a row it has never seen fails with an error the user cannot act
    on. Saving first is the honest instruction, so that is what the row says.
  */
  const savedPaymentUids = new Set(
    order.payments.map((p) => p.uid).filter((u): u is string => !!u),
  );
  const canConfirmPayments = can('wholesale.confirmPayment');
  const [payPanel, setPayPanel] = useState<{
    idx: number;
    mode: 'confirm' | 'bounce';
    on: string;
    note: string;
  } | null>(null);
  const [payError, setPayError] = useState('');

  function openPayPanel(idx: number, mode: 'confirm' | 'bounce') {
    setPayError('');
    setPayPanel({ idx, mode, on: dateInputValue(new Date()), note: '' });
  }

  async function submitPayPanel() {
    if (!payPanel) return;
    const p = o.payments[payPanel.idx];
    const uid = p?.uid ?? '';
    const res =
      payPanel.mode === 'confirm'
        ? await onConfirmPayment?.(o.id, uid, payPanel.on)
        : await onBouncePayment?.(o.id, uid, payPanel.on, payPanel.note);
    if (res && !res.ok) {
      setPayError(res.error ?? 'บันทึกไม่สำเร็จ');
      return;
    }
    // Mirrored locally so the badge and the balance move at once; the server
    // holds the authoritative row either way.
    const payments = [...o.payments];
    payments[payPanel.idx] =
      payPanel.mode === 'confirm'
        ? { ...p, status: PAYMENT_RECEIVED, clearedAt: payPanel.on, bouncedAt: '' }
        : {
            ...p,
            status: PAYMENT_BOUNCED,
            bouncedAt: payPanel.on,
            bounceNote: payPanel.note,
            clearedAt: '',
          };
    setO({ ...o, payments });
    setPayPanel(null);
  }

  const total = orderTotal(o);
  const paid = orderPaid(o);
  /** แจ้งแล้วแต่ยังไม่ยืนยัน — sits beside the balance, never inside it. */
  const reported = orderReported(o);
  /*
    ยอดบนใบเสร็จ.

    A receipt acknowledges what the customer HANDED OVER, which for wholesale
    is usually a post-dated cheque — so it is not `paid`, which counts only
    money that has arrived. A bounced payment is excluded: it was handed over
    and then failed, and printing it on a fresh receipt would acknowledge
    receiving something the shop no longer has.
  */
  const receiptPayments = o.payments.filter(
    (p) => p.status !== PAYMENT_BOUNCED && Number(p.amount || 0) > 0,
  );
  const receiptTotal = receiptPayments.reduce((n, p) => n + Number(p.amount || 0), 0);
  const itemsTotal = o.items.reduce((s, i) => s + i.qty * i.requestedPrice, 0);
  const returnsTotal = o.returns.reduce((s, r) => {
    const it = o.items.find((i) => i.name === r.item);
    return s + (it ? r.qty * it.requestedPrice : 0);
  }, 0);
  const adjustmentsTotal = o.adjustments.reduce((s, a) => s + Number(a.amount || 0), 0);
  const hasBreakdown = o.returns.length > 0 || o.adjustments.length > 0;
  /*
    พนักงานขายของ PO ใบนี้.

    Their phone heads the document and their name signs it, so the document
    identifies a person the customer can ring — which is the whole point of
    recording it. Looked up within the PO’s own branch: two branches may both
    have a "โหน่ง" and they are not the same person.
  */
  const branchSales = salesPeople.filter((p) => p.shop === o.shop);
  /*
    The NAME comes from the PO, not from the staff list.

    `orders.sales_by` is what this PO was sold under, and it has to keep
    naming that person even when no `sales_people` row matches — the row may
    never have been created, or the person may have left. Looking the name up
    first meant a document quietly printed no seller at all, which is exactly
    what the shop hit: the reps existed on the POs but not in the table.
  */
  const sellerName = (o.salesBy ?? '').trim();
  // The staff row is only the phone book. Matched within the PO’s own branch:
  // two branches may both have a "โหน่ง" and they are not the same person.
  const seller = branchSales.find((p) => p.name === sellerName) ?? null;

  const canInvoice = !isNew;
  /*
    ใบเสร็จออกตอนรับเช็ค ไม่ใช่ตอนเช็คผ่าน — that is what the shop does, so the
    gate is "money was handed over", not "money has cleared". The receipt
    prints the cheque’s own number, bank and date and says it has not cleared;
    a receipt reading only "รับเงินแล้ว 50,000" against a cheque dated next
    month misleads both sides.
  */
  const canReceipt = o.payments.some((p) => Number(p.amount || 0) > 0);

  /*
    ใบส่งของ records the delivery date, which is when a wholesale sale is
    earned — the shop delivers first and is paid weeks later, so the payment
    date would put the revenue in the wrong month entirely.

    Re-issuing it does NOT move the date. A second copy is a reprint (the
    customer lost theirs); silently re-dating the sale because somebody printed
    it again would move revenue between months without anyone deciding to.
  */
  const canDeliver = !isNew && o.items.some((it) => Number(it.qty) > 0);
  const canReturn = !isNew && o.returns.length > 0;

  const docAllowed: Record<Exclude<WsPrintMode, null>, boolean> = {
    invoice: canInvoice,
    delivery: canDeliver,
    ret: canReturn,
    receipt: canReceipt,
  };

  /*
    What the sheet being printed actually IS.

    All four documents share one layout — same letterhead, same buyer block,
    same table — and differ in four things: the number prefix, the title, which
    rows it lists, and who signs it. Keeping that as data rather than four
    copies of the JSX is what stops the ใบส่งของ drifting away from the
    ใบแจ้งหนี้ the next time the shop’s address changes.
  */
  const sheetFor = (mode: Exclude<WsPrintMode, null>) => {
    const itemRows = o.items.map((it) => ({
      name: it.name,
      qty: Number(it.qty) || 0,
      unit: Number(it.requestedPrice) || 0,
    }));
    // A returned line is priced at what it was SOLD for, not at list price:
    // the credit has to undo the sale, and the sale may have been discounted.
    const returnRows = o.returns.map((r) => ({
      name: r.item,
      qty: Number(r.qty) || 0,
      unit: Number(o.items.find((it) => it.name === r.item)?.requestedPrice) || 0,
    }));

    switch (mode) {
      case 'delivery':
        return {
          prefix: 'DO',
          title: 'ใบส่งของ',
          rows: itemRows,
          // Same sheet as the ใบแจ้งหนี้, money included: the customer checks
          // the goods against the amount they are being billed, and a delivery
          // note without values makes them fetch the invoice to do it.
          showTotals: true,
          signatures: ['ผู้ส่งของ', 'ผู้รับของ'],
          dateText: fmtThaiDayString(o.deliveredAt || dateInputValue(new Date())),
          /*
            อ้างอิงใบแจ้งหนี้.

            The two dates on a wholesale sale are days or weeks apart — the PO
            is agreed, the goods follow — and the delivery note is the only
            place they meet. Printing the invoice number and the day the PO was
            opened lets the customer match this delivery to the bill they
            already have, without a phone call.
          */
          reference: `INV-${o.id.replace('WS-', '')}`,
          referenceDate: o.createdAt ?? null,
        };
      case 'ret':
        return {
          prefix: 'RTN',
          title: 'ใบรับคืนสินค้า',
          rows: returnRows,
          showTotals: false,
          signatures: ['ผู้คืนสินค้า', 'ผู้รับคืน'],
          dateText: fmtThaiDayString(
            o.returns
              .map((r) => r.date)
              .filter(Boolean)
              .sort()
              .at(-1) || dateInputValue(new Date()),
          ),
          reference: null,
          referenceDate: null,
        };
      case 'receipt':
        return {
          prefix: 'RCT',
          title: 'ใบเสร็จรับเงิน',
          rows: itemRows,
          showTotals: true,
          signatures: ['ผู้รับเงิน'],
          dateText: fmtThaiDateLong(new Date()),
          reference: null,
          referenceDate: null,
        };
      default:
        return {
          prefix: 'INV',
          title: 'ใบแจ้งหนี้',
          rows: itemRows,
          showTotals: true,
          signatures: ['ผู้ออกเอกสาร'],
          dateText: fmtThaiDateLong(new Date()),
          reference: null,
          referenceDate: null,
        };
    }
  };
  const sheet = sheetFor(printMode ?? 'invoice');

  async function issueDocument(mode: Exclude<WsPrintMode, null>) {
    if (mode === 'delivery' && !o.deliveredAt && onRecordDelivery) {
      const on = dateInputValue(new Date());
      const res = await onRecordDelivery(o.id, on);
      if (res?.ok) setO({ ...o, deliveredAt: on });
    }
    doPrint(mode);
  }
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
                onChange={(e) => changeShop(e.target.value)}
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
            {/* Only where the branch has a sales team. Most branches sell
                wholesale through whoever is on the counter, and an empty picker
                asking for a name nobody has is a field that gets ignored. */}
            {branchSales.length > 0 && (
              <div className="mt-2">
                <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  พนักงานขาย
                </label>
                <select
                  aria-label="พนักงานขายของ PO นี้"
                  value={o.salesBy ?? ''}
                  onChange={(e) => field('salesBy', e.target.value)}
                  className="field w-full text-sm px-3 py-2"
                >
                  <option value="">ยังไม่ระบุ</option>
                  {branchSales.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                      {p.phone ? ` · ${p.phone}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="mb-5 rounded-2xl p-3.5" style={panelStyle(PANEL.items)}>
            <p className="text-xs font-semibold mb-3" style={{ color: PANEL.items.spine }}>
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
                <div className="mb-2">
                  <ProductPicker
                    value={it.name}
                    label="สินค้าในรายการ"
                    placeholder="เลือกสินค้า... หรือพิมพ์ชื่อ/ชื่อย่อเพื่อค้นหา"
                    options={
                      // A product the branch no longer stocks still has to show
                      // on the PO that sold it, or editing an old PO would
                      // silently blank the line.
                      it.name && !productOptions.some((p) => p.name === it.name)
                        ? [...productOptions, { id: `kept-${idx}`, name: it.name, muted: true }]
                        : productOptions
                    }
                    className="field text-sm px-3 py-2 w-full font-medium"
                    onChange={(name) => selectProduct(idx, name)}
                  />
                </div>
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
          <div className="mb-5 rounded-2xl p-3.5" style={panelStyle(PANEL.returns)}>
            <p className="text-xs font-semibold mb-3" style={{ color: PANEL.returns.spine }}>
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
                {/* The date the return reduces revenue on — see migration 0045. */}
                <ThaiDateInput
                  value={r.date || ''}
                  onChange={(v) => updateReturn(idx, 'date', v)}
                  ariaLabel={`วันที่รับคืนรายการที่ ${idx + 1}`}
                  className="field text-xs px-2.5 py-1.5"
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
            {/* A customer who has handed over a cheque is in a different
                position from one who has sent nothing — but neither has paid,
                so this figure sits outside the arithmetic. */}
            {reported > 0 && (
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: 'var(--ink-soft)' }}>
                  <i className="fa-regular fa-clock mr-1"></i>แจ้งแล้ว รอยืนยัน
                </span>
                <span className="font-semibold" style={{ color: '#B8860B' }}>
                  {fmt(reported)}
                </span>
              </div>
            )}
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
              <PaymentRow
                key={idx}
                p={p}
                idx={idx}
                methods={methods}
                setMethods={setMethods}
                onChange={updatePayment}
                saved={savedPaymentUids.has(p.uid ?? '')}
                canConfirm={canConfirmPayments}
                panel={payPanel?.idx === idx ? payPanel : null}
                onOpenPanel={openPayPanel}
                onPanelChange={(patch) => setPayPanel(payPanel && { ...payPanel, ...patch })}
                onSubmitPanel={submitPayPanel}
                onCancelPanel={() => setPayPanel(null)}
                error={payPanel?.idx === idx ? payError : ''}
              />
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
            <div className="grid grid-cols-2 gap-2">
              {DOCS.map((d) => {
                const allowed = docAllowed[d.key];
                return (
                  <button
                    key={d.key}
                    onClick={() => allowed && issueDocument(d.key)}
                    disabled={!allowed}
                    className="rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                    style={{
                      background: allowed ? 'var(--primary)' : 'var(--line)',
                      color: allowed ? '#fff' : 'var(--ink-faint)',
                      cursor: allowed ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <i className={`fa-solid ${d.icon}`}></i>
                    {d.label}
                  </button>
                );
              })}
            </div>
            {DOCS.filter((d) => !docAllowed[d.key]).map((d) => (
              <p key={d.key} className="text-xs mt-1.5" style={{ color: 'var(--ink-faint)' }}>
                {d.blocked}
              </p>
            ))}
            {/* The one document that changes the books as well as printing. */}
            {o.deliveredAt && (
              <p className="text-xs mt-2 font-medium" style={{ color: '#3F6B33' }}>
                <i className="fa-solid fa-truck-fast mr-1.5"></i>
                ส่งของแล้วเมื่อ {fmtThaiDayString(o.deliveredAt)} — นับเป็นยอดขายของวันนี้
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
          {/*
            ลบ PO. Only on a saved PO — there is nothing to delete while it is
            still a draft, and ยกเลิก below already throws a draft away. Sits
            apart from ยกเลิก/บันทึก so the two cannot be confused at a glance.
          */}
          {!isNew && can('wholesale.delete') && onDeleteOrder && (
            <button
              onClick={deleteOrder}
              className="w-full mb-3 text-xs py-2 rounded-xl font-medium"
              style={{ color: '#B23A48', border: '1px solid #C24B57' }}
            >
              <i className="fa-solid fa-trash-can mr-1.5"></i>ลบ PO นี้
            </button>
          )}
          {deleteError && (
            <p className="text-xs mb-3 text-center" style={{ color: '#B23A48' }}>
              {deleteError}
            </p>
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
          printMode &&
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
                  {/*
                    ชื่อร้าน และชื่อพนักงานขาย เท่านั้น — ไม่มีที่อยู่.

                    เอกสารขายส่งทั้งสี่ใบใช้หัวเดียวกัน. A wholesale buyer rings
                    the person who sold to them; the address on a wholesale
                    document is noise that buries the one line they want, and
                    for a wholesale-only branch it is not even a place anyone
                    visits. The phone is appended when the rep has one on
                    record — the NAME prints either way.
                  */}
                  {sellerName ? (
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#333' }}>
                      {sellerName}
                      {seller?.phone ? ` โทร ${seller.phone}` : ''}
                    </p>
                  ) : (
                    shopInfo?.[o.shop]?.phone && (
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#333' }}>
                        โทร {shopInfo[o.shop].phone}
                      </p>
                    )
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: 12 }}>
                    เลขที่เอกสาร {sheet.prefix}-{o.id.replace('WS-', '')}
                  </p>
                  <h3 style={{ margin: '4px 0 0' }}>{sheet.title}</h3>
                  {/* The document's OWN date. A ใบส่งของ reprinted next month still
                      says the day the goods went out, because that is the day the
                      sale was earned. */}
                  <p style={{ fontSize: 12, margin: '2px 0 0' }}>วันที่ {sheet.dateText}</p>
                  {sheet.reference && (
                    <p style={{ fontSize: 11, margin: '2px 0 0', color: '#555' }}>
                      อ้างอิง {sheet.reference}
                      {sheet.referenceDate
                        ? ` · เปิด PO ${fmtThaiDayString(sheet.referenceDate.slice(0, 10))}`
                        : ''}
                    </p>
                  )}
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
                  {sheet.rows.map((r, idx) => (
                    <tr key={idx}>
                      <td>{r.name}</td>
                      <td style={{ textAlign: 'right' }}>{r.qty}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.unit)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.qty * r.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sheet.showTotals && o.returns.length > 0 && (
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
              {sheet.showTotals && o.adjustments.length > 0 && (
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
                  : thaiBahtText(receiptTotal)}{' '}
                )
              </p>
              {printMode === 'receipt' && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                    รายละเอียดการรับชำระเงิน
                  </p>
                  <table style={{ fontSize: 11 }}>
                    <tbody>
                      {receiptPayments.map((p, idx) => (
                        <tr key={idx}>
                          <td style={{ padding: '3px 6px' }}>
                            {p.date ? fmtThaiDayString(p.date) : '-'} &middot; {p.method}
                            {/* เลขที่เช็ค ธนาคาร และวันที่หน้าเช็ค.

                                A receipt that says only "รับเงินแล้ว 50,000"
                                against a cheque dated next month is read by
                                each side as meaning something different. These
                                three facts are what make it one document. */}
                            {p.chequeNo || p.chequeBank || p.chequeDate ? (
                              <span style={{ color: '#666' }}>
                                {' '}
                                (เช็ค {p.chequeNo || '-'}
                                {p.chequeBank ? ` ${p.chequeBank}` : ''}
                                {p.chequeDate ? ` ลงวันที่ ${fmtThaiDayString(p.chequeDate)}` : ''})
                              </span>
                            ) : null}
                            {p.status === PAYMENT_REPORTED && (
                              <span style={{ color: '#666' }}> — ยังไม่ได้ขึ้นเงิน</span>
                            )}
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
                          {fmt(receiptTotal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {receiptPayments.some((p) => p.status === PAYMENT_REPORTED) && (
                    <p style={{ fontSize: 11, color: '#666', margin: '6px 0 0' }}>
                      * ใบเสร็จนี้ออกตามเอกสารการชำระที่ได้รับ
                      หนี้จะถูกตัดเมื่อเช็คขึ้นเงินเรียบร้อยแล้ว
                    </p>
                  )}
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
                  {/* ใบส่งของ and ใบรับคืนสินค้า need BOTH hands on them: one
                      side says the goods left, the other says they arrived, and
                      a delivery note with only the sender's name settles no
                      argument about a short delivery. */}
                  {sheet.signatures.map((who, i) => (
                    <span key={who} style={{ marginLeft: 28 }}>
                      {/* The issuer’s line is filled in: the PO already records
                          who sold it, and making them write their own name on
                          every copy is asking for a fact the system has. The
                          customer’s side stays blank — that signature is the
                          point of the document. */}
                      {i === 0 && sellerName && who !== 'ผู้รับของ' && who !== 'ผู้คืนสินค้า' ? (
                        <>
                          ลงชื่อ {sellerName} {who}
                        </>
                      ) : (
                        <>ลงชื่อ..................... {who}</>
                      )}
                    </span>
                  ))}
                </span>
              </div>
            </div>,
            document.body,
          )}
      </div>
    </OptionManageProvider>
  );
}

/**
  รายการรับชำระหนึ่งรายการ.

  Its own component because a payment stopped being one number on one date:
  it now carries a cheque, a status, and two more dates that arrive weeks
  apart. Inlined in the map it buried the rest of the panel.

  The confirm and bounce controls appear only for someone holding
  `wholesale.confirmPayment`, and only once the row has been saved — the
  server cannot confirm a row it has never seen, and "บันทึก PO ก่อน" is a
  more useful thing to read than the error that would otherwise come back.
  Hiding them is a convenience, not the gate: `confirm_order_payment` checks
  the capability itself.
 */
function PaymentRow({
  p,
  idx,
  methods,
  setMethods,
  onChange,
  saved,
  canConfirm,
  panel,
  onOpenPanel,
  onPanelChange,
  onSubmitPanel,
  onCancelPanel,
  error,
}: {
  p: WsPayment;
  idx: number;
  methods: string[];
  setMethods: (next: string[]) => void;
  onChange: (idx: number, k: keyof WsPayment, v: string | number | string[]) => void;
  saved: boolean;
  canConfirm: boolean;
  panel: { mode: 'confirm' | 'bounce'; on: string; note: string } | null;
  onOpenPanel: (idx: number, mode: 'confirm' | 'bounce') => void;
  onPanelChange: (patch: { on?: string; note?: string }) => void;
  onSubmitPanel: () => void;
  onCancelPanel: () => void;
  error: string;
}) {
  const st = p.status || PAYMENT_RECEIVED;
  const received = st === PAYMENT_RECEIVED;
  const bounced = st === PAYMENT_BOUNCED;
  /*
    เช็คหรือไม่ ดูจากชื่อวิธีชำระ.

    วิธีชำระเงิน is an admin-managed free-text list — "เช็คธนาคารกสิกร",
    "เช็ค 30 วัน" — so there is no id to key on, and no reason to stop the shop
    adding another wording. The cheque fields simply appear when the word does.
  */
  const isCheque = (p.method || '').includes('เช็ค');

  return (
    <div
      className="rounded-xl p-2.5 mb-2.5"
      style={{
        border: '1px solid var(--line)',
        background: received ? 'transparent' : 'var(--paper)',
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{
            background: received ? '#E7F0E3' : bounced ? '#F7E2E4' : '#FBF0D9',
            color: received ? '#4C7A3E' : bounced ? '#B23A48' : '#8A6A1F',
          }}
        >
          <i
            className={`fa-solid ${
              received ? 'fa-circle-check' : bounced ? 'fa-circle-xmark' : 'fa-clock'
            } mr-1`}
          ></i>
          {st}
        </span>
        {received && p.clearedAt && (
          <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            เงินเข้า {fmtThaiDayString(p.clearedAt)}
          </span>
        )}
        {bounced && (
          <span className="text-xs" style={{ color: '#B23A48' }}>
            เด้ง {p.bouncedAt ? fmtThaiDayString(p.bouncedAt) : ''}
            {p.bounceNote ? ` — ${p.bounceNote}` : ''}
          </span>
        )}
      </div>
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          placeholder="จำนวนเงิน"
          aria-label="จำนวนเงินที่รับ"
          value={p.amount}
          onChange={(e) => onChange(idx, 'amount', e.target.value)}
          className="field text-xs px-2.5 py-1.5 w-28"
        />
        <div className="flex-1">
          <ManagedDropdown
            value={p.method}
            onChange={(v) => onChange(idx, 'method', v)}
            options={methods}
            setOptions={setMethods}
            placeholder="เลือกวิธีชำระ..."
          />
        </div>
      </div>
      <div className="mb-2">
        <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
          วันที่รับชำระ
        </label>
        <ThaiDateInput
          ariaLabel="วันที่รับชำระ"
          value={p.date || ''}
          onChange={(v) => onChange(idx, 'date', v)}
          className="field text-xs px-2.5 py-1.5 w-full"
        />
      </div>
      {/* เลขที่เช็ค ธนาคาร และวันที่หน้าเช็ค — printed on the receipt, and what
          makes "เดือนหน้าจะมีเงินเข้าเท่าไหร่" answerable at all. */}
      {isCheque && (
        <div className="flex flex-col gap-2 mb-2">
          <div className="flex gap-2">
            <input
              placeholder="เลขที่เช็ค"
              aria-label="เลขที่เช็ค"
              value={p.chequeNo ?? ''}
              onChange={(e) => onChange(idx, 'chequeNo', e.target.value)}
              className="field text-xs px-2.5 py-1.5 flex-1"
            />
            <input
              placeholder="ธนาคาร"
              aria-label="ธนาคารของเช็ค"
              value={p.chequeBank ?? ''}
              onChange={(e) => onChange(idx, 'chequeBank', e.target.value)}
              className="field text-xs px-2.5 py-1.5 flex-1"
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              วันที่หน้าเช็ค
            </label>
            <ThaiDateInput
              ariaLabel="วันที่หน้าเช็ค"
              value={p.chequeDate ?? ''}
              onChange={(v) => onChange(idx, 'chequeDate', v)}
              className="field text-xs px-2.5 py-1.5 w-full"
            />
          </div>
        </div>
      )}
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
                onChange(idx, 'attachments', [
                  ...(p.attachments || []),
                  ...files.map((fl) => fl.name),
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
                    onChange(
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
      {canConfirm && !panel && (
        <div className="flex gap-2 mt-2.5">
          {!saved ? (
            <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              บันทึก PO ก่อน จึงจะยืนยันเงินเข้าได้
            </span>
          ) : (
            <>
              {!received && (
                <button
                  onClick={() => onOpenPanel(idx, 'confirm')}
                  className="btn-outline text-xs rounded-xl px-3 py-1.5 font-medium"
                  style={{ color: '#4C7A3E' }}
                >
                  <i className="fa-solid fa-circle-check mr-1.5"></i>ยืนยันเงินเข้า
                </button>
              )}
              {!bounced && (
                <button
                  onClick={() => onOpenPanel(idx, 'bounce')}
                  className="btn-outline text-xs rounded-xl px-3 py-1.5 font-medium"
                  style={{ color: '#B23A48' }}
                >
                  <i className="fa-solid fa-circle-xmark mr-1.5"></i>เช็คเด้ง
                </button>
              )}
            </>
          )}
        </div>
      )}
      {panel && (
        <div
          className="rounded-xl p-2.5 mt-2.5 flex flex-col gap-2"
          style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
        >
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              {panel.mode === 'confirm' ? 'วันที่เงินเข้าจริง' : 'วันที่เช็คเด้ง'}
            </label>
            <ThaiDateInput
              ariaLabel={panel.mode === 'confirm' ? 'วันที่เงินเข้าจริง' : 'วันที่เช็คเด้ง'}
              value={panel.on}
              onChange={(v) => onPanelChange({ on: v })}
              className="field text-xs px-2.5 py-1.5 w-full"
            />
          </div>
          {panel.mode === 'bounce' && (
            <input
              placeholder="เหตุผล เช่น เงินในบัญชีไม่พอ"
              aria-label="เหตุผลที่เช็คเด้ง"
              value={panel.note}
              onChange={(e) => onPanelChange({ note: e.target.value })}
              className="field text-xs px-2.5 py-1.5 w-full"
            />
          )}
          {error && (
            <p className="text-xs" style={{ color: '#B23A48' }} role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onSubmitPanel}
              className="btn-primary text-xs rounded-xl px-3 py-1.5 font-medium flex-1"
            >
              {panel.mode === 'confirm' ? 'ยืนยันว่าเงินเข้าแล้ว' : 'บันทึกว่าเช็คเด้ง'}
            </button>
            <button
              onClick={onCancelPanel}
              className="btn-outline text-xs rounded-xl px-3 py-1.5 font-medium"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
