'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { getStatus, type StatusConfig } from '@/components/ui/Badge';
import { itemNetPrice } from '@/lib/domain/tickets';

import { PrintJobSheet, type PrintMode } from './PrintJobSheet';
import { serializeTicket } from './serialize';
import { ExtrasSection } from './detail/ExtrasSection';
import { ItemsSection } from './detail/ItemsSection';
import { PaymentsSection } from './detail/PaymentsSection';
import { TechSection } from './detail/TechSection';
import { VehicleInfoSection } from './detail/VehicleInfoSection';
import { confirmDiscardIfDirty, useUnsavedChangesGuard } from './useUnsavedChangesGuard';
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
  optionAction: (listKey: OptionListName, values: string[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [t, setT] = useState<Ticket>(initialTicket);
  const isDirty = useMemo(() => JSON.stringify(t) !== JSON.stringify(initialTicket), [t, initialTicket]);
  useUnsavedChangesGuard(isDirty, 'มีข้อมูลในใบงานนี้ที่ยังไม่ได้บันทึก');

  // Admin-managed option lists — optimistic local state, persisted via optionAction.
  const [options, setOptions] = useState<Options>(initialOptions);
  function setOption(name: OptionListName, values: string[]) {
    setOptions((prev) => ({ ...prev, [name]: values }));
    void optionAction(name, values);
  }
  const opt = (name: OptionListName) => (values: string[]) => setOption(name, values);

  // Secondary registries. These update in-session so the form behaves like the
  // prototype; full persistence of these config tables is out of scope for the
  // three named ticket server actions (flagged in the task report).
  const [stock, setStock] = useState<StockRow[]>(initialStock);
  const [carModels, setCarModels] = useState<CarModel[]>(initialCarModels);
  const [priceMatrix, setPriceMatrix] = useState<PriceMatrixRow[]>(initialPriceMatrix);
  const [retailCustomers, setRetailCustomers] = useState<RetailCustomer[]>(initialRetailCustomers);
  const [corporateBuyers, setCorporateBuyers] = useState<CorporateBuyer[]>(initialCorporateBuyers);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  function changeDocType(dt: string) {
    setDocType(dt);
    setShowCompanyInfo(dt === 'ใบกำกับภาษี/ใบเสร็จรับเงิน');
  }
  function doPrint(mode: PrintMode) {
    setPrintMode(mode);
    setTimeout(() => window.print(), 50);
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

  function field(key: keyof Ticket, value: unknown) {
    setT({ ...t, [key]: value });
  }
  function changeStatus(newStatus: string) {
    setT({ ...t, status: newStatus, statusHistory: [...(t.statusHistory || []), { status: newStatus, date: new Date() }] });
  }
  function onModelChange(v: string) {
    const match = carModels.find((m) => m.model.trim().toLowerCase() === v.trim().toLowerCase());
    if (match) setT({ ...t, model: v, brand: match.brand, carType: match.carType });
    else setT({ ...t, model: v });
  }
  function commitModelRegistry(brand: string, carType: string) {
    if (!t.model) return;
    setCarModels((prev) => {
      const idx = prev.findIndex((m) => m.model.trim().toLowerCase() === t.model.trim().toLowerCase());
      const entry = { model: t.model, brand, carType };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [...prev, entry];
    });
  }
  function lookupPrice(product: string, fallback: number) {
    const m = priceMatrix.find((p) => p.carType === t.carType && p.product === product);
    return m ? m.price : fallback;
  }
  function lookupFilmPrice(category: string, product: string, position: string, fallback: number) {
    const m = filmPriceMatrix.find(
      (p) => p.category === category && p.product === product && p.position === position && p.carType === t.carType
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
        items = [...items, { category: 'ประกัน', booked: 'ประกัน', bookedPrice: 0, sold: 'ประกัน', soldPrice: 0, autoInsurance: true }];
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
    const legs = Array.from({ length: legCount }, (_, i) => prevLegs[i] || { from: '', to: '', date: '', time: '' });
    setT({ ...t, extras: { ...t.extras, 'รถสไลด์': { ...current, slideType: st, legs } } });
  }
  function updateSlideLeg(legIdx: number, key: string, val: unknown) {
    const current = t.extras?.['รถสไลด์'] || {};
    const legs = [...((current.legs as Record<string, unknown>[]) || [])];
    legs[legIdx] = { ...(legs[legIdx] || {}), [key]: val };
    setT({ ...t, extras: { ...t.extras, 'รถสไลด์': { ...current, legs } } });
  }
  function addItem() {
    setT({ ...t, items: [...t.items, { category: '', booked: '', bookedPrice: 0, sold: '', soldPrice: 0 }] });
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
      ? { ...t.extras, 'นอกสถานที่': { ...(t.extras?.['นอกสถานที่'] || {}), checked: true } }
      : t.extras;
    setT({ ...t, items, extras });
  }
  function updateActualQty(idx: number, productName: string, newQty: string) {
    const it = t.items[idx];
    const currentMap = it.actualQtyMap || {};
    const prevQty = Number(currentMap[productName]) || 0;
    const delta = Number(newQty) - prevQty;
    if (delta !== 0 && productName) {
      setStock((prevStock) =>
        prevStock.map((s) => (s.name === productName && s.shop === t.shop ? { ...s, qty: s.qty - delta } : s))
      );
    }
    const items = [...t.items];
    items[idx] = { ...it, actualQtyMap: { ...currentMap, [productName]: newQty } };
    setT({ ...t, items });
  }
  function addPayment() {
    setT({ ...t, payments: [...t.payments, { type: 'มัดจำ', method: 'เงินสด', amount: 0, date: '', attachments: [] }] });
  }
  function updatePayment(idx: number, key: keyof TicketPayment, val: unknown) {
    const payments = [...t.payments];
    payments[idx] = { ...payments[idx], [key]: val };
    setT({ ...t, payments });
  }
  function shareLink(link?: string) {
    if (!link) return;
    if (navigator.share) navigator.share({ title: 'ตำแหน่งงานนอกสถานที่', url: link }).catch(() => {});
    else if (navigator.clipboard) {
      navigator.clipboard.writeText(link);
      window.alert('คัดลอกลิงก์แล้ว');
    }
  }
  function confirmInstall() {
    setT((prev) => ({ ...prev, installConfirmed: true, installConfirmedAt: new Date().toLocaleString('th-TH') }));
  }
  function shareQcAlbum() {
    const link = `${window.location.origin}${window.location.pathname}#qc-album-${t.id}`;
    const text = `อัลบั้มรูป QC ก่อนติดตั้ง — ${t.customer || ''} (${t.plate || ''})`;
    if (navigator.share)
      navigator.share({ title: 'อัลบั้มรูป QC ก่อนติดตั้ง (ดูอย่างเดียว)', text, url: link }).catch(() => {});
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
        discountValue: i.discountValue != null && i.discountValue !== '' ? Number(i.discountValue) : undefined,
      }),
    0
  );
  const paid = t.payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <div className="max-w-2xl fade-page">
      <button
        onClick={() => {
          if (confirmDiscardIfDirty(isDirty, 'มีข้อมูลในใบงานนี้ที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้โดยไม่บันทึกหรือไม่?'))
            router.push('/tickets');
        }}
        className="text-sm mb-4 flex items-center gap-2 font-medium"
        style={{ color: 'var(--ink-soft)' }}
      >
        <i className="fa-solid fa-arrow-left"></i>กลับไปรายการใบงาน
      </button>
      <div className="card p-5 sm:p-7">
        <div className="flex items-start justify-between mb-1">
          <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--primary)' }}>
            <i className="fa-solid fa-store"></i>
            {shopName(t.shop)}
          </p>
          <select
            value={t.status}
            onChange={(e) => changeStatus(e.target.value)}
            className="text-sm font-bold px-3 py-1.5 rounded-full border-none cursor-pointer"
            style={{ background: getStatus(statuses, t.status).bg, color: getStatus(statuses, t.status).text }}
          >
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.key}
              </option>
            ))}
          </select>
        </div>
        <p className="text-lg font-bold mb-5">{isNew ? 'สร้างใบงานใหม่' : `ใบงาน #${t.id}`}</p>

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
          timeSlots={options.time_slots}
          setTimeSlots={opt('time_slots')}
          retailCustomers={retailCustomers}
          setRetailCustomers={setRetailCustomers}
          onSelectCustomer={(c) => setT({ ...t, customer: c.name, phone: c.phone })}
          onModelChange={onModelChange}
          commitModelRegistry={commitModelRegistry}
        />

        <div className="mb-5">
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink-soft)' }}>
            หมายเหตุ
          </label>
          <textarea
            value={t.notes || ''}
            onChange={(e) => field('notes', e.target.value)}
            placeholder="ข้อมูลสำคัญที่ต้องการบันทึกไว้..."
            rows={2}
            className="field w-full text-sm px-3 py-2"
            style={{ resize: 'vertical' }}
          />
        </div>

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

        <TechSection
          t={t}
          field={field}
          technicians={options.technicians}
          setTechnicians={opt('technicians')}
          updateActualQty={updateActualQty}
          confirmInstall={confirmInstall}
          shareQcAlbum={shareQcAlbum}
          shopName={shopName}
        />

        <ExtrasSection
          t={t}
          extraOptions={options.extra_options}
          setExtraOptions={opt('extra_options')}
          slideTypes={options.slide_types}
          timeSlots={options.time_slots}
          setTimeSlots={opt('time_slots')}
          stock={stock}
          toggleExtra={toggleExtra}
          updateExtraDetail={updateExtraDetail}
          setSlideType={setSlideType}
          updateSlideLeg={updateSlideLeg}
          shareLink={shareLink}
        />

        <PaymentsSection
          t={t}
          paymentMethods={options.payment_methods}
          setPaymentMethods={opt('payment_methods')}
          addPayment={addPayment}
          updatePayment={updatePayment}
          total={total}
          paid={paid}
        />

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
          <button onClick={() => router.push('/tickets')} className="btn-outline flex-1 rounded-2xl py-3 text-sm font-medium">
            ยกเลิก
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary flex-1 rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
            style={{ opacity: saving ? 0.7 : 1 }}
          >
            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
            {saving ? 'กำลังบันทึก...' : 'บันทึกใบงาน'}
          </button>
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
        {!isNew && t.items.some((i) => i.sold) && canDo('list.printSheet') && t.extras?.['นอกสถานที่']?.checked && (
          <button
            onClick={() => doPrint('offsite')}
            className="btn-outline w-full mt-3 rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-print"></i> ใบงานนอกสถานที่
          </button>
        )}
        {!isNew && (
          <div className="rounded-2xl p-4 mt-4" style={{ background: '#EAF1FB', border: '1.5px solid #2563EB' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: '#1D4ED8' }}>
              <i className="fa-solid fa-file-invoice mr-1.5"></i>ออกเอกสารทางการเงิน
            </p>
            <div className="flex gap-1.5 mb-2.5">
              {['ใบเสนอราคา', 'ใบกำกับภาษี/ใบเสร็จรับเงิน', 'ใบเสร็จรับเงิน'].map((dt) => (
                <button
                  key={dt}
                  onClick={() => changeDocType(dt)}
                  className="text-xs px-2.5 py-1.5 rounded-full font-semibold flex-1"
                  style={{ background: docType === dt ? '#2563EB' : '#fff', color: docType === dt ? '#fff' : '#1D4ED8' }}
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
                  onClick={() => {
                    if (!buyerName.trim()) return;
                    setCorporateBuyers((prev) => {
                      const idx = prev.findIndex((x) => x.name === buyerName);
                      const entry = { name: buyerName, address: buyerAddress, taxId: buyerTaxId };
                      if (idx >= 0) {
                        const copy = [...prev];
                        copy[idx] = entry;
                        return copy;
                      }
                      return [...prev, entry];
                    });
                  }}
                  className="btn-outline w-full text-xs py-1.5 rounded-lg"
                  style={{ borderColor: '#2563EB', color: '#1D4ED8' }}
                >
                  <i className="fa-solid fa-floppy-disk mr-1.5"></i>บันทึกข้อมูลนี้ไว้ใช้ครั้งถัดไป
                </button>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs mb-2.5 cursor-pointer" style={{ color: '#1D4ED8' }}>
              <input
                type="checkbox"
                checked={showCompanyInfo}
                onChange={(e) => setShowCompanyInfo(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              แสดงชื่อนิติบุคคล/เลขผู้เสียภาษีของร้าน
            </label>
            <label className="flex items-center gap-2 text-xs mb-2.5 cursor-pointer" style={{ color: '#1D4ED8' }}>
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
          </div>
        )}
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
  );
}
