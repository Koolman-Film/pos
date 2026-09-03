'use client';

import { useState } from 'react';

import { fmtThaiDate } from '@/lib/domain/format';
import { dateInputValue } from '@/lib/domain/now';
import { TimeSelect } from '@/components/ui/TimeSelect';

import type { InsuranceClaim, InsurancePlan, InsurancePolicy, Ticket } from '../types';

/**
 * ประกันฟิล์มกันรอย — เลือกแผน, บันทึกกรมธรรม์, และเก็บการเคลม.
 *
 * ประกัน used to be a line on the ticket at ราคา 0 that somebody typed a price
 * into. That tied the money to the ticket's date, and the shop sells the cover
 * two ways: with the install, or months later when the ticket is closed and its
 * revenue has already been reported. A policy is its own record with its own
 * `soldAt` so both cases behave the same and no finished job ever has its
 * numbers moved (migration 0023).
 *
 * Cover is counted, not described — ชิ้นใหญ่ / ชิ้นเล็ก — which is what lets this
 * answer "เหลือกี่ชิ้น" after a claim. The sentence the customer reads is built
 * from those two numbers, so editing the numbers edits the sentence.
 */

const labelCls = 'text-xs block mb-1';

/** "ครอบคลุม 2 ชิ้นใหญ่, 20 ชิ้นเล็ก" — one place, so screen and paper agree. */
export function coverageText(bigPieces: number, smallPieces: number): string {
  const parts: string[] = [];
  if (bigPieces > 0) parts.push(`${bigPieces} ชิ้นใหญ่`);
  if (smallPieces > 0) parts.push(`${smallPieces} ชิ้นเล็ก`);
  return parts.length ? `ครอบคลุม ${parts.join(', ')}` : 'ยังไม่ได้ระบุความคุ้มครอง';
}

/** What the policy has left after every claim written against it. */
export function remainingCover(p: InsurancePolicy): { big: number; small: number } {
  const usedBig = p.claims.reduce((s, c) => s + Number(c.bigUsed || 0), 0);
  const usedSmall = p.claims.reduce((s, c) => s + Number(c.smallUsed || 0), 0);
  return { big: p.bigPieces - usedBig, small: p.smallPieces - usedSmall };
}

/**
 * Days until the cover runs out. Negative once it has.
 *
 * Both dates are read as local midnight: `new Date('2026-08-17')` is UTC, and in
 * Asia/Bangkok that is 07:00 on the day itself, which is off by one either side
 * of midnight.
 */
export function daysLeft(endsAt: string, today = new Date()): number | null {
  if (!endsAt) return null;
  const end = new Date(`${endsAt}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** Same window the dashboard warns on. */
export const EXPIRY_WARNING_DAYS = 30;

function addMonths(iso: string, months: number): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // A 31st that lands in a 30-day month rolls forward in JS; pull it back so
  // "1 ปี" from the 31st ends on the last day of that month, not the 1st after.
  if (d.getDate() !== day) d.setDate(0);
  return dateInputValue(d);
}

const blankClaim = (): InsuranceClaim => ({
  claimedAt: dateInputValue(new Date()),
  bigUsed: 0,
  smallUsed: 0,
  detail: '',
  technician: '',
});

function emptyPolicy(t: Ticket, plan?: InsurancePlan): InsurancePolicy {
  const today = dateInputValue(new Date());
  return {
    plate: t.plate,
    planName: plan?.name ?? '',
    price: plan?.price ?? 0,
    bigPieces: plan?.bigPieces ?? 0,
    smallPieces: plan?.smallPieces ?? 0,
    terms: plan?.terms ?? '',
    // Today, not the ticket's date: this is when the money came in, and on an
    // old ticket those are months apart.
    soldAt: today,
    startsAt: today,
    endsAt: plan ? addMonths(today, plan.months) : '',
    notes: '',
    claims: [],
  };
}

export function InsuranceSection({
  t,
  policies,
  forPlate,
  plans,
  technicians,
  canDelete,
  onSave,
  onDelete,
  onPrint,
  onPrintClaim,
}: {
  t: Ticket;
  /**
   * From the SERVER copy of the ticket, like the service visits: the form seeds
   * its draft from props once, so a policy saved through `router.refresh()`
   * would never reach a draft-derived list.
   */
  policies: InsurancePolicy[];
  /** Every policy this PLATE has, across all its tickets. */
  forPlate: InsurancePolicy[];
  plans: InsurancePlan[];
  technicians: string[];
  canDelete: boolean;
  onSave: (policy: InsurancePolicy) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /** Prints the ใบเสร็จค่าประกัน for one policy. */
  onPrint: (policy: InsurancePolicy) => void;
  /**
   * Prints the ใบเคลมประกัน — the ใบเซอร์วิส form with the cover on it. A null
   * claim prints a blank one, which is the sheet the technician carries to the
   * car; a recorded claim reprints what was written that day.
   */
  onPrintClaim: (policy: InsurancePolicy, claim: InsuranceClaim | null) => void;
}) {
  const [draft, setDraft] = useState<InsurancePolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usable = plans.filter((p) => p.active);

  function startNew() {
    setError(null);
    setDraft(emptyPolicy(t, usable[0]));
  }
  function startEdit(p: InsurancePolicy) {
    setError(null);
    setDraft({ ...p, claims: p.claims.map((c) => ({ ...c })) });
  }
  function set<K extends keyof InsurancePolicy>(key: K, value: InsurancePolicy[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  /**
   * Picking a plan copies its values in. A copy, not a link: the policy is what
   * the customer bought, and next year's price rise must not reach backwards
   * into it. Everything stays editable afterwards.
   */
  function applyPlan(name: string) {
    const plan = usable.find((p) => p.name === name);
    setDraft((d) => {
      if (!d) return d;
      if (!plan) return { ...d, planName: name };
      return {
        ...d,
        planName: plan.name,
        price: plan.price,
        bigPieces: plan.bigPieces,
        smallPieces: plan.smallPieces,
        terms: plan.terms,
        endsAt: d.startsAt ? addMonths(d.startsAt, plan.months) : d.endsAt,
      };
    });
  }

  function setClaim(idx: number, field: keyof InsuranceClaim, value: string | number) {
    setDraft((d) => {
      if (!d) return d;
      const claims = d.claims.map((c, i) => (i === idx ? { ...c, [field]: value } : c));
      return { ...d, claims };
    });
  }

  async function save() {
    if (!draft) return;
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

  async function remove(p: InsurancePolicy) {
    if (!p.id) return;
    if (!window.confirm(`ลบประกัน "${p.planName || 'ไม่ระบุแผน'}"?\n\nลบแล้วกู้คืนไม่ได้`)) return;
    const result = await onDelete(p.id);
    if (!result.ok) setError(result.error || 'ลบไม่สำเร็จ');
  }

  // Policies on OTHER tickets for the same car — the "รถคันนี้เคยทำประกันอะไรไว้"
  // question, which is about the car and not about this job.
  const elsewhere = forPlate.filter((p) => p.ticketId && p.ticketId !== t.id);

  return (
    <div className="mt-2 ml-6">
      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--primary)' }}>
        <i className="fa-solid fa-shield-halved mr-1.5"></i>ประกันฟิล์มกันรอย
        <span className="ml-1.5 font-normal" style={{ color: 'var(--ink-soft)' }}>
          {policies.length ? `${policies.length} ฉบับ` : 'ยังไม่มี'}
        </span>
      </p>

      {policies.map((p) => {
        const left = remainingCover(p);
        const days = daysLeft(p.endsAt);
        return (
          <div
            key={p.id}
            className="rounded-xl p-2.5 mb-2 flex items-start justify-between gap-2"
            style={{ background: '#fff', border: '1px solid var(--line)' }}
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold">
                {p.planName || 'ประกัน'}
                <span className="font-normal ml-1.5" style={{ color: 'var(--ink-soft)' }}>
                  {p.price.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท · ขาย{' '}
                  {p.soldAt ? fmtThaiDate(new Date(p.soldAt)) : '-'}
                </span>
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                {coverageText(p.bigPieces, p.smallPieces)} · เหลือ {left.big} ชิ้นใหญ่, {left.small}{' '}
                ชิ้นเล็ก
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                คุ้มครอง {p.startsAt ? fmtThaiDate(new Date(p.startsAt)) : '-'} ถึง{' '}
                {p.endsAt ? fmtThaiDate(new Date(p.endsAt)) : '-'}
                {days != null && days < 0 && (
                  <span className="ml-1.5 font-semibold" style={{ color: '#B23A48' }}>
                    หมดอายุแล้ว
                  </span>
                )}
                {days != null && days >= 0 && days <= EXPIRY_WARNING_DAYS && (
                  <span className="ml-1.5 font-semibold" style={{ color: '#B26A00' }}>
                    เหลืออีก {days} วัน
                  </span>
                )}
              </p>
              {p.claims.length > 0 && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                  เคลมแล้ว {p.claims.length} ครั้ง
                </p>
              )}
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <button
                onClick={() => startEdit(p)}
                className="btn-outline text-xs px-2.5 py-1 rounded-lg"
                aria-label={`แก้ไขประกัน ${p.planName || 'ประกัน'}`}
              >
                <i className="fa-solid fa-pen"></i>
              </button>
              <button
                onClick={() => onPrint(p)}
                className="btn-outline text-xs px-2.5 py-1 rounded-lg"
                aria-label={`พิมพ์ใบเสร็จประกัน ${p.planName || 'ประกัน'}`}
              >
                <i className="fa-solid fa-receipt mr-1"></i>ใบเสร็จ
              </button>
              <button
                onClick={() => onPrintClaim(p, null)}
                className="btn-outline text-xs px-2.5 py-1 rounded-lg"
                aria-label={`พิมพ์ใบเคลมประกัน ${p.planName || 'ประกัน'}`}
              >
                <i className="fa-solid fa-clipboard-check mr-1"></i>ใบเคลม
              </button>
              {canDelete && (
                <button
                  onClick={() => remove(p)}
                  className="text-xs px-2 rounded-lg"
                  style={{ color: '#B23A48' }}
                  aria-label={`ลบประกัน ${p.planName || 'ประกัน'}`}
                >
                  <i className="fa-solid fa-trash"></i>
                </button>
              )}
            </div>
          </div>
        );
      })}

      {elsewhere.length > 0 && (
        <p className="text-xs mb-2" style={{ color: 'var(--ink-faint)' }}>
          รถทะเบียน <b>{t.plate}</b> เคยทำประกันจากใบงานอื่นอีก {elsewhere.length} ฉบับ (
          {elsewhere
            .map(
              (p) => `${p.planName || 'ประกัน'} ${p.endsAt ? fmtThaiDate(new Date(p.endsAt)) : ''}`,
            )
            .join(' · ')}
          )
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
        <button onClick={startNew} className="btn-outline text-xs px-3 py-1.5 rounded-lg">
          <i className="fa-solid fa-plus mr-1.5"></i>บันทึกประกันฉบับใหม่
        </button>
      )}

      {draft && (
        <div
          className="rounded-xl p-3 mt-1"
          style={{ background: '#fff', border: '1px solid var(--line)' }}
        >
          <p className="text-xs font-semibold mb-2">
            {draft.id ? 'แก้ไขประกัน' : 'ประกันฉบับใหม่'}
          </p>

          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            แผนประกัน
          </label>
          <select
            aria-label="แผนประกัน"
            value={draft.planName}
            onChange={(e) => applyPlan(e.target.value)}
            className="field w-full text-xs px-2.5 py-1.5 mb-2.5"
          >
            <option value="">เลือกแผน...</option>
            {usable.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
            {/* A plan that has since been renamed or retired still has to show,
                or editing an old policy would silently blank its own plan. */}
            {draft.planName && !usable.some((p) => p.name === draft.planName) && (
              <option value={draft.planName}>{draft.planName}</option>
            )}
          </select>

          <div className="grid grid-cols-2 gap-2 mb-2.5">
            <div>
              <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                ราคา (บาท)
              </label>
              <input
                aria-label="ราคาประกัน"
                type="number"
                value={draft.price}
                onChange={(e) => set('price', Number(e.target.value))}
                className="field w-full text-xs px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                วันที่ขาย
              </label>
              <input
                aria-label="วันที่ขายประกัน"
                type="date"
                value={draft.soldAt}
                onChange={(e) => set('soldAt', e.target.value)}
                className="field w-full text-xs px-2.5 py-1.5"
              />
            </div>
          </div>
          {/* Said plainly, because it is the whole reason this is not a ticket
              line: the money lands on the day the policy was sold. */}
          <p className="text-xs mb-2.5" style={{ color: 'var(--ink-faint)' }}>
            รายได้จะเข้าวันที่ขายนี้ ไม่กระทบยอดขายของใบงาน
          </p>

          <div className="grid grid-cols-2 gap-2 mb-1">
            <div>
              <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                ความคุ้มครอง — ชิ้นใหญ่
              </label>
              <input
                aria-label="ความคุ้มครองชิ้นใหญ่"
                type="number"
                value={draft.bigPieces}
                onChange={(e) => set('bigPieces', Number(e.target.value))}
                className="field w-full text-xs px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                ชิ้นเล็ก
              </label>
              <input
                aria-label="ความคุ้มครองชิ้นเล็ก"
                type="number"
                value={draft.smallPieces}
                onChange={(e) => set('smallPieces', Number(e.target.value))}
                className="field w-full text-xs px-2.5 py-1.5"
              />
            </div>
          </div>
          {/* #3F6B33, not the #4C7A3E used for figures on white: this panel
              renders through ExtrasSection inside form section 2, whose items
              fill is #EAF4F2 — #4C7A3E measures 4.50:1 there, on the AA line.
              #3F6B33 is SECTION_TONES.payment.ink, the same green the form is
              built from, at 5.57:1 on this fill. */}
          <p className="text-xs mb-2.5 font-semibold" style={{ color: '#3F6B33' }}>
            {coverageText(draft.bigPieces, draft.smallPieces)}
          </p>

          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            เงื่อนไขความคุ้มครองเพิ่มเติม
          </label>
          <textarea
            aria-label="เงื่อนไขความคุ้มครอง"
            value={draft.terms}
            onChange={(e) => set('terms', e.target.value)}
            rows={2}
            placeholder="เช่น ไม่คุ้มครองความเสียหายจากอุบัติเหตุ"
            className="field w-full text-xs px-2.5 py-1.5 mb-2.5"
          />

          <div className="grid grid-cols-2 gap-2 mb-2.5">
            <div>
              <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                วันเริ่มคุ้มครอง
              </label>
              <input
                aria-label="วันเริ่มคุ้มครอง"
                type="date"
                value={draft.startsAt}
                onChange={(e) => set('startsAt', e.target.value)}
                className="field w-full text-xs px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                วันหมดอายุ
              </label>
              <input
                aria-label="วันหมดอายุประกัน"
                type="date"
                value={draft.endsAt}
                onChange={(e) => set('endsAt', e.target.value)}
                className="field w-full text-xs px-2.5 py-1.5"
              />
            </div>
          </div>

          {/* การเคลม. Counted, so the row above can say what is left. */}
          <div className="pt-2 mb-2" style={{ borderTop: '1px dashed var(--line)' }}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-xs font-semibold">การเคลม</p>
              <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                เหลือ {remainingCover(draft).big} ชิ้นใหญ่, {remainingCover(draft).small} ชิ้นเล็ก
              </p>
            </div>
            {draft.claims.map((c, i) => (
              <div key={i} className="rounded-lg p-2 mb-1.5" style={{ background: 'var(--paper)' }}>
                <div className="grid grid-cols-3 gap-2 mb-1.5">
                  <input
                    aria-label={`วันที่เคลมครั้งที่ ${i + 1}`}
                    type="date"
                    value={c.claimedAt}
                    onChange={(e) => setClaim(i, 'claimedAt', e.target.value)}
                    className="field text-xs px-2 py-1"
                  />
                  <input
                    aria-label={`ชิ้นใหญ่ที่ใช้ครั้งที่ ${i + 1}`}
                    type="number"
                    value={c.bigUsed}
                    onChange={(e) => setClaim(i, 'bigUsed', Number(e.target.value))}
                    placeholder="ชิ้นใหญ่"
                    className="field text-xs px-2 py-1"
                  />
                  <input
                    aria-label={`ชิ้นเล็กที่ใช้ครั้งที่ ${i + 1}`}
                    type="number"
                    value={c.smallUsed}
                    onChange={(e) => setClaim(i, 'smallUsed', Number(e.target.value))}
                    placeholder="ชิ้นเล็ก"
                    className="field text-xs px-2 py-1"
                  />
                </div>
                {/*
                  วันรับรถ/ส่งมอบรถ ของการเคลมครั้งนี้.

                  Separate from the job's own dates on purpose: the ใบเคลม used
                  to print the day the film was fitted, which can be a year ago.
                  What the shop has to evidence is the day the customer actually
                  brought the car in for the claim.
                */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-1.5">
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                      วันรับรถ
                    </label>
                    <input
                      aria-label={`วันรับรถเคลมครั้งที่ ${i + 1}`}
                      type="date"
                      value={c.receivedAt ?? ''}
                      onChange={(e) => setClaim(i, 'receivedAt', e.target.value)}
                      className="field text-xs px-2 py-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                      เวลารับรถ
                    </label>
                    <TimeSelect
                      value={c.receivedTime ?? ''}
                      onChange={(v) => setClaim(i, 'receivedTime', v)}
                      ariaLabel={`เวลารับรถเคลมครั้งที่ ${i + 1}`}
                      placeholder="เวลา..."
                      className="field text-xs px-2 py-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                      วันส่งมอบรถ
                    </label>
                    <input
                      aria-label={`วันส่งมอบรถเคลมครั้งที่ ${i + 1}`}
                      type="date"
                      value={c.deliveredAt ?? ''}
                      onChange={(e) => setClaim(i, 'deliveredAt', e.target.value)}
                      className="field text-xs px-2 py-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                      เวลาส่งมอบรถ
                    </label>
                    <TimeSelect
                      value={c.deliveredTime ?? ''}
                      onChange={(v) => setClaim(i, 'deliveredTime', v)}
                      ariaLabel={`เวลาส่งมอบรถเคลมครั้งที่ ${i + 1}`}
                      placeholder="เวลา..."
                      className="field text-xs px-2 py-1 w-full"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    aria-label={`รายละเอียดการเคลมครั้งที่ ${i + 1}`}
                    value={c.detail}
                    onChange={(e) => setClaim(i, 'detail', e.target.value)}
                    placeholder="เคลมอะไร เช่น กันชนหน้า"
                    className="field text-xs px-2 py-1"
                  />
                  <select
                    aria-label={`ช่างที่ทำการเคลมครั้งที่ ${i + 1}`}
                    value={c.technician}
                    onChange={(e) => setClaim(i, 'technician', e.target.value)}
                    className="field text-xs px-2 py-1"
                  >
                    <option value="">ช่างที่ทำ...</option>
                    {technicians.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    {c.technician && !technicians.includes(c.technician) && (
                      <option value={c.technician}>{c.technician}</option>
                    )}
                  </select>
                </div>
                {/* Reprints the sheet for THIS claim. Only for one already saved:
                    a row still being typed has nothing to print. */}
                {draft.id && c.id && (
                  <button
                    onClick={() => onPrintClaim(draft, c)}
                    className="btn-outline text-xs px-2.5 py-1 rounded-lg mt-1.5"
                    aria-label={`พิมพ์ใบเคลมครั้งที่ ${i + 1}`}
                  >
                    <i className="fa-solid fa-print mr-1"></i>พิมพ์ใบเคลมครั้งนี้
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => set('claims', [...draft.claims, blankClaim()])}
              className="btn-outline text-xs px-2.5 py-1 rounded-lg"
            >
              <i className="fa-solid fa-plus mr-1"></i>เพิ่มการเคลม
            </button>
          </div>

          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            หมายเหตุ
          </label>
          <input
            aria-label="หมายเหตุประกัน"
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
            className="field w-full text-xs px-2.5 py-1.5 mb-2.5"
          />

          <div className="flex gap-2">
            <button
              onClick={() => setDraft(null)}
              className="btn-outline flex-1 rounded-lg py-1.5 text-xs"
            >
              ยกเลิก
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="btn-primary flex-1 rounded-lg py-1.5 text-xs font-semibold"
              style={{ opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกประกัน'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
