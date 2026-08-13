'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { getStatus, type StatusConfig } from '@/components/ui/Badge';
import { OptionManageProvider } from '@/components/ui/optionManage';
import { confirmDiscardIfDirty, useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { itemNetPrice } from '@/lib/domain/tickets';
import { fitPrintPages } from '@/lib/print/fitToPage';

import { PrintJobSheet, type PrintMode } from './PrintJobSheet';
import { serializeTicket } from './serialize';
import { ExtrasSection } from './detail/ExtrasSection';
import { FormSection, SECTION_TONES } from './detail/FormSection';
import { ItemsSection } from './detail/ItemsSection';
import { NotesSection } from './detail/NotesSection';
import { PaymentsSection } from './detail/PaymentsSection';
import { TechSection } from './detail/TechSection';
import { VehicleInfoSection } from './detail/VehicleInfoSection';
import { WrapOptionsSection } from './detail/WrapOptionsSection';
import { WRAP_CATEGORY } from './wrapOptions';
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
  TicketItem,
  TicketPayment,
  TicketPosition,
  TicketSavePayload,
} from './types';

type Options = Record<OptionListName, string[]>;

export type SaveResult = { ok: boolean; error?: string; id?: string };

/**
 * The job-ticket detail / new-ticket form.
 * Ported from reference/v0.4/finnix-film.html:1310-2469, split into the source's
 * own sections under `detail/`. The prototype's local `updateTicket(t)` is
 * replaced by the `saveAction` server action (optimistic UI, inline error on
 * failure); the `Managed*` pickers' `setOptions` now persist through
 * `optionAction` while updating local state optimistically.
 */
export function TicketDetail({
  initialTicket,
  isNew,
  shops,
  statuses,
  canDo,
  currentUserName,
  initialOptions,
  initialStock,
  initialCarModels,
  initialPriceMatrix,
  filmPriceMatrix,
  initialRetailCustomers,
  initialCorporateBuyers,
  shopInfo,
  saveAction,
  optionAction,
  deleteAction,
  unlockAction,
  attachmentUrlAction,
  corporateBuyerAction,
  carModelAction,
}: {
  initialTicket: Ticket;
  isNew: boolean;
  shops: Shop[];
  statuses: StatusConfig[];
  canDo: (key: string) => boolean;
  currentUserName: string;
  initialOptions: Options;
  initialStock: StockRow[];
  initialCarModels: CarModel[];
  initialPriceMatrix: PriceMatrixRow[];
  filmPriceMatrix: FilmPriceRow[];
  initialRetailCustomers: RetailCustomer[];
  initialCorporateBuyers: CorporateBuyer[];
  shopInfo: Record<string, ShopInfo>;
  saveAction: (payload: TicketSavePayload) => Promise<SaveResult>;
  optionAction: (
    listKey: OptionListName,
    values: string[],
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Soft-delete action; omitted (or without `list.delete`) hides the button. */
  deleteAction?: (ticketId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Reopens a closed ticket; shown only to a `list.unlock` holder. */
  unlockAction?: (ticketId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Signed-URL minter for the slips and QC photos stored on this ticket. */
  attachmentUrlAction?: (path: string) => Promise<{ url?: string; error?: string }>;
  /** Persists ข้อมูลนิติบุคคล for the financial document. */
  corporateBuyerAction?: (input: {
    name: string;
    address: string;
    taxId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Persists รุ่นรถ → ยี่ห้อ/ประเภทรถ so the next ticket autofills them. */
  carModelAction?: (input: {
    model: string;
    brand: string;
    carType: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [t, setT] = useState<Ticket>(initialTicket);
  const isDirty = useMemo(
    () => JSON.stringify(t) !== JSON.stringify(initialTicket),
    [t, initialTicket],
  );
  useUnsavedChangesGuard(isDirty, 'มีข้อมูลในใบงานนี้ที่ยังไม่ได้บันทึก');

  // Admin-managed option lists — optimistic local state, persisted via optionAction.
  const [options, setOptions] = useState<Options>(initialOptions);
  function setOption(name: OptionListName, values: string[]) {
    setOptions((prev) => ({ ...prev, [name]: values }));
    void optionAction(name, values);
  }
  const opt = (name: OptionListName) => (values: string[]) => setOption(name, values);

  /*
    Registries the form edits as a side effect of doing a job. Each is optimistic
    in state AND written to its table, except where noted:

    - `stock` is a PREVIEW ONLY — see updateActualQty. The server moves stock on
      save, because only it can diff against what is stored.
    - `priceMatrix` is deliberately session-local. `commitPrice` fires on every
      keystroke in the sold-price box, so persisting it would let a one-off
      discount — or the "3" on the way to typing "3000" — become the standard
      price for that ประเภทรถ + สินค้า on every future ticket. Film prices have a
      proper editor in สต็อกสินค้า → ตั้งราคาฟิล์ม/กันรอย, which does persist.
    - `retailCustomers` is written by the ticket save itself
      (`resolveRetailCustomerId`), keyed on name + phone.
  */
  const [stock, setStock] = useState<StockRow[]>(initialStock);
  const [carModels, setCarModels] = useState<CarModel[]>(initialCarModels);
  const [priceMatrix, setPriceMatrix] = useState<PriceMatrixRow[]>(initialPriceMatrix);
  const [retailCustomers, setRetailCustomers] = useState<RetailCustomer[]>(initialRetailCustomers);
  const [corporateBuyers, setCorporateBuyers] = useState<CorporateBuyer[]>(initialCorporateBuyers);
  const [savingBuyer, setSavingBuyer] = useState(false);
  const [buyerSaveMsg, setBuyerSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Frozen record. `initialTicket.locked` rather than `t.locked` on purpose: the
  // flag is not something the form edits, and reading it from the draft would
  // let a stray field() call appear to unlock the ticket on screen.
  const locked = !isNew && !!initialTicket.locked;

  async function unlock() {
    if (!unlockAction) return;
    setSaveError(null);
    setUnlocking(true);
    const result = await unlockAction(t.id);
    setUnlocking(false);
    if (!result.ok) {
      setSaveError(result.error || 'ปลดล็อกไม่สำเร็จ');
      return;
    }
    router.refresh();
  }

  // Financial-document + print state.
  const [docType, setDocType] = useState('ใบเสร็จรับเงิน');
  const [showCompanyInfo, setShowCompanyInfo] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerTaxId, setBuyerTaxId] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [printMode, setPrintMode] = useState<PrintMode>('job');

  const productCategories = options.product_categories;
  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? id;

  /**
   * วิธีชำระเงิน comes from the shop's ช่องทางการชำระเงิน, set in จัดการสิทธิ์ →
   * ข้อมูลนิติบุคคลของสาขา — the same list that prints on its invoices. The
   * global `payment_methods` option list is the fallback for a shop that has not
   * filled its channels in yet, because a dropdown with nothing in it would make
   * recording a payment impossible.
   */
  const shopChannels = (shopInfo[t.shop]?.paymentChannels ?? []).filter(Boolean);
  const paymentMethodOptions = shopChannels.length > 0 ? shopChannels : options.payment_methods;

  function changeDocType(dt: string) {
    setDocType(dt);
    setShowCompanyInfo(dt === 'ใบกำกับภาษี/ใบเสร็จรับเงิน');
  }
  function doPrint(mode: PrintMode) {
    setPrintMode(mode);
    setTimeout(() => {
      // Shrink any page that would spill onto a second sheet, then print. The
      // 50ms is the sheet's render; the measurement has to come after it and
      // before the dialog, which is why both live here.
      fitPrintPages();
      window.print();
    }, 50);
  }

  async function save() {
    setSaveError(null);
    setSaving(true);
    const finalTicket: Ticket = t.createdBy ? t : { ...t, createdBy: currentUserName || 'ไม่ระบุ' };
    try {
      const result = await saveAction(serializeTicket(finalTicket, isNew));
      if (!result.ok) {
        setSaveError(result.error || 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
        setSaving(false);
        return;
      }
      window.__hasUnsavedFormChanges = false;
      router.push('/tickets');
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
      setSaving(false);
    }
  }

  /**
   * ลบใบงาน. Soft delete, so the confirmation says where the ticket goes rather
   * than warning that it is gone forever — an admin can pull it back out of the
   * bin. The unsaved-changes guard is cleared first, otherwise leaving the page
   * right after deleting prompts to save a ticket that no longer shows anywhere.
   */
  async function remove() {
    if (!deleteAction) return;
    if (
      !window.confirm(
        `ลบใบงาน #${t.id} ของ ${t.customer || 'ลูกค้า'}?\n\n` +
          'ใบงานจะถูกย้ายไปถังขยะ ไม่แสดงในรายการและไม่ถูกนับในแดชบอร์ดอีก ' +
          'แอดมินกู้คืนได้ภายหลัง (สต็อกที่ตัดไปแล้วจะไม่ถูกคืนอัตโนมัติ)',
      )
    )
      return;
    setSaveError(null);
    setDeleting(true);
    try {
      const result = await deleteAction(t.id);
      if (!result.ok) {
        setSaveError(result.error || 'ลบใบงานไม่สำเร็จ');
        setDeleting(false);
        return;
      }
      window.__hasUnsavedFormChanges = false;
      router.push('/tickets');
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'ลบใบงานไม่สำเร็จ');
      setDeleting(false);
    }
  }

  function field(key: keyof Ticket, value: unknown) {
    setT({ ...t, [key]: value });
  }
  /** หมายเหตุของชนิดสินค้าหนึ่ง — prints only on that category's ใบงานติดตั้ง. */
  function setCategoryNote(category: string, value: string) {
    setT({ ...t, notesByCategory: { ...(t.notesByCategory || {}), [category]: value } });
  }
  function changeStatus(newStatus: string) {
    setT({
      ...t,
      status: newStatus,
      statusHistory: [...(t.statusHistory || []), { status: newStatus, date: new Date() }],
    });
  }
  function onModelChange(v: string) {
    const match = carModels.find((m) => m.model.trim().toLowerCase() === v.trim().toLowerCase());
    if (match) setT({ ...t, model: v, brand: match.brand, carType: match.carType });
    else setT({ ...t, model: v });
  }
  /**
   * Teaches the รุ่นรถ registry so the next ticket for the same model fills in
   * ยี่ห้อ and ประเภทรถ by itself. Optimistic locally, then persisted — it used
   * to be local only, so the lesson lasted until the page reloaded.
   */
  function commitModelRegistry(brand: string, carType: string) {
    if (!t.model) return;
    setCarModels((prev) => {
      const idx = prev.findIndex(
        (m) => m.model.trim().toLowerCase() === t.model.trim().toLowerCase(),
      );
      const entry = { model: t.model, brand, carType };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [...prev, entry];
    });
    // Fire and forget: the registry is a convenience, and a failed write must
    // not interrupt someone filling in a ticket. The action ignores half-filled
    // rows rather than storing a model with no brand.
    void carModelAction?.({ model: t.model, brand, carType });
  }

  /** ข้อมูลนิติบุคคล — the button says it saves for next time, so it must. */
  async function saveBuyer() {
    const name = buyerName.trim();
    if (!name) {
      setBuyerSaveMsg({ ok: false, text: 'กรุณากรอกชื่อลูกค้าในเอกสารก่อนบันทึก' });
      return;
    }
    setCorporateBuyers((prev) => {
      const idx = prev.findIndex((x) => x.name === name);
      const entry = { name, address: buyerAddress, taxId: buyerTaxId };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [...prev, entry];
    });
    if (!corporateBuyerAction) {
      setBuyerSaveMsg({ ok: true, text: 'บันทึกไว้ในหน้านี้แล้ว' });
      return;
    }
    setSavingBuyer(true);
    const result = await corporateBuyerAction({
      name,
      address: buyerAddress,
      taxId: buyerTaxId,
    });
    setSavingBuyer(false);
    setBuyerSaveMsg(
      result.ok
        ? { ok: true, text: 'บันทึกแล้ว — ครั้งหน้าเลือกจากรายการได้เลย' }
        : { ok: false, text: result.error || 'บันทึกไม่สำเร็จ' },
    );
  }
  function lookupPrice(product: string, fallback: number) {
    const m = priceMatrix.find((p) => p.carType === t.carType && p.product === product);
    return m ? m.price : fallback;
  }
  function lookupFilmPrice(category: string, product: string, position: string, fallback: number) {
    const m = filmPriceMatrix.find(
      (p) =>
        p.category === category &&
        p.product === product &&
        p.position === position &&
        p.carType === t.carType,
    );
    return m ? m.price : fallback;
  }
  function commitPrice(product: string, price: number | string) {
    if (!t.carType || !product) return;
    setPriceMatrix((prev) => {
      const idx = prev.findIndex((p) => p.carType === t.carType && p.product === product);
      const entry = { carType: t.carType, product, price: Number(price) };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [...prev, entry];
    });
  }
  function toggleExtra(name: string) {
    const current = t.extras?.[name] || {};
    const nowChecked = !current.checked;
    let items = t.items;
    if (name === 'ประกัน') {
      if (nowChecked && !items.some((i) => i.autoInsurance)) {
        items = [
          ...items,
          {
            category: 'ประกัน',
            booked: 'ประกัน',
            bookedPrice: 0,
            sold: 'ประกัน',
            soldPrice: 0,
            autoInsurance: true,
          },
        ];
      } else if (!nowChecked) {
        items = items.filter((i) => !i.autoInsurance);
      }
    }
    setT({ ...t, items, extras: { ...t.extras, [name]: { ...current, checked: nowChecked } } });
  }
  function updateExtraDetail(name: string, key: string, val: unknown) {
    setT({ ...t, extras: { ...t.extras, [name]: { ...(t.extras?.[name] || {}), [key]: val } } });
  }
  function setSlideType(st: string) {
    const current = t.extras?.['รถสไลด์'] || {};
    const legCount = st === 'Walk-in' ? 1 : st === 'Showroom' ? 2 : 0;
    const prevLegs = (current.legs as unknown[]) || [];
    const legs = Array.from(
      { length: legCount },
      (_, i) => prevLegs[i] || { from: '', to: '', date: '', time: '' },
    );
    setT({ ...t, extras: { ...t.extras, รถสไลด์: { ...current, slideType: st, legs } } });
  }
  function updateSlideLeg(legIdx: number, key: string, val: unknown) {
    const current = t.extras?.['รถสไลด์'] || {};
    const legs = [...((current.legs as Record<string, unknown>[]) || [])];
    legs[legIdx] = { ...(legs[legIdx] || {}), [key]: val };
    setT({ ...t, extras: { ...t.extras, รถสไลด์: { ...current, legs } } });
  }
  function addItem() {
    setT({
      ...t,
      items: [...t.items, { category: '', booked: '', bookedPrice: 0, sold: '', soldPrice: 0 }],
    });
  }
  function updateItem(idx: number, key: keyof TicketItem, val: unknown) {
    const items = [...t.items];
    items[idx] = { ...items[idx], [key]: val };
    setT({ ...t, items });
  }
  function updateItemFields(idx: number, fields: Partial<TicketItem>) {
    const items = [...t.items];
    items[idx] = { ...items[idx], ...fields };
    setT({ ...t, items });
  }
  function removeItem(idx: number) {
    setT({ ...t, items: t.items.filter((_, i) => i !== idx) });
  }
  function updateFilmPositions(idx: number, positions: TicketPosition[]) {
    const items = [...t.items];
    const soldPrice = positions.reduce((s, p) => s + Number(p.price || 0), 0);
    const sold = positions.map((p) => `${p.position}: ${p.product || '?'}`).join(', ');
    items[idx] = { ...items[idx], positions, soldPrice, sold };
    const hasBuildingFilm = positions.some((p) => p.position === 'ฟิล์มอาคาร');
    const extras = hasBuildingFilm
      ? { ...t.extras, นอกสถานที่: { ...(t.extras?.['นอกสถานที่'] || {}), checked: true } }
      : t.extras;
    setT({ ...t, items, extras });
  }
  /**
   * Record how much of a product was actually used on this job item.
   *
   * The prototype decremented `stock` here, inline, on every keystroke
   * (:1409-1421). That worked because its stock array WAS the database. In the
   * port the authoritative movement happens server-side when the ticket is saved
   * (`syncTicketStock` in app/(app)/tickets/actions.ts), which is the only place
   * that can diff against what is stored and avoid two technicians racing.
   *
   * The local `setStock` below is therefore a PREVIEW only — it keeps the
   * on-screen remaining-quantity hint responsive while typing, and the server is
   * what actually moves stock. It used to be the whole mechanism, which meant
   * nothing was ever persisted.
   */
  function updateActualQty(idx: number, productName: string, newQty: string) {
    const it = t.items[idx];
    const currentMap = it.actualQtyMap || {};
    const prevQty = Number(currentMap[productName]) || 0;
    const delta = Number(newQty) - prevQty;
    if (delta !== 0 && productName) {
      setStock((prevStock) =>
        prevStock.map((s) =>
          s.name === productName && s.shop === t.shop ? { ...s, qty: s.qty - delta } : s,
        ),
      );
    }
    const items = [...t.items];
    items[idx] = { ...it, actualQtyMap: { ...currentMap, [productName]: newQty } };
    setT({ ...t, items });
  }
  function addPayment() {
    setT({
      ...t,
      payments: [
        ...t.payments,
        { type: 'มัดจำ', method: 'เงินสด', amount: 0, date: '', attachments: [] },
      ],
    });
  }
  /**
   * Remove a payment row. The form had no way to do this: a row added by
   * mistake stayed on the ticket as a 0-baht entry forever, and the only bin
   * icon on the row belonged to the payment-method dropdown (it deletes the
   * METHOD from the system-wide list, which is not what anyone wanted there).
   */
  function removePayment(idx: number) {
    setT({ ...t, payments: t.payments.filter((_, i) => i !== idx) });
  }
  function updatePayment(idx: number, key: keyof TicketPayment, val: unknown) {
    const payments = [...t.payments];
    payments[idx] = { ...payments[idx], [key]: val };
    setT({ ...t, payments });
  }
  function shareLink(link?: string) {
    if (!link) return;
    if (navigator.share)
      navigator.share({ title: 'ตำแหน่งงานนอกสถานที่', url: link }).catch(() => {});
    else if (navigator.clipboard) {
      navigator.clipboard.writeText(link);
      window.alert('คัดลอกลิงก์แล้ว');
    }
  }
  function confirmInstall() {
    setT((prev) => ({
      ...prev,
      installConfirmed: true,
      installConfirmedAt: new Date().toLocaleString('th-TH'),
    }));
  }
  function shareQcAlbum() {
    // The drive album when there is one — that is a page the customer can
    // actually open. The in-app link only resolves for someone who can sign in.
    const external = (t.qcAlbumUrl || '').trim();
    const link = /^https?:\/\/\S+$/i.test(external)
      ? external
      : `${window.location.origin}${window.location.pathname}#qc-album-${t.id}`;
    const text = `อัลบั้มรูป QC ก่อนติดตั้ง — ${t.customer || ''} (${t.plate || ''})`;
    if (navigator.share)
      navigator
        .share({ title: 'อัลบั้มรูป QC ก่อนติดตั้ง (ดูอย่างเดียว)', text, url: link })
        .catch(() => {});
    else if (navigator.clipboard) {
      navigator.clipboard.writeText(link);
      window.alert('คัดลอกลิงก์อัลบั้มรูป QC แล้ว (ลูกค้าดูได้อย่างเดียว)');
    }
  }

  const total = t.items.reduce(
    (s, i) =>
      s +
      itemNetPrice({
        soldPrice: Number(i.soldPrice || 0),
        discountType: i.discountType ?? undefined,
        discountValue:
          i.discountValue != null && i.discountValue !== '' ? Number(i.discountValue) : undefined,
      }),
    0,
  );
  const paid = t.payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <OptionManageProvider canManage={canDo('options.manage')}>
      <div className="max-w-2xl fade-page">
        <button
          onClick={() => {
            if (
              confirmDiscardIfDirty(
                isDirty,
                'มีข้อมูลในใบงานนี้ที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้โดยไม่บันทึกหรือไม่?',
              )
            )
              router.push('/tickets');
          }}
          className="text-sm mb-4 flex items-center gap-2 font-medium"
          style={{ color: 'var(--ink-soft)' }}
        >
          <i className="fa-solid fa-arrow-left"></i>กลับไปรายการใบงาน
        </button>
        <div className="card p-5 sm:p-7">
          <div className="flex items-start justify-between mb-1">
            <p
              className="text-xs font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--primary)' }}
            >
              <i className="fa-solid fa-store"></i>
              {shopName(t.shop)}
            </p>
            <select
              value={t.status}
              aria-label="สถานะใบงาน"
              onChange={(e) => changeStatus(e.target.value)}
              className="text-sm font-bold px-3 py-1.5 rounded-full border-none cursor-pointer"
              style={{
                background: getStatus(statuses, t.status).bg,
                color: getStatus(statuses, t.status).text,
              }}
            >
              {statuses.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.key}
                </option>
              ))}
            </select>
          </div>
          <p className="text-lg font-bold mb-5">{isNew ? 'สร้างใบงานใหม่' : `ใบงาน #${t.id}`}</p>

          {/*
            A closed ticket (ส่งมอบแล้ว + ชำระครบ) is what commission, revenue and
            any later dispute are read from, so it is frozen. The fields below
            stay visible — this is still the record of the job — but nothing in
            them can be changed or saved until an admin reopens it.
          */}
          {locked && (
            <div
              className="rounded-2xl p-4 mb-5"
              style={{ background: '#F1EDE7', border: '1.5px solid #B5AAA1' }}
            >
              <p className="text-sm font-semibold flex items-center gap-2">
                <i className="fa-solid fa-lock"></i>ใบงานนี้ปิดงานแล้ว — ล็อกไม่ให้แก้ไข
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>
                ส่งมอบงานและชำระเงินครบแล้ว
                ข้อมูลจึงถูกล็อกไว้เพื่อไม่ให้ยอดขายและค่าคอมมิชชั่นเปลี่ยนย้อนหลัง
                {canDo('list.unlock')
                  ? ' — กดปลดล็อกด้านล่างเพื่อแก้ไข แล้วระบบจะล็อกกลับเองเมื่อบันทึก'
                  : ' หากต้องแก้ไขกรุณาแจ้งแอดมิน'}
              </p>
              {canDo('list.unlock') && unlockAction && (
                <button
                  onClick={unlock}
                  disabled={unlocking}
                  className="btn-outline mt-3 rounded-xl px-4 py-2 text-sm font-semibold flex items-center gap-2"
                  style={{ opacity: unlocking ? 0.7 : 1 }}
                >
                  <i
                    className={`fa-solid ${unlocking ? 'fa-spinner fa-spin' : 'fa-lock-open'}`}
                  ></i>
                  {unlocking ? 'กำลังปลดล็อก...' : 'ปลดล็อกเพื่อแก้ไข'}
                </button>
              )}
            </div>
          )}

          {/*
            One guard around every editable section instead of a `disabled` on
            each of the ~40 controls inside them: the sections stay readable, the
            status dropdown above stays usable for nothing (it is covered too),
            and there is no field left behind when a new one is added.
          */}
          <div
            style={
              locked ? { pointerEvents: 'none', opacity: 0.65, userSelect: 'text' } : undefined
            }
            aria-disabled={locked || undefined}
          >
            <FormSection step={1} title="ข้อมูลงานและลูกค้า" icon="fa-car" tone={SECTION_TONES.job}>
              <VehicleInfoSection
                t={t}
                field={field}
                bookingChannels={options.booking_channels}
                setBookingChannels={opt('booking_channels')}
                serviceTypes={options.service_types}
                setServiceTypes={opt('service_types')}
                carTypes={options.car_types}
                setCarTypes={opt('car_types')}
                carBrands={options.car_brands}
                setCarBrands={opt('car_brands')}
                retailCustomers={retailCustomers}
                setRetailCustomers={setRetailCustomers}
                onSelectCustomer={(c) => setT({ ...t, customer: c.name, phone: c.phone })}
                onModelChange={onModelChange}
                commitModelRegistry={commitModelRegistry}
              />
            </FormSection>

            <FormSection
              step={2}
              title={`สินค้า/การติดตั้ง (${t.items.length})`}
              icon="fa-bag-shopping"
              tone={SECTION_TONES.items}
            >
              <ItemsSection
                t={t}
                stock={stock}
                productCategories={productCategories}
                filmPositions={options.film_positions}
                setFilmPositions={opt('film_positions')}
                wrapPositions={options.wrap_positions}
                setWrapPositions={opt('wrap_positions')}
                serviceItems={options.service_items}
                setServiceItems={opt('service_items')}
                addItem={addItem}
                removeItem={removeItem}
                updateItem={updateItem}
                updateItemFields={updateItemFields}
                updateFilmPositions={updateFilmPositions}
                lookupPrice={lookupPrice}
                lookupFilmPrice={lookupFilmPrice}
                commitPrice={commitPrice}
              />

              {/*
                These three sit BELOW the products on purpose: the wrap tick-list
                and the per-category notes only mean anything once the ชนิดสินค้า
                on the ticket are known, and a note box that appears above the
                item you just added is a box nobody scrolls back up to.
              */}
              <div className="mt-4">
                {t.items.some((i) => i.category === WRAP_CATEGORY) && (
                  <WrapOptionsSection
                    selected={t.wrapOptions ?? []}
                    onChange={(next) => field('wrapOptions', next)}
                  />
                )}

                <NotesSection
                  t={t}
                  setNote={(v) => field('notes', v)}
                  setCategoryNote={setCategoryNote}
                />

                <ExtrasSection
                  t={t}
                  extraOptions={options.extra_options}
                  setExtraOptions={opt('extra_options')}
                  slideTypes={options.slide_types}
                  stock={stock}
                  toggleExtra={toggleExtra}
                  updateExtraDetail={updateExtraDetail}
                  setSlideType={setSlideType}
                  updateSlideLeg={updateSlideLeg}
                  shareLink={shareLink}
                />
              </div>
            </FormSection>

            <FormSection
              step={3}
              title="การชำระเงิน"
              icon="fa-money-bill-wave"
              tone={SECTION_TONES.payment}
            >
              <PaymentsSection
                t={t}
                shop={t.shop}
                paymentMethods={paymentMethodOptions}
                attachmentUrlAction={attachmentUrlAction}
                addPayment={addPayment}
                removePayment={removePayment}
                updatePayment={updatePayment}
                total={total}
                paid={paid}
              />
            </FormSection>
          </div>

          {saveError && (
            <p
              className="text-sm mb-3 px-3 py-2 rounded-lg"
              style={{ background: '#FBEAEC', color: '#B23A48' }}
              role="alert"
            >
              <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
              {saveError}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/tickets')}
              className="btn-outline flex-1 rounded-2xl py-3 text-sm font-medium"
            >
              {locked ? 'กลับไปรายการใบงาน' : 'ยกเลิก'}
            </button>
            {/* Saving a locked ticket would be refused by the database anyway;
                not offering the button is the honest version of that. */}
            {!locked && (
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary flex-1 rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
                style={{ opacity: saving ? 0.7 : 1 }}
              >
                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                {saving ? 'กำลังบันทึก...' : 'บันทึกใบงาน'}
              </button>
            )}
          </div>

          {!isNew && t.items.some((i) => i.sold) && canDo('list.printSheet') && (
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => doPrint('job')}
                className="btn-outline flex-1 rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-print"></i> ใบงานติดตั้ง
              </button>
              <button
                onClick={() => doPrint('sale')}
                className="btn-outline flex-1 rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-print"></i> ใบงานขาย
              </button>
            </div>
          )}
          {!isNew &&
            t.items.some((i) => i.sold) &&
            canDo('list.printSheet') &&
            t.extras?.['นอกสถานที่']?.checked && (
              <button
                onClick={() => doPrint('offsite')}
                className="btn-outline w-full mt-3 rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-print"></i> ใบงานนอกสถานที่
              </button>
            )}
          {!isNew && !locked && canDo('list.delete') && deleteAction && (
            <button
              onClick={remove}
              disabled={deleting}
              className="btn-outline w-full mt-3 rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
              style={{ color: '#B23A48', borderColor: '#B23A48', opacity: deleting ? 0.7 : 1 }}
            >
              <i className={`fa-solid ${deleting ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i>
              {deleting ? 'กำลังลบ...' : 'ลบใบงาน'}
            </button>
          )}
          {!isNew && (
            <FormSection
              step={4}
              title="ออกเอกสารทางการเงิน"
              icon="fa-file-invoice"
              tone={SECTION_TONES.document}
            >
              <div className="flex gap-1.5 mb-2.5">
                {['ใบเสนอราคา', 'ใบกำกับภาษี/ใบเสร็จรับเงิน', 'ใบเสร็จรับเงิน'].map((dt) => (
                  <button
                    key={dt}
                    onClick={() => changeDocType(dt)}
                    className="text-xs px-2.5 py-1.5 rounded-full font-semibold flex-1"
                    style={{
                      background: docType === dt ? '#2563EB' : '#fff',
                      color: docType === dt ? '#fff' : '#1D4ED8',
                    }}
                  >
                    {dt}
                  </button>
                ))}
              </div>
              <div className="mb-2.5">
                <label className="text-xs" style={{ color: '#1D4ED8' }}>
                  ชื่อลูกค้าในเอกสาร
                </label>
                <input
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder={t.customer}
                  className="field w-full text-xs px-2.5 py-1.5"
                />
              </div>
              {docType === 'ใบกำกับภาษี/ใบเสร็จรับเงิน' && (
                <div className="mb-2.5 rounded-lg p-2.5" style={{ background: '#fff' }}>
                  <p className="text-xs font-medium mb-2" style={{ color: '#1D4ED8' }}>
                    ข้อมูลนิติบุคคล
                  </p>
                  {corporateBuyers.length > 0 && (
                    <select
                      onChange={(e) => {
                        const b = corporateBuyers.find((x) => x.name === e.target.value);
                        if (b) {
                          setBuyerName(b.name);
                          setBuyerAddress(b.address);
                          setBuyerTaxId(b.taxId);
                        }
                      }}
                      defaultValue=""
                      className="field w-full text-xs px-2.5 py-1.5 mb-2"
                    >
                      <option value="" disabled>
                        เลือกจากที่บันทึกไว้...
                      </option>
                      {corporateBuyers.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    value={buyerAddress}
                    onChange={(e) => setBuyerAddress(e.target.value)}
                    placeholder="ที่อยู่นิติบุคคล"
                    className="field w-full text-xs px-2.5 py-1.5 mb-2"
                  />
                  <input
                    value={buyerTaxId}
                    onChange={(e) => setBuyerTaxId(e.target.value)}
                    placeholder="เลขผู้เสียภาษี 13 หลัก"
                    className="field w-full text-xs px-2.5 py-1.5 mb-2"
                  />
                  <button
                    onClick={saveBuyer}
                    disabled={savingBuyer}
                    className="btn-outline w-full text-xs py-1.5 rounded-lg"
                    style={{
                      borderColor: '#2563EB',
                      color: '#1D4ED8',
                      opacity: savingBuyer ? 0.7 : 1,
                    }}
                  >
                    <i
                      className={`fa-solid ${savingBuyer ? 'fa-spinner fa-spin' : 'fa-floppy-disk'} mr-1.5`}
                    ></i>
                    {savingBuyer ? 'กำลังบันทึก...' : 'บันทึกข้อมูลนี้ไว้ใช้ครั้งถัดไป'}
                  </button>
                  {/* The button's whole promise is that this survives. Saying so
                      out loud is the difference between a saved buyer and one
                      that only looked saved. */}
                  {buyerSaveMsg && (
                    <p
                      className="text-xs mt-1.5"
                      role="status"
                      style={{ color: buyerSaveMsg.ok ? '#3F6B33' : '#B23A48' }}
                    >
                      <i
                        className={`fa-solid ${buyerSaveMsg.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'} mr-1`}
                      ></i>
                      {buyerSaveMsg.text}
                    </p>
                  )}
                </div>
              )}
              <label
                className="flex items-center gap-2 text-xs mb-2.5 cursor-pointer"
                style={{ color: '#1D4ED8' }}
              >
                <input
                  type="checkbox"
                  checked={showCompanyInfo}
                  onChange={(e) => setShowCompanyInfo(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                แสดงชื่อนิติบุคคล/เลขผู้เสียภาษีของร้าน
              </label>
              <label
                className="flex items-center gap-2 text-xs mb-2.5 cursor-pointer"
                style={{ color: '#1D4ED8' }}
              >
                <input
                  type="checkbox"
                  checked={showDisclaimer}
                  onChange={(e) => setShowDisclaimer(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                แสดงข้อความแจ้งเตือนตรวจเช็ครอบคัน
              </label>
              <button
                onClick={() => doPrint('doc')}
                className="w-full rounded-xl py-2 text-sm font-semibold flex items-center justify-center gap-2"
                style={{ background: '#2563EB', color: '#fff' }}
              >
                <i className="fa-solid fa-print"></i> ออก{docType}
              </button>
            </FormSection>
          )}
          {/*
            ข้อมูลของช่าง sits at the very bottom, below the financial-document
            block. The ticket is filled top-to-bottom by whoever is with the
            customer — vehicle, products, extras, money, paperwork — and the
            technician block (QC photos, install confirmation, actual
            quantities) is worked on later, usually by someone else. Several
            roles open this screen; none of them should have to scroll past a
            section that is not theirs.
          */}
          <div
            style={
              locked ? { pointerEvents: 'none', opacity: 0.65, userSelect: 'text' } : undefined
            }
            aria-disabled={locked || undefined}
          >
            <FormSection
              step={5}
              title="ข้อมูลของช่าง"
              icon="fa-user-gear"
              tone={SECTION_TONES.tech}
              hint="(แยกตามชนิดสินค้า เพราะแต่ละชนิดใช้ช่างคนละคนและตัดสต็อกต่างกัน)"
            >
              <TechSection
                t={t}
                stock={stock}
                attachmentUrlAction={attachmentUrlAction}
                field={field}
                technicians={options.technicians}
                setTechnicians={opt('technicians')}
                updateActualQty={updateActualQty}
                confirmInstall={confirmInstall}
                shareQcAlbum={shareQcAlbum}
                shopName={shopName}
              />
            </FormSection>
          </div>
        </div>

        <PrintJobSheet
          t={t}
          printMode={printMode}
          currentUserName={currentUserName}
          shopName={shopName}
          shopInfo={shopInfo}
          stock={stock}
          extraOptions={options.extra_options}
          total={total}
          paid={paid}
          docType={docType}
          buyerName={buyerName}
          buyerTaxId={buyerTaxId}
          buyerAddress={buyerAddress}
          showCompanyInfo={showCompanyInfo}
          showDisclaimer={showDisclaimer}
        />
      </div>
    </OptionManageProvider>
  );
}
