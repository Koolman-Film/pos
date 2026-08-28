'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { getStatus, type StatusConfig } from '@/components/ui/Badge';
import { OptionManageProvider } from '@/components/ui/optionManage';
import { confirmDiscardIfDirty, useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { fmtThaiDate, hhmm } from '@/lib/domain/format';
import { resolveFilmPrice } from '@/lib/domain/filmPrice';
import { itemNetPrice } from '@/lib/domain/tickets';
import { dateInputValue } from '@/lib/domain/now';
import { fitPrintPages } from '@/lib/print/fitToPage';

import { PrintJobSheet, TAX_DOC_TYPE, docPrefixFor, type PrintMode } from './PrintJobSheet';
import { serializeTicket } from './serialize';
import { findProductStock } from './serviceForm';
import { ExtrasSection } from './detail/ExtrasSection';
import { EXPIRY_WARNING_DAYS, InsuranceSection, daysLeft } from './detail/InsuranceSection';
import { FormSection, SECTION_TONES } from './detail/FormSection';
import { ItemsSection } from './detail/ItemsSection';
import { NotesSection } from './detail/NotesSection';
import { PaymentsSection } from './detail/PaymentsSection';
import { ServiceVisitsSection } from './detail/ServiceVisitsSection';
import { TechSection } from './detail/TechSection';
import { VehicleInfoSection } from './detail/VehicleInfoSection';
import { WrapOptionsSection } from './detail/WrapOptionsSection';
import { WRAP_CATEGORY } from './wrapOptions';
import type {
  CarModel,
  CorporateBuyer,
  FilmPriceRow,
  InsuranceClaim,
  InsurancePlan,
  InsurancePolicy,
  OptionListName,
  PriceMatrixRow,
  RetailCustomer,
  ServiceVisit,
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

export type SaveResult = {
  ok: boolean;
  error?: string;
  id?: string;
  /**
   * Saved, but some materials could not be deducted — the product was renamed or
   * removed since the usage was recorded. Not an error; a message somebody has to
   * read, because the alternative is stock quietly drifting.
   */
  stockWarning?: string;
};

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
  extrasAction,
  serviceVisitAction,
  serviceVisitDeleteAction,
  insurancePlans = [],
  insuranceAction,
  insuranceDeleteAction,
  documentAction,
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
  /**
   * Saves ข้อมูลเพิ่มเติม on its own. The only write a CLOSED ticket accepts —
   * service visits and a later ประกัน happen after delivery (migration 0022).
   */
  extrasAction?: (input: {
    ticketId: string;
    extras: Record<string, unknown>;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Records one ใบเซอร์วิส visit against this ticket (migration 0020). */
  serviceVisitAction?: (input: {
    id?: number;
    ticketId: string;
    visit: Record<string, unknown>;
    points: { seq: number; position: string; detail: string; note: string }[];
  }) => Promise<{ ok: boolean; error?: string; id?: number }>;
  serviceVisitDeleteAction?: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /** แผนประกัน the branch sells, for the picker (migration 0023). */
  insurancePlans?: InsurancePlan[];
  /** Records one กรมธรรม์ประกัน against this ticket, with its claims. */
  insuranceAction?: (input: {
    id?: number;
    ticketId: string;
    policy: Record<string, unknown>;
    claims: Record<string, unknown>[];
  }) => Promise<{ ok: boolean; error?: string; id?: number }>;
  insuranceDeleteAction?: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Records that a ใบเสร็จ / ใบกำกับภาษี was issued (migration 0024), so
   * โมดูลรายได้ can say which sales carry a tax invoice.
   */
  documentAction?: (input: {
    ticketId: string;
    docType: string;
    docNo: string;
    buyerName: string;
    buyerTaxId: string;
    buyerAddress: string;
    amount: number;
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

  /**
   * ประกันของรถคันนี้ที่ใกล้หมดอายุ — the same 30-day window the dashboard warns
   * on, repeated here because this is the screen open when the customer is at
   * the counter. Read across the CAR, not just this ticket: the cover may have
   * been sold on an earlier job.
   */
  const expiringPolicies = (initialTicket.insuranceForPlate ?? [])
    .map((p) => ({ policy: p, days: daysLeft(p.endsAt) }))
    .filter((x) => x.days != null && x.days <= EXPIRY_WARNING_DAYS)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  /**
   * บันทึก ข้อมูลเพิ่มเติม on a CLOSED ticket.
   *
   * The main save button is hidden while locked and the database would refuse
   * it anyway, so this narrow path exists instead: it writes `extras` and
   * nothing else (migration 0022). Only rendered when the ticket is locked —
   * an open ticket saves its extras with everything else.
   */
  const [savingExtras, setSavingExtras] = useState(false);
  const [extrasSaved, setExtrasSaved] = useState(false);
  async function saveExtras() {
    if (!extrasAction) return;
    setSaveError(null);
    setExtrasSaved(false);
    setSavingExtras(true);
    const result = await extrasAction({
      ticketId: t.id,
      extras: (t.extras ?? {}) as Record<string, unknown>,
    });
    setSavingExtras(false);
    if (!result.ok) {
      setSaveError(result.error || 'บันทึกข้อมูลเพิ่มเติมไม่สำเร็จ');
      return;
    }
    setExtrasSaved(true);
    router.refresh();
  }

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
  const [printVisit, setPrintVisit] = useState<ServiceVisit | null>(null);
  const [printPolicy, setPrintPolicy] = useState<InsurancePolicy | null>(null);
  const [printClaim, setPrintClaim] = useState<InsuranceClaim | null>(null);

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

  /**
   * ใบกำกับภาษีออกไม่ได้ถ้าใบงานเป็น "รับแทน Finnix".
   *
   * A tax invoice says this shop made this sale, and a held job is another
   * shop’s sale — issuing one here would put a document into the shop’s tax
   * position for money it never earned. ใบเสนอราคา and ใบเสร็จรับเงิน stay
   * available: the customer did pay at this counter and can still be given
   * paperwork for it.
   */
  const taxDocBlocked = t.revenueKind === 'รับแทน';

  function changeDocType(dt: string) {
    if (dt === TAX_DOC_TYPE && taxDocBlocked) return;
    setDocType(dt);
    setShowCompanyInfo(dt === TAX_DOC_TYPE);
  }

  /**
   * Switching a ticket to รับแทน has to take the tax invoice off the screen
   * with it — leaving it selected would leave a button offering to issue the
   * one document that is now refused.
   */
  function setRevenueKind(kind: 'รายได้' | 'รับแทน') {
    field('revenueKind', kind);
    if (kind === 'รับแทน' && docType === TAX_DOC_TYPE) changeDocTypeTo('ใบเสร็จรับเงิน');
  }
  function changeDocTypeTo(dt: string) {
    setDocType(dt);
    setShowCompanyInfo(dt === TAX_DOC_TYPE);
  }
  /**
   * ใบเซอร์วิส — one recorded visit, or a blank sheet when given null.
   *
   * The visit has to be in state before the print portal renders, hence the
   * separate setter rather than reusing `doPrint` alone.
   */
  function printServiceSheet(visit: ServiceVisit | null) {
    setPrintVisit(visit);
    doPrint('service');
  }

  /** Save a visit, then pull the ticket's list back from the server. */
  async function saveServiceVisit(visit: ServiceVisit) {
    if (!serviceVisitAction) return { ok: false, error: 'ยังไม่พร้อมใช้งาน' };
    const result = await serviceVisitAction({
      id: visit.id,
      ticketId: t.id,
      visit: {
        plate: t.plate,
        receivedAt: visit.receivedAt || null,
        receivedTime: visit.receivedTime,
        deliveredAt: visit.deliveredAt || null,
        deliveredTime: visit.deliveredTime,
        salesBy: visit.salesBy,
        qcBy: visit.qcBy,
        technicians: visit.technicians,
        filmProduct: visit.filmProduct,
        customerWaits: visit.customerWaits,
        overallOk: visit.overallOk,
        checks: visit.checks,
        notes: visit.notes,
      },
      points: visit.points,
    });
    // The list lives on the server-rendered ticket, so a refresh is what shows
    // the new visit — and the visit_no the database actually issued.
    if (result.ok) router.refresh();
    return result;
  }

  async function deleteServiceVisit(id: number) {
    if (!serviceVisitDeleteAction) return { ok: false, error: 'ยังไม่พร้อมใช้งาน' };
    const result = await serviceVisitDeleteAction(id);
    if (result.ok) router.refresh();
    return result;
  }

  /** ใบเสร็จค่าประกัน — its own document, on the policy’s own date. */
  function printInsuranceReceipt(policy: InsurancePolicy) {
    setPrintPolicy(policy);
    setPrintClaim(null);
    doPrint('insurance');
  }

  /**
   * ใบเคลมประกัน — the ใบเซอร์วิส form with the cover printed on it.
   *
   * A claim IS a workshop visit, so the sheet is filled the same way — but
   * NOTHING on it is asked for twice. Everything the ใบงาน already knows is
   * printed: the ฟิล์มกันรอย product that was fitted, who sold it, the team
   * that did the work, and the dates the car came in and went back. Only what
   * happens at the car during the claim is left empty to write on.
   *
   * `claim` null means the caller did not name one — the ปุ่มใบเคลม on the
   * policy. It then prints the LATEST recorded claim, because printing the
   * claim boxes blank while a claim is on file is the paperwork done twice.
   * A policy with no claims yet still gives the blank sheet to carry to the car.
   */
  function printInsuranceClaim(policy: InsurancePolicy, claim: InsuranceClaim | null) {
    const saved = policy.claims.filter((c) => c.claimedAt || c.detail);
    const latest = saved.length
      ? saved.reduce((a, b) => ((b.claimedAt || 0) >= (a.claimedAt || 0) ? b : a))
      : null;
    const c = claim ?? latest;

    // ฟิล์มที่ใช้ — the same source the ใบเซอร์วิส uses: the product on the
    // ฟิล์มกันรอย line, resolved to the stock name (`sold` carries a position
    // prefix). A recorded visit outranks it: that is what was actually fitted.
    const wrapItem = t.items.find((i) => i.category === WRAP_CATEGORY);
    const wrapStock = wrapItem ? findProductStock(stock, wrapItem.sold) : null;
    const lastVisit = t.serviceVisits?.[0] ?? null;

    setPrintPolicy(policy);
    setPrintClaim(c);
    setPrintVisit({
      visitNo: 0,
      plate: policy.plate || t.plate,
      // The dates of the job this warranty came from — how long ago the film
      // was fitted is the first thing anyone assessing a claim asks. The date
      // of the claim itself prints at the top of the sheet.
      receivedAt: dateInputValue(t.dropOffDateObj),
      receivedTime: hhmm(t.dropOffDateObj),
      deliveredAt: dateInputValue(t.pickupDateObj),
      deliveredTime: hhmm(t.pickupDateObj),
      salesBy: t.createdBy || currentUserName,
      // The ticket names the QC for the install itself; a later visit only
      // answers for that visit.
      qcBy: t.qcBy || lastVisit?.qcBy || '',
      // ช่างที่รับผิดชอบ from the ticket, plus whoever did the claim.
      technicians: [
        ...new Set([
          ...(t.techByCategory?.[WRAP_CATEGORY] ?? []),
          ...(c?.technician ? [c.technician] : []),
        ]),
      ],
      filmProduct: lastVisit?.filmProduct || wrapStock?.name || wrapItem?.sold || '',
      customerWaits: null,
      overallOk: null,
      checks: {},
      notes: policy.notes,
      points: c?.detail ? [{ seq: 1, position: '', detail: c.detail, note: '' }] : [],
    });
    doPrint('claim');
  }

  /** Save a policy with its claims, then pull the list back from the server. */
  async function saveInsurancePolicy(policy: InsurancePolicy) {
    if (!insuranceAction) return { ok: false, error: 'ยังไม่พร้อมใช้งาน' };
    const result = await insuranceAction({
      id: policy.id,
      ticketId: t.id,
      policy: {
        plate: t.plate,
        planName: policy.planName,
        price: policy.price,
        bigPieces: policy.bigPieces,
        smallPieces: policy.smallPieces,
        terms: policy.terms,
        soldAt: policy.soldAt || null,
        startsAt: policy.startsAt || null,
        endsAt: policy.endsAt || null,
        notes: policy.notes,
      },
      claims: policy.claims.map((c) => ({
        claimedAt: c.claimedAt || null,
        bigUsed: c.bigUsed,
        smallUsed: c.smallUsed,
        detail: c.detail,
        technician: c.technician,
      })),
    });
    if (result.ok) router.refresh();
    return result;
  }

  async function deleteInsurancePolicy(id: number) {
    if (!insuranceDeleteAction) return { ok: false, error: 'ยังไม่พร้อมใช้งาน' };
    const result = await insuranceDeleteAction(id);
    if (result.ok) router.refresh();
    return result;
  }

  /**
   * ออกเอกสารการเงิน — record it, then print it.
   *
   * The record is what lets โมดูลรายได้ answer "which sales did we issue a
   * ใบกำกับภาษี for". It is fired and not awaited: the customer is standing
   * at the counter waiting for the paper, and a reporting row is not worth
   * making them wait for — or worth cancelling the print over if it fails.
   */
  function issueDocument() {
    void documentAction?.({
      ticketId: t.id,
      docType,
      docNo: `${docPrefixFor(docType)}-${t.id.replace('JT-', '')}`,
      buyerName: buyerName || t.customer,
      buyerTaxId,
      buyerAddress,
      amount: total,
    });
    doPrint('doc');
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
      // The save worked, so this is not an error banner — but the shop has to
      // SEE it, and the next line navigates away. A product renamed after its
      // usage was recorded stops being deducted, and stock drifts from then on
      // unless somebody fixes the name.
      if (result.stockWarning) window.alert(result.stockWarning);
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
  /**
   * ราคาของสาขานี้ ถ้าไม่ได้ตั้งไว้จึงใช้ราคากลาง (migration 0029) — สินค้า
   * ชื่อเดียวกันขายคนละราคาในแต่ละสาขาได้.
   */
  function lookupFilmPrice(category: string, product: string, position: string, fallback: number) {
    const m = resolveFilmPrice(
      filmPriceMatrix,
      { category, product, position, carType: t.carType },
      t.shop,
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
  /**
   * ประกัน used to add a ticket_item at ราคา 0 here. It has its own record now
   * (migration 0023), because the cover can be bought months after the ticket
   * closed and a ticket line would have moved that job’s numbers.
   */
  function toggleExtra(name: string) {
    const current = t.extras?.[name] || {};
    setT({
      ...t,
      extras: { ...t.extras, [name]: { ...current, checked: !current.checked } },
    });
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
          {expiringPolicies.length > 0 && (
            <div
              className="rounded-2xl p-4 mb-5"
              style={{ background: '#FBF0DF', border: '1.5px solid #E2C48A' }}
            >
              <p className="text-sm font-semibold flex items-center gap-2">
                <i className="fa-solid fa-shield-halved"></i>ประกันของรถคันนี้ใกล้หมดอายุ
              </p>
              {expiringPolicies.map(({ policy, days }) => (
                <p key={policy.id} className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>
                  {policy.planName || 'ประกัน'} · หมดอายุ{' '}
                  {policy.endsAt ? fmtThaiDate(new Date(`${policy.endsAt}T00:00:00`)) : '-'}
                  {days != null && days < 0
                    ? ' (หมดอายุแล้ว)'
                    : days === 0
                      ? ' (วันนี้)'
                      : ` (อีก ${days} วัน)`}
                </p>
              ))}
            </div>
          )}

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

                {/*
                  pointerEvents back on: this one block escapes the lock. A
                  car comes back for service — and sometimes buys ประกัน —
                  long after the ticket was delivered, paid and closed, so
                  freezing this along with the money made the shop ask an
                  admin to reopen a finished job just to write down a visit.
                */}
                <div style={locked ? { pointerEvents: 'auto', opacity: 1 } : undefined}>
                  {locked && (
                    <p
                      className="text-xs mb-2 flex items-center gap-1.5"
                      style={{ color: '#4C7A3E' }}
                    >
                      <i className="fa-solid fa-lock-open"></i>
                      ส่วนนี้ยังแก้ไขได้แม้ใบงานปิดแล้ว (เซอร์วิส / ประกัน)
                    </p>
                  )}
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
                    insurance={
                      // A policy is a child row of a saved ticket, like a visit.
                      isNew || !insuranceAction
                        ? undefined
                        : () => (
                            <InsuranceSection
                              t={t}
                              // Server-owned: from initialTicket, not the draft.
                              policies={initialTicket.insurancePolicies ?? []}
                              forPlate={initialTicket.insuranceForPlate ?? []}
                              plans={insurancePlans}
                              technicians={options.technicians}
                              canDelete={canDo('list.delete')}
                              onSave={saveInsurancePolicy}
                              onDelete={deleteInsurancePolicy}
                              onPrint={printInsuranceReceipt}
                              onPrintClaim={printInsuranceClaim}
                            />
                          )
                    }
                    serviceVisits={
                      // A visit is a child row of a saved ticket, so there is
                      // nothing for it to hang off until the ticket has an id.
                      isNew || !serviceVisitAction
                        ? undefined
                        : ({ entitled, filmProduct, assignedTechnicians }) => (
                            <ServiceVisitsSection
                              t={t}
                              // Server-owned: from initialTicket, not the draft.
                              visits={initialTicket.serviceVisits ?? []}
                              visitsForPlate={initialTicket.serviceVisitsForPlate ?? 0}
                              entitled={entitled}
                              technicians={options.technicians}
                              setTechnicians={opt('technicians')}
                              currentUserName={currentUserName}
                              filmProduct={filmProduct}
                              assignedTechnicians={assignedTechnicians}
                              canDelete={canDo('list.delete')}
                              onSave={saveServiceVisit}
                              onDelete={deleteServiceVisit}
                              onPrint={printServiceSheet}
                            />
                          )
                    }
                  />
                  {/* Its own save: the ticket-wide one is gone while locked. */}
                  {locked && extrasAction && (
                    <div className="flex items-center gap-3 mt-3">
                      <button
                        onClick={saveExtras}
                        disabled={savingExtras}
                        className="btn-primary rounded-xl px-4 py-2 text-sm font-semibold flex items-center gap-2"
                        style={{ opacity: savingExtras ? 0.7 : 1 }}
                      >
                        <i
                          className={`fa-solid ${savingExtras ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}
                        ></i>
                        {savingExtras ? 'กำลังบันทึก...' : 'บันทึกข้อมูลเพิ่มเติม'}
                      </button>
                      {extrasSaved && (
                        <span className="text-xs" style={{ color: '#4C7A3E' }}>
                          <i className="fa-solid fa-circle-check mr-1"></i>บันทึกแล้ว
                        </span>
                      )}
                    </div>
                  )}
                </div>
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
                setRevenueKind={setRevenueKind}
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
                {['ใบเสนอราคา', TAX_DOC_TYPE, 'ใบเสร็จรับเงิน'].map((dt) => {
                  const off = dt === TAX_DOC_TYPE && taxDocBlocked;
                  return (
                    <button
                      key={dt}
                      onClick={() => changeDocType(dt)}
                      disabled={off}
                      title={
                        off ? 'ใบงานนี้เป็นเงินรับแทน Finnix จึงออกใบกำกับภาษีไม่ได้' : undefined
                      }
                      className="text-xs px-2.5 py-1.5 rounded-full font-semibold flex-1 flex items-center justify-center gap-1"
                      style={{
                        background: docType === dt ? '#2563EB' : '#fff',
                        color: docType === dt ? '#fff' : '#1D4ED8',
                        opacity: off ? 0.45 : 1,
                        cursor: off ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {off && <i className="fa-solid fa-lock text-[10px]"></i>}
                      {dt}
                    </button>
                  );
                })}
              </div>
              {taxDocBlocked && (
                <p className="text-xs mb-2.5 flex items-start gap-1.5" style={{ color: '#8A5A12' }}>
                  <i className="fa-solid fa-lock mt-0.5"></i>
                  <span>
                    ใบงานนี้เป็น<b>เงินรับแทน Finnix</b> ไม่ใช่รายการขายของร้าน
                    จึงออกใบกำกับภาษีไม่ได้ — ออกใบเสนอราคาหรือใบเสร็จรับเงินได้ตามปกติ
                  </span>
                </p>
              )}
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
                onClick={issueDocument}
                disabled={docType === TAX_DOC_TYPE && taxDocBlocked}
                className="w-full rounded-xl py-2 text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background: '#2563EB',
                  color: '#fff',
                  opacity: docType === TAX_DOC_TYPE && taxDocBlocked ? 0.45 : 1,
                }}
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
          serviceVisit={printVisit}
          insurancePolicy={printPolicy}
          insuranceClaim={printClaim}
          technicianOptions={options.technicians}
        />
      </div>
    </OptionManageProvider>
  );
}
