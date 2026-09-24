'use client';

import { useState } from 'react';
import { ThaiDateInput } from '@/components/ui/ThaiDateInput';

import { ManagedMultiChipPicker } from '@/components/ui/ManagedMultiChipPicker';
import { fmtThaiDate } from '@/lib/domain/format';
import { checkCover, claimProblem } from '@/lib/domain/insuranceCover';
import { dateInputValue } from '@/lib/domain/now';
import { buildServiceSchedule } from '@/lib/domain/serviceSchedule';

import { SERVICE_EXTERIOR_PARTS, SERVICE_INTERIOR_PARTS, SERVICE_POINT_ROWS } from '../serviceForm';

import { ServiceScheduleList, type ServiceScheduleProps } from './ServiceScheduleList';

import { CLAIM_VISIT, SERVICE_VISIT } from '../types';
import type {
  InsurancePolicy,
  ServiceVisit,
  ServiceVisitKind,
  ServiceVisitPoint,
  Ticket,
} from '../types';

/**
 * ใบเซอร์วิส ลูกค้าหน้าร้าน — the record of visits the car actually made.
 *
 * The Service extra on a ticket only ever held the ENTITLEMENT (how many visits
 * were sold, when the next is due). The shop could not answer "รถคันนี้เซอร์วิสไป
 * กี่ครั้งแล้ว วันไหน ทำอะไรบ้าง", which is what this section is for.
 *
 * Counted against the ticket, so "ครั้งที่ 2 / 10" is answerable; the plate total
 * underneath answers the same question for the car across every job it has had.
 */

const empty = (
  visitNo: number,
  t: Ticket,
  currentUserName: string,
  filmProduct: string,
  assignedTechnicians: string[],
  kind: ServiceVisitKind = SERVICE_VISIT,
): ServiceVisit => ({
  kind,
  visitNo,
  plate: t.plate,
  receivedAt: dateInputValue(new Date()),
  receivedTime: '',
  deliveredAt: '',
  deliveredTime: '',
  // The person filling this in is the one receiving the car, nine times in ten.
  salesBy: currentUserName,
  // The QC named on the ticket, for the same reason the team is: it is almost
  // always the same person, and asking again is how two answers appear.
  qcBy: t.qcBy ?? '',
  // The team the ticket put on the ฟิล์มกันรอย job. Almost always the same
  // people, so it is filled in rather than asked for again — still editable,
  // because a visit two years later may be somebody else.
  technicians: assignedTechnicians,
  filmProduct,
  customerWaits: null,
  overallOk: null,
  checks: {},
  notes: '',
  points: [],
  claim: null,
});

const labelCls = 'text-xs block mb-1';

export function ServiceVisitsSection({
  t,
  visits,
  visitsForPlate,
  entitled,
  technicians,
  setTechnicians,
  currentUserName,
  filmProduct,
  assignedTechnicians,
  canDelete,
  onSave,
  onDelete,
  onPrint,
  schedule,
  policies = [],
  claimOnly = false,
}: {
  t: Ticket;
  /**
   * Passed in rather than read off `t`, and taken from the SERVER copy of the
   * ticket. The form seeds its draft from props once, so a visit saved through
   * `router.refresh()` would never appear in a draft-derived list — it only
   * showed up after a full page load.
   */
  visits: ServiceVisit[];
  visitsForPlate: number;
  /** จำนวนครั้ง sold on this ticket; 0 when the shop did not set one. */
  entitled: number;
  technicians: string[];
  setTechnicians: (v: string[]) => void;
  currentUserName: string;
  /** ชื่อสินค้าฟิล์มจากใบงาน — never asked again here; the name says the thickness. */
  filmProduct: string;
  /** ช่างที่รับผิดชอบ from the ticket — the default ทีมช่าง for a new visit. */
  assignedTechnicians: string[];
  canDelete: boolean;
  onSave: (visit: ServiceVisit) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /** Prints one recorded visit, or a blank sheet when given null. */
  onPrint: (visit: ServiceVisit | null) => void;
  /** นัดเข้า Service. When given, each visit is shown under its own appointment. */
  schedule?: ServiceScheduleProps;
  /** This car’s policies — what a visit may claim from (0059). */
  policies?: InsurancePolicy[];
  /**
   * งานเคลมประกันอย่างเดียว (0067) — for the ประกัน block, where there may be no
   * Service package at all. Shows the claim visits and nothing else: no
   * schedule, no entitlement, no way to start one that would eat a visit the
   * customer paid for.
   */
  claimOnly?: boolean;
}) {
  /*
    งานเคลมประกันไม่กินสิทธิ์เซอร์วิส (ร้านขอ 24 ก.ย. 2569, migration 0067).

    A claim is not always part of a service: the car may come in only to have a
    claimed piece replaced. Counting that as one of the visits the customer
    bought took their money. So the two kinds are counted, numbered and listed
    separately, and only เซอร์วิส answers "ใช้ไปกี่ครั้ง".
  */
  const isClaim = (v: ServiceVisit) => v.kind === CLAIM_VISIT;
  const serviceVisits = visits.filter((v) => !isClaim(v));
  const claimVisits = visits.filter(isClaim);
  const used = serviceVisits.length;
  const [draft, setDraft] = useState<ServiceVisit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setError(null);
    setDraft(empty(used + 1, t, currentUserName, filmProduct, assignedTechnicians));
  }
  /** A visit that only spends the cover — its own numbering, its own list. */
  function startClaim() {
    setError(null);
    const blank = empty(
      claimVisits.length + 1,
      t,
      currentUserName,
      filmProduct,
      assignedTechnicians,
      CLAIM_VISIT,
    );
    // The claim IS the visit here, so the cover is picked already rather than
    // asked for with a tickbox. The first policy that covers today; if none
    // does, the form says why, as it does for a service visit.
    const today = dateInputValue(new Date());
    const cover = policies.find((p) => p.id && checkCover(p, today).ok);
    setDraft(
      cover?.id
        ? { ...blank, claim: { policyId: cover.id, bigUsed: 0, smallUsed: 0, detail: '' } }
        : blank,
    );
  }
  function startEdit(v: ServiceVisit) {
    setError(null);
    setDraft({ ...v, points: [...v.points] });
  }
  function set<K extends keyof ServiceVisit>(key: K, value: ServiceVisit[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }
  function setCheck(part: string, result: string) {
    setDraft((d) => (d ? { ...d, checks: { ...d.checks, [part]: result } } : d));
  }
  function setPoint(seq: number, field: keyof ServiceVisitPoint, value: string) {
    setDraft((d) => {
      if (!d) return d;
      const points = [...d.points];
      const i = points.findIndex((p) => p.seq === seq);
      const row = i >= 0 ? { ...points[i] } : { seq, position: '', detail: '', note: '' };
      (row[field] as string) = value;
      if (i >= 0) points[i] = row;
      else points.push(row);
      return { ...d, points };
    });
  }
  const pointAt = (seq: number) =>
    draft?.points.find((p) => p.seq === seq) ?? { seq, position: '', detail: '', note: '' };

  async function save() {
    if (!draft) return;
    // Said here rather than left to the database, which would refuse it anyway.
    if (claimError) {
      setError(claimError);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || 'บันทึกไม่สำเร็จ');
      return;
    }
    setDraft(null);
  }

  async function remove(v: ServiceVisit) {
    if (!v.id) return;
    const what = isClaim(v) ? 'งานเคลมประกัน' : 'บันทึกการเซอร์วิส';
    if (!window.confirm(`ลบ${what}ครั้งที่ ${v.visitNo}?\n\nลบแล้วกู้คืนไม่ได้`)) return;
    const result = await onDelete(v.id);
    if (!result.ok) setError(result.error || 'ลบไม่สำเร็จ');
  }

  /*
    เคลมประกันในการเซอร์วิสครั้งนี้ (ร้านขอ 17 ก.ย. 2569). Which of this car’s
    policies the visit being written could use, on the day the car came in —
    the same rules save_service_visit enforces (lib/domain/insuranceCover.ts).
  */
  const claimDay = draft?.receivedAt || dateInputValue(new Date());
  const covers = policies
    .filter((p) => p.id)
    .map((policy) => ({ policy, check: checkCover(policy, claimDay, draft?.id) }));
  const usableCover = covers.find((c) => c.check.ok) ?? null;
  const noCoverReason =
    covers.length === 0
      ? 'รถคันนี้ไม่มีประกัน — เคลมไม่ได้'
      : `เคลมไม่ได้: ${[...new Set(covers.map((c) => c.check.reason))].join(', ')}`;
  const claim = draft?.claim ?? null;
  const claimCover = claim ? covers.find((c) => c.policy.id === claim.policyId) : undefined;
  const claimError = claim
    ? claimCover
      ? claimProblem(claimCover.check, claim.bigUsed, claim.smallUsed)
      : 'เลือกประกันที่ใช้เคลม'
    : draft && isClaim(draft)
      ? // Without it the record says nothing happened, and it is not a service
        // either — the database refuses it for the same reason.
        'งานเคลมประกันต้องระบุประกันที่ใช้เคลม'
      : null;

  // นัดเข้า Service — present when the ticket sold visits with a start date.
  // Never in the ประกัน block, which is about the cover and not the package.
  const rows =
    schedule && !claimOnly
      ? buildServiceSchedule(schedule.start, schedule.count, schedule.saved)
      : [];
  const scheduled = rows.length > 0;

  const card = (v: ServiceVisit) => (
    <div
      key={v.id ?? v.visitNo}
      className="rounded-xl p-2.5 mb-2 flex items-start justify-between gap-2"
      style={{ background: '#fff', border: '1px solid var(--line)' }}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold">
          {isClaim(v) ? 'งานเคลมครั้งที่' : 'ครั้งที่'} {v.visitNo}
          {/* Said on the card, because the two are numbered separately and
              "ครั้งที่ 1" twice on one ticket would otherwise read as a mistake. */}
          {isClaim(v) && (
            <span
              className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: '#EFE6F5', color: '#6B4C8A' }}
            >
              ไม่นับสิทธิ์เซอร์วิส
            </span>
          )}
          <span className="font-normal ml-1.5" style={{ color: 'var(--ink-soft)' }}>
            {v.receivedAt ? fmtThaiDate(new Date(v.receivedAt)) : 'ยังไม่ระบุวันที่'}
          </span>
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
          {v.technicians.length ? v.technicians.join(', ') : 'ยังไม่ระบุช่าง'}
          {' · '}
          {v.points.length ? `${v.points.length} จุดแก้ไข` : 'ไม่มีจุดแก้ไข'}
          {v.overallOk === true ? ' · รอบคันปกติ' : v.overallOk === false ? ' · พบปัญหา' : ''}
          {v.claim
            ? ` · เคลมประกัน ${v.claim.bigUsed} ชิ้นใหญ่, ${v.claim.smallUsed} ชิ้นเล็ก`
            : ''}
        </p>
      </div>
      <div className="flex gap-1.5 flex-shrink-0">
        <button
          onClick={() => startEdit(v)}
          className="btn-outline text-xs px-2.5 py-1 rounded-lg"
          aria-label={`แก้ไข${isClaim(v) ? 'งานเคลมประกัน' : 'การเซอร์วิส'}ครั้งที่ ${v.visitNo}`}
        >
          <i className="fa-solid fa-pen"></i>
        </button>
        <button
          onClick={() => onPrint(v)}
          className="btn-outline text-xs px-2.5 py-1 rounded-lg"
          aria-label={`พิมพ์ใบเซอร์วิสครั้งที่ ${v.visitNo}`}
        >
          <i className="fa-solid fa-print"></i>
        </button>
        {canDelete && (
          <button
            onClick={() => remove(v)}
            className="text-xs px-2 rounded-lg"
            style={{ color: '#B23A48' }}
            aria-label={`ลบ${isClaim(v) ? 'งานเคลมประกัน' : 'การเซอร์วิส'}ครั้งที่ ${v.visitNo}`}
          >
            <i className="fa-solid fa-trash"></i>
          </button>
        )}
      </div>
    </div>
  );

  const form = draft ? (
    <div
      className="rounded-xl p-3 mt-1"
      style={{ background: '#fff', border: '1.5px solid var(--primary)' }}
    >
      <p className="text-xs font-bold mb-2.5">
        {`${draft.id ? 'แก้ไข' : ''}${isClaim(draft) ? 'งานเคลมประกัน' : 'การเซอร์วิส'}ครั้งที่ ${draft.visitNo}`}
        {isClaim(draft) && (
          <span className="ml-1.5 font-normal" style={{ color: 'var(--ink-soft)' }}>
            — ไม่นับเป็นสิทธิ์เซอร์วิสของลูกค้า
          </span>
        )}
      </p>

      <div className="grid grid-cols-2 gap-2 mb-2.5">
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            วันรับรถ
          </label>
          <ThaiDateInput
            value={draft.receivedAt}
            onChange={(v) => set('receivedAt', v)}
            className="field w-full text-xs px-2.5 py-1.5"
            ariaLabel="วันรับรถ"
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            เวลารับรถ
          </label>
          <input
            type="time"
            aria-label="เวลารับรถ"
            value={draft.receivedTime}
            onChange={(e) => set('receivedTime', e.target.value)}
            className="field w-full text-xs px-2.5 py-1.5"
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            วันส่งมอบรถ
          </label>
          <ThaiDateInput
            value={draft.deliveredAt}
            onChange={(v) => set('deliveredAt', v)}
            className="field w-full text-xs px-2.5 py-1.5"
            ariaLabel="วันส่งมอบรถ"
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            เวลาส่งมอบรถ
          </label>
          <input
            type="time"
            aria-label="เวลาส่งมอบรถ"
            value={draft.deliveredTime}
            onChange={(e) => set('deliveredTime', e.target.value)}
            className="field w-full text-xs px-2.5 py-1.5"
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            เซลล์รับรถ
          </label>
          <input
            aria-label="เซลล์รับรถ"
            value={draft.salesBy}
            onChange={(e) => set('salesBy', e.target.value)}
            className="field w-full text-xs px-2.5 py-1.5"
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            QC ผู้รับผิดชอบ
          </label>
          <input
            aria-label="QC ผู้รับผิดชอบ"
            value={draft.qcBy}
            onChange={(e) => set('qcBy', e.target.value)}
            className="field w-full text-xs px-2.5 py-1.5"
          />
        </div>
      </div>

      {/*
            The film, as the ticket sold it. Not asked again and not split into
            ประเภท / ความหนา / รหัสสี — each SKU states its thickness in the name,
            so the name is the whole answer. The visit still STORES its own copy,
            so reprinting an old sheet shows the film fitted that day.
          */}
      <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
        ฟิล์มที่ใช้
      </label>
      <p
        className="text-xs mb-2.5 px-2.5 py-1.5 rounded-lg"
        style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}
      >
        {draft.filmProduct || 'ยังไม่มีสินค้าฟิล์มในใบงาน'}
        <span className="ml-1.5" style={{ color: 'var(--ink-faint)' }}>
          (จากใบงาน)
        </span>
      </p>
      <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
        ทีมช่าง
      </label>
      <div className="mb-2.5">
        <ManagedMultiChipPicker
          values={draft.technicians}
          onChange={(v) => set('technicians', v)}
          options={technicians}
          setOptions={setTechnicians}
        />
      </div>

      <div className="flex flex-wrap gap-4 mb-2.5">
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            เช็คสภาพงาน รอบคัน
          </label>
          <div className="flex gap-1.5">
            {[
              { v: true, label: 'ปกติ' },
              { v: false, label: 'พบปัญหา' },
            ].map((o) => (
              <button
                key={o.label}
                onClick={() => set('overallOk', draft.overallOk === o.v ? null : o.v)}
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={
                  draft.overallOk === o.v
                    ? { background: 'var(--primary)', color: '#fff' }
                    : { border: '1px solid var(--line)' }
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            ลูกค้า
          </label>
          <div className="flex gap-1.5">
            {[
              { v: true, label: 'รอ' },
              { v: false, label: 'ไม่รอ' },
            ].map((o) => (
              <button
                key={o.label}
                onClick={() => set('customerWaits', draft.customerWaits === o.v ? null : o.v)}
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={
                  draft.customerWaits === o.v
                    ? { background: 'var(--primary)', color: '#fff' }
                    : { border: '1px solid var(--line)' }
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/*
        เคลมประกัน — made at the visit it happened at, so the dates and the
        team are this visit’s and are not asked again. Only this car’s cover,
        only while it runs, only as many pieces as are left.
      */}
      <div className="rounded-lg p-2.5 mb-2.5" style={{ background: 'var(--paper)' }}>
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={!!claim}
            disabled={!claim && !usableCover}
            onChange={(e) =>
              set(
                'claim',
                e.target.checked && usableCover?.policy.id
                  ? { policyId: usableCover.policy.id, bigUsed: 0, smallUsed: 0, detail: '' }
                  : null,
              )
            }
          />
          {isClaim(draft) ? 'ประกันที่ใช้เคลม' : 'ใช้ประกันเคลมในการเซอร์วิสครั้งนี้'}
        </label>
        {!claim && !usableCover && (
          <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>
            {noCoverReason}
          </p>
        )}
        {claim && (
          <div className="mt-2 flex flex-col gap-2">
            <select
              aria-label="ประกันที่ใช้เคลม"
              value={claim.policyId}
              onChange={(e) => set('claim', { ...claim, policyId: Number(e.target.value) })}
              className="field w-full text-xs px-2.5 py-1.5"
            >
              {covers.map(({ policy, check }) => (
                <option
                  key={policy.id}
                  value={policy.id}
                  disabled={!check.ok && policy.id !== claim.policyId}
                >
                  {policy.planName || 'ประกัน'} · เหลือ {check.left.big} ชิ้นใหญ่,{' '}
                  {check.left.small} ชิ้นเล็ก{check.ok ? '' : ` (${check.reason})`}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                  ชิ้นใหญ่ที่เคลม
                </label>
                <input
                  type="number"
                  min={0}
                  aria-label="ชิ้นใหญ่ที่เคลม"
                  value={claim.bigUsed}
                  onChange={(e) => set('claim', { ...claim, bigUsed: Number(e.target.value) })}
                  className="field w-full text-xs px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                  ชิ้นเล็กที่เคลม
                </label>
                <input
                  type="number"
                  min={0}
                  aria-label="ชิ้นเล็กที่เคลม"
                  value={claim.smallUsed}
                  onChange={(e) => set('claim', { ...claim, smallUsed: Number(e.target.value) })}
                  className="field w-full text-xs px-2.5 py-1.5"
                />
              </div>
            </div>
            <input
              aria-label="รายการที่เคลม"
              placeholder="เคลมอะไร เช่น กันชนหน้า"
              value={claim.detail}
              onChange={(e) => set('claim', { ...claim, detail: e.target.value })}
              className="field w-full text-xs px-2.5 py-1.5"
            />
            {claimError && (
              <p className="text-xs" style={{ color: '#B23A48' }}>
                {claimError}
              </p>
            )}
          </div>
        )}
      </div>

      {[
        { title: 'ภายในรถ', parts: SERVICE_INTERIOR_PARTS },
        { title: 'ภายนอกรถ', parts: SERVICE_EXTERIOR_PARTS },
      ].map((group) => (
        <div key={group.title} className="mb-2.5">
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            {group.title}
          </label>
          {/*
                Typed, not picked from three buttons. The paper form leaves a
                blank cell beside each part precisely because what gets written
                there varies — a state, a measurement, a note. A row left empty
                prints empty.
              */}
          {group.parts.map((part) => (
            <div key={part} className="flex items-center gap-2 py-0.5">
              <span className="text-xs flex-1 min-w-0">{part}</span>
              <input
                aria-label={part}
                value={draft.checks[part] ?? ''}
                onChange={(e) => setCheck(part, e.target.value)}
                className="field text-xs px-2 py-1"
                style={{ width: 150, flexShrink: 0 }}
              />
            </div>
          ))}
        </div>
      ))}

      <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
        จุดพิเศษลูกค้าต้องการแก้ไข
      </label>
      <div className="mb-2.5">
        {Array.from({ length: SERVICE_POINT_ROWS }, (_, i) => i + 1).map((seq) => {
          const p = pointAt(seq);
          return (
            <div key={seq} className="flex gap-1.5 mb-1 items-center">
              <span
                className="text-xs w-5 text-right flex-shrink-0"
                style={{ color: 'var(--ink-faint)' }}
              >
                {seq}.
              </span>
              <input
                aria-label={`จุดที่ ${seq} ตำแหน่ง`}
                placeholder="ตำแหน่ง"
                value={p.position}
                onChange={(e) => setPoint(seq, 'position', e.target.value)}
                className="field text-xs px-2 py-1 flex-1 min-w-0"
              />
              <input
                aria-label={`จุดที่ ${seq} รายละเอียด`}
                placeholder="รายละเอียด"
                value={p.detail}
                onChange={(e) => setPoint(seq, 'detail', e.target.value)}
                className="field text-xs px-2 py-1 flex-1 min-w-0"
              />
              <input
                aria-label={`จุดที่ ${seq} หมายเหตุ`}
                placeholder="หมายเหตุ"
                value={p.note}
                onChange={(e) => setPoint(seq, 'note', e.target.value)}
                className="field text-xs px-2 py-1 flex-1 min-w-0"
              />
            </div>
          );
        })}
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          แถวที่เว้นว่างไว้จะไม่ถูกบันทึก
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setDraft(null)}
          className="btn-outline flex-1 text-xs rounded-xl py-2 font-medium"
        >
          ยกเลิก
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary flex-1 text-xs rounded-xl py-2 font-semibold flex items-center justify-center gap-1.5"
          style={{ opacity: saving ? 0.7 : 1 }}
        >
          <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
          {saving ? 'กำลังบันทึก...' : isClaim(draft) ? 'บันทึกงานเคลม' : 'บันทึกการเซอร์วิส'}
        </button>
      </div>
    </div>
  ) : null;

  /** Under one date: the visit being written, the visit on record, or — for the next one due — the button to record it. */
  const slot = (no: number) => {
    if (draft?.visitNo === no) return form;
    const recorded = serviceVisits.find((v) => v.visitNo === no);
    if (recorded) return card(recorded);
    if (!draft && no === used + 1) {
      return (
        <button
          onClick={startNew}
          className="btn-outline w-full text-xs rounded-xl py-2 font-medium flex items-center justify-center gap-1.5"
        >
          <i className="fa-solid fa-plus"></i>บันทึกการเซอร์วิสครั้งที่ {no}
        </button>
      );
    }
    return null;
  };

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px dashed var(--line)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--primary)' }}>
          <i
            className={`fa-solid ${claimOnly ? 'fa-shield-halved' : 'fa-screwdriver-wrench'} mr-1.5`}
          ></i>
          {claimOnly ? 'งานเคลมประกัน' : 'ประวัติการเซอร์วิส'}
          <span className="ml-1.5 font-normal" style={{ color: 'var(--ink-soft)' }}>
            {claimOnly
              ? `บันทึกแล้ว ${claimVisits.length} ครั้ง`
              : entitled > 0
                ? `ใช้ไป ${used} / ${entitled} ครั้ง`
                : `บันทึกแล้ว ${used} ครั้ง`}
          </span>
        </p>
        {!claimOnly && entitled > 0 && used >= entitled && (
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: '#FBEAEC', color: '#B23A48' }}
          >
            ครบสิทธิ์แล้ว
          </span>
        )}
      </div>

      {claimOnly && claimVisits.length === 0 && (
        <p className="text-xs mb-2" style={{ color: 'var(--ink-faint)' }}>
          ยังไม่มีการเคลม — กดปุ่มข้างล่างเพื่อบันทึกการเคลม โดยไม่กินสิทธิ์เซอร์วิสของลูกค้า
        </p>
      )}
      {!claimOnly && !scheduled && visits.length === 0 && (
        <p className="text-xs mb-2" style={{ color: 'var(--ink-faint)' }}>
          ยังไม่มีการเซอร์วิส
        </p>
      )}
      {/*
        นัดเข้า Service: each visit is recorded under its own date, so the
        appointment and what happened on it read — and are filled in — in one
        place. Without a schedule, the list stands on its own as before.
      */}
      {scheduled && schedule && (
        <ServiceScheduleList
          start={schedule.start}
          count={schedule.count}
          saved={schedule.saved}
          onChange={schedule.onChange}
          recordedVisitNos={serviceVisits.map((v) => v.visitNo)}
          renderVisit={slot}
        />
      )}
      {(claimOnly
        ? claimVisits
        : visits.filter((v) => isClaim(v) || !scheduled || v.visitNo > rows.length)
      ).map((v) => card(v))}

      {/* The car's own total, which is the question the shop actually asks. It
          differs from `used` whenever the plate has had more than one job. */}
      {t.plate && visitsForPlate > used && (
        <p className="text-xs mb-2" style={{ color: 'var(--ink-faint)' }}>
          รถทะเบียน <b>{t.plate}</b> เคยเซอร์วิสรวม {visitsForPlate} ครั้ง (นับทุกใบงาน)
        </p>
      )}

      {error && (
        <p
          className="text-xs mb-2 px-2.5 py-1.5 rounded-lg"
          role="alert"
          style={{ background: '#FBEAEC', color: '#B23A48' }}
        >
          <i className="fa-solid fa-triangle-exclamation mr-1"></i>
          {error}
        </p>
      )}

      {!draft && (
        <div className="flex gap-2 flex-wrap">
          {!claimOnly && (!scheduled || used >= rows.length) && (
            <button
              onClick={startNew}
              className="btn-outline flex-1 text-xs rounded-xl py-2 font-medium flex items-center justify-center gap-1.5"
            >
              <i className="fa-solid fa-plus"></i>บันทึกการเซอร์วิสครั้งใหม่
            </button>
          )}
          {/*
            งานเคลมประกัน (0067). Offered whenever the car has cover to spend,
            whether or not it has a Service package and whether or not the
            package is used up: a claim is the policy's, not the package's.
          */}
          {policies.length > 0 && (
            <button
              onClick={startClaim}
              className="btn-outline flex-1 text-xs rounded-xl py-2 font-medium flex items-center justify-center gap-1.5"
            >
              <i className="fa-solid fa-shield-halved"></i>บันทึกงานเคลมประกัน
            </button>
          )}
          {/* Both ways of working, as asked: fill it in here, or take a blank
              sheet to the car and record the outcome afterwards. */}
          <button
            onClick={() => onPrint(null)}
            className="btn-outline flex-1 text-xs rounded-xl py-2 font-medium flex items-center justify-center gap-1.5"
          >
            <i className="fa-solid fa-print"></i>พิมพ์ใบเซอร์วิสเปล่า
          </button>
        </div>
      )}

      {draft && (isClaim(draft) || !scheduled || draft.visitNo > rows.length) && form}
    </div>
  );
}
