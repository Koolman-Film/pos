'use client';

import { useState } from 'react';

import { ManagedMultiChipPicker } from '@/components/ui/ManagedMultiChipPicker';
import { fmtThaiDate } from '@/lib/domain/format';
import { dateInputValue } from '@/lib/domain/now';

import { SERVICE_EXTERIOR_PARTS, SERVICE_INTERIOR_PARTS, SERVICE_POINT_ROWS } from '../serviceForm';

import type { ServiceVisit, ServiceVisitPoint, Ticket } from '../types';

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
  film: { type: string; thickness: string; colourCode: string },
): ServiceVisit => ({
  visitNo,
  plate: t.plate,
  receivedAt: dateInputValue(new Date()),
  receivedTime: '',
  deliveredAt: '',
  deliveredTime: '',
  // The person filling this in is the one receiving the car, nine times in ten.
  salesBy: currentUserName,
  qcBy: '',
  technicians: [],
  filmType: film.type,
  filmThickness: film.thickness,
  filmColourCode: film.colourCode,
  customerWaits: null,
  overallOk: null,
  checks: {},
  notes: '',
  points: [],
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
  film,
  canDelete,
  onSave,
  onDelete,
  onPrint,
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
  /** ประเภท/ความหนา/รหัสสี as the ticket records them — never asked again here. */
  film: { type: string; thickness: string; colourCode: string };
  canDelete: boolean;
  onSave: (visit: ServiceVisit) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /** Prints one recorded visit, or a blank sheet when given null. */
  onPrint: (visit: ServiceVisit | null) => void;
}) {
  const used = visits.length;
  const [draft, setDraft] = useState<ServiceVisit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setError(null);
    setDraft(empty(used + 1, t, currentUserName, film));
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
    if (!window.confirm(`ลบบันทึกการเซอร์วิสครั้งที่ ${v.visitNo}?\n\nลบแล้วกู้คืนไม่ได้`)) return;
    const result = await onDelete(v.id);
    if (!result.ok) setError(result.error || 'ลบไม่สำเร็จ');
  }

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px dashed var(--line)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--primary)' }}>
          <i className="fa-solid fa-screwdriver-wrench mr-1.5"></i>ประวัติการเซอร์วิส
          <span className="ml-1.5 font-normal" style={{ color: 'var(--ink-soft)' }}>
            {entitled > 0 ? `ใช้ไป ${used} / ${entitled} ครั้ง` : `บันทึกแล้ว ${used} ครั้ง`}
          </span>
        </p>
        {entitled > 0 && used >= entitled && (
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: '#FBEAEC', color: '#B23A48' }}
          >
            ครบสิทธิ์แล้ว
          </span>
        )}
      </div>

      {visits.length === 0 && (
        <p className="text-xs mb-2" style={{ color: 'var(--ink-faint)' }}>
          ยังไม่มีการเซอร์วิส
        </p>
      )}
      {visits.map((v) => (
        <div
          key={v.id ?? v.visitNo}
          className="rounded-xl p-2.5 mb-2 flex items-start justify-between gap-2"
          style={{ background: '#fff', border: '1px solid var(--line)' }}
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold">
              ครั้งที่ {v.visitNo}
              <span className="font-normal ml-1.5" style={{ color: 'var(--ink-soft)' }}>
                {v.receivedAt ? fmtThaiDate(new Date(v.receivedAt)) : 'ยังไม่ระบุวันที่'}
              </span>
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
              {v.technicians.length ? v.technicians.join(', ') : 'ยังไม่ระบุช่าง'}
              {' · '}
              {v.points.length ? `${v.points.length} จุดแก้ไข` : 'ไม่มีจุดแก้ไข'}
              {v.overallOk === true ? ' · รอบคันปกติ' : v.overallOk === false ? ' · พบปัญหา' : ''}
            </p>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => startEdit(v)}
              className="btn-outline text-xs px-2.5 py-1 rounded-lg"
              aria-label={`แก้ไขการเซอร์วิสครั้งที่ ${v.visitNo}`}
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
                aria-label={`ลบการเซอร์วิสครั้งที่ ${v.visitNo}`}
              >
                <i className="fa-solid fa-trash"></i>
              </button>
            )}
          </div>
        </div>
      ))}

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
        <div className="flex gap-2">
          <button
            onClick={startNew}
            className="btn-outline flex-1 text-xs rounded-xl py-2 font-medium flex items-center justify-center gap-1.5"
          >
            <i className="fa-solid fa-plus"></i>บันทึกการเซอร์วิสครั้งใหม่
          </button>
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

      {draft && (
        <div
          className="rounded-xl p-3 mt-1"
          style={{ background: '#fff', border: '1.5px solid var(--primary)' }}
        >
          <p className="text-xs font-bold mb-2.5">
            {draft.id
              ? `แก้ไขการเซอร์วิสครั้งที่ ${draft.visitNo}`
              : `การเซอร์วิสครั้งที่ ${draft.visitNo}`}
          </p>

          <div className="grid grid-cols-2 gap-2 mb-2.5">
            <div>
              <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                วันรับรถ
              </label>
              <input
                type="date"
                aria-label="วันรับรถ"
                value={draft.receivedAt}
                onChange={(e) => set('receivedAt', e.target.value)}
                className="field w-full text-xs px-2.5 py-1.5"
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
              <input
                type="date"
                aria-label="วันส่งมอบรถ"
                value={draft.deliveredAt}
                onChange={(e) => set('deliveredAt', e.target.value)}
                className="field w-full text-xs px-2.5 py-1.5"
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
            Read from the ticket, not asked again: ประเภทฟิล์ม comes off the
            ฟิล์มกันรอย product's name, ความหนา and รหัสสี from the Service block
            above. The visit still STORES its own copy, so reprinting an old
            sheet shows what was true that day.
          */}
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            ประเภทฟิล์ม / ความหนา / รหัสสี
          </label>
          <p
            className="text-xs mb-2.5 px-2.5 py-1.5 rounded-lg"
            style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}
          >
            {[draft.filmType, draft.filmThickness, draft.filmColourCode].filter(Boolean).join(' · ')
              ? [draft.filmType, draft.filmThickness, draft.filmColourCode]
                  .filter(Boolean)
                  .join(' · ')
              : 'ยังไม่ได้ระบุในใบงาน'}
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
              {saving ? 'กำลังบันทึก...' : 'บันทึกการเซอร์วิส'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
