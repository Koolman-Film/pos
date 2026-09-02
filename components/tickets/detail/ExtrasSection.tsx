'use client';

import { useState } from 'react';

import { TimeSelect } from '@/components/ui/TimeSelect';

import { findProductStock } from '../serviceForm';

import type { StockRow, Ticket, TicketExtra } from '../types';

type SlideLeg = { from?: string; to?: string; date?: string; time?: string };

/** บริการเสริม (optional extras). Ported from reference/v0.4/finnix-film.html:1761-1860. */
export function ExtrasSection({
  t,
  extraOptions,
  setExtraOptions,
  slideTypes,
  stock,
  toggleExtra,
  updateExtraDetail,
  setSlideType,
  updateSlideLeg,
  shareLink,
  insurance,
  serviceVisits,
}: {
  t: Ticket;
  extraOptions: string[];
  setExtraOptions: (v: string[]) => void;
  slideTypes: string[];
  stock: StockRow[];
  toggleExtra: (name: string) => void;
  updateExtraDetail: (name: string, key: string, val: unknown) => void;
  setSlideType: (st: string) => void;
  updateSlideLeg: (legIdx: number, key: string, val: unknown) => void;
  shareLink: (link?: string) => void;
  /**
   * Renders the service-visit record inside the Service extra. A render prop so
   * this component stays a pure form and does not need the ticket actions.
   */
  /**
   * Renders the ประกัน record inside the ประกัน extra. Same shape as
   * `serviceVisits`: a render prop keeps this component a pure form.
   */
  insurance?: () => React.ReactNode;
  serviceVisits?: (args: {
    entitled: number;
    /** ชื่อสินค้าฟิล์มที่ขาย — the SKU name already states the thickness. */
    filmProduct: string;
    /** ช่างที่รับผิดชอบหมวดฟิล์มกันรอย — seeds ทีมช่าง on a new visit. */
    assignedTechnicians: string[];
  }) => React.ReactNode;
}) {
  // The ชนิดสินค้า on this ticket, which is what a rework can be about.
  const reworkCategories = [...new Set(t.items.map((i) => i.category).filter(Boolean))];
  const [showOptional, setShowOptional] = useState(false);
  const [addingExtra, setAddingExtra] = useState(false);
  const [newExtraName, setNewExtraName] = useState('');

  return (
    <div className="mb-5">
      <button
        onClick={() => setShowOptional(!showOptional)}
        className="text-sm font-semibold mb-3 flex items-center gap-2"
        style={{ color: 'var(--primary)' }}
      >
        <i className="fa-solid fa-sliders"></i>ข้อมูลเพิ่มเติม (กรอกทีหลังได้){' '}
        <i
          className={`fa-solid fa-chevron-${showOptional ? 'up' : 'down'} text-xs transition-transform`}
        ></i>
      </button>
      <div className="fade-page">
        <p
          className="text-xs font-medium mb-3 flex items-center gap-1.5"
          style={{ color: 'var(--ink-soft)' }}
        >
          <i className="fa-solid fa-list-check"></i>บริการเสริม
        </p>
        {extraOptions.map((name) => {
          const ex: TicketExtra = t.extras?.[name] || {};
          if (!showOptional && !ex.checked) return null;
          const wrapItem = t.items.find((i) => i.category === 'ฟิล์มกันรอย' && i.sold);
          const wrapStock = wrapItem ? findProductStock(stock, wrapItem.sold) : null;
          const legs = (ex.legs as SlideLeg[]) || [];
          return (
            <div key={name} className="mb-3 group">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!ex.checked}
                    onChange={() => toggleExtra(name)}
                    className="w-4 h-4"
                  />
                  <span className="font-medium">{name}</span>
                </label>
                <button
                  onClick={() => setExtraOptions(extraOptions.filter((x) => x !== name))}
                  className="row-action text-xs px-1"
                  style={{ color: '#B23A48' }}
                  aria-label={`ลบ ${name}`}
                >
                  <i className="fa-solid fa-trash"></i>
                </button>
              </div>
              {ex.checked && name === 'ประกัน' && insurance && insurance()}
              {ex.checked && name === 'นอกสถานที่' && (
                <div className="mt-2 ml-6 flex flex-col gap-2">
                  <input
                    value={(ex.mapLabel as string) || ''}
                    onChange={(e) => updateExtraDetail(name, 'mapLabel', e.target.value)}
                    placeholder="หัวข้ออธิบายแผนที่ เช่น บ้านลูกค้า ซอย 5"
                    className="field text-sm px-3 py-2"
                  />
                  <div className="flex gap-2">
                    <input
                      value={(ex.mapLink as string) || ''}
                      onChange={(e) => updateExtraDetail(name, 'mapLink', e.target.value)}
                      placeholder="วางลิงก์ Google Maps ที่นี่"
                      className="field flex-1 text-sm px-3 py-2"
                    />
                    <button
                      onClick={() => shareLink(ex.mapLink as string)}
                      className="btn-outline px-3 rounded-lg text-xs"
                      title="แชร์ลิงก์"
                      aria-label="แชร์ลิงก์"
                    >
                      <i className="fa-solid fa-share-nodes"></i>
                    </button>
                  </div>
                </div>
              )}
              {ex.checked && name === 'รถสไลด์' && (
                <div className="mt-2 ml-6">
                  <div className="flex flex-wrap gap-2 mb-2.5">
                    {slideTypes.map((st) => (
                      <button
                        key={st}
                        onClick={() => setSlideType(st)}
                        className="text-xs px-3 py-1.5 rounded-full font-semibold"
                        style={{
                          background: ex.slideType === st ? 'var(--primary)' : 'var(--paper)',
                          color: ex.slideType === st ? '#fff' : 'var(--ink-soft)',
                          border: ex.slideType === st ? 'none' : '1px solid var(--line)',
                        }}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                  {ex.slideType === 'Walk-in' &&
                    legs.map((leg, legIdx) => (
                      <div
                        key={legIdx}
                        className="rounded-xl p-2.5 mb-2"
                        style={{ background: 'var(--paper)' }}
                      >
                        <p className="text-xs font-semibold mb-1.5">ถึงหน้าร้าน</p>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="date"
                            value={leg.date || ''}
                            onChange={(e) => updateSlideLeg(legIdx, 'date', e.target.value)}
                            className="field text-xs px-2.5 py-1.5"
                          />
                          <TimeSelect
                            value={leg.time || ''}
                            onChange={(v) => updateSlideLeg(legIdx, 'time', v)}
                            placeholder="เวลา..."
                            className="field w-full text-xs px-2.5 py-1.5"
                          />
                        </div>
                      </div>
                    ))}
                  {ex.slideType === 'Showroom' &&
                    legs.map((leg, legIdx) => (
                      <div
                        key={legIdx}
                        className="rounded-xl p-2.5 mb-2"
                        style={{ background: 'var(--paper)' }}
                      >
                        <p className="text-xs font-semibold mb-1.5">ขาที่ {legIdx + 1}</p>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input
                            value={leg.from || ''}
                            onChange={(e) => updateSlideLeg(legIdx, 'from', e.target.value)}
                            placeholder="จากที่ไหน"
                            className="field text-xs px-2.5 py-1.5"
                          />
                          <input
                            value={leg.to || ''}
                            onChange={(e) => updateSlideLeg(legIdx, 'to', e.target.value)}
                            placeholder="ถึงที่ไหน"
                            className="field text-xs px-2.5 py-1.5"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="date"
                            value={leg.date || ''}
                            onChange={(e) => updateSlideLeg(legIdx, 'date', e.target.value)}
                            className="field text-xs px-2.5 py-1.5"
                          />
                          <TimeSelect
                            value={leg.time || ''}
                            onChange={(v) => updateSlideLeg(legIdx, 'time', v)}
                            placeholder="เวลา..."
                            className="field w-full text-xs px-2.5 py-1.5"
                          />
                        </div>
                      </div>
                    ))}
                  {ex.slideType === 'สไลด์ส่วนตัว' && (
                    <p className="text-xs mb-2" style={{ color: 'var(--ink-faint)' }}>
                      ลูกค้าจัดการเดินทางเอง ไม่ต้องระบุขา
                    </p>
                  )}
                  <textarea
                    value={(ex.notes as string) || ''}
                    onChange={(e) => updateExtraDetail(name, 'notes', e.target.value)}
                    placeholder="ข้อมูลเพิ่มเติม (ถ้ามี)"
                    rows={2}
                    className="field w-full text-xs px-2.5 py-1.5 mt-1"
                    style={{ resize: 'vertical' }}
                  />
                </div>
              )}
              {ex.checked && name === 'แก้งาน' && (
                <div className="mt-2 ml-6">
                  {/* A textarea, not a one-line input: this is where the shop
                      writes what actually has to be redone, and it prints in
                      full on the job sheet. */}
                  <textarea
                    value={(ex.detail as string) || ''}
                    onChange={(e) => updateExtraDetail(name, 'detail', e.target.value)}
                    placeholder="รายละเอียดการแก้"
                    rows={2}
                    className="field w-full text-sm px-3 py-2"
                    style={{ resize: 'vertical' }}
                  />
                  {/*
                    วันที่ของงานแก้เอง. The car comes back on its own day and goes
                    home on another, and neither is the original job's — writing
                    them over the ticket dates would lose when the work was
                    actually done, which is the thing a warranty argument turns on.
                  */}
                  {/* Which product the rework is on. Only worth asking when the
                      ticket carries more than one: ใบงานติดตั้ง prints a page per
                      ชนิดสินค้า, and a rework on the film is not a rework on the
                      speakers. */}
                  {reworkCategories.length > 1 && (
                    <div className="mt-2">
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        แก้สินค้าชนิดไหน
                      </label>
                      <select
                        aria-label="ชนิดสินค้าที่แก้"
                        value={(ex.category as string) || ''}
                        onChange={(e) => updateExtraDetail(name, 'category', e.target.value)}
                        className="field w-full text-sm px-3 py-2"
                      >
                        <option value="">ทุกชนิดสินค้าในใบงานนี้</option>
                        {reworkCategories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* Times as well as dates, so the ใบงานติดตั้ง and the
                      dashboard say when the customer is actually due — the
                      same pair a เซอร์วิส visit records. */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                    <div>
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        วันที่รับงาน (งานแก้)
                      </label>
                      <input
                        type="date"
                        aria-label="วันที่รับงานแก้"
                        value={(ex.receivedAt as string) || ''}
                        onChange={(e) => updateExtraDetail(name, 'receivedAt', e.target.value)}
                        className="field w-full text-sm px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        เวลารับงาน
                      </label>
                      <TimeSelect
                        value={(ex.receivedTime as string) || ''}
                        onChange={(v) => updateExtraDetail(name, 'receivedTime', v)}
                        ariaLabel="เวลารับงานแก้"
                        placeholder="เวลา..."
                        className="field w-full text-sm px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        วันที่ส่งงาน (งานแก้)
                      </label>
                      <input
                        type="date"
                        aria-label="วันที่ส่งงานแก้"
                        value={(ex.deliveredAt as string) || ''}
                        onChange={(e) => updateExtraDetail(name, 'deliveredAt', e.target.value)}
                        className="field w-full text-sm px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                        เวลาส่งงาน
                      </label>
                      <TimeSelect
                        value={(ex.deliveredTime as string) || ''}
                        onChange={(v) => updateExtraDetail(name, 'deliveredTime', v)}
                        ariaLabel="เวลาส่งงานแก้"
                        placeholder="เวลา..."
                        className="field w-full text-sm px-3 py-2"
                      />
                    </div>
                  </div>
                </div>
              )}
              {ex.checked && name === 'Service' && (
                <div className="mt-2 ml-6">
                  {wrapItem ? (
                    <>
                      <p className="text-xs mb-2" style={{ color: 'var(--ink-soft)' }}>
                        สินค้า: {wrapStock?.name ?? wrapItem.sold}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                            จำนวนครั้ง
                          </label>
                          <input
                            type="number"
                            value={
                              (ex.serviceCount as string | number) ?? wrapStock?.serviceCount ?? ''
                            }
                            onChange={(e) =>
                              updateExtraDetail(name, 'serviceCount', e.target.value)
                            }
                            className="field text-xs px-2.5 py-1.5 w-full"
                          />
                        </div>
                        <div>
                          <label className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                            วันที่เข้า Service
                          </label>
                          <input
                            type="date"
                            value={(ex.serviceDate as string) || ''}
                            onChange={(e) => updateExtraDetail(name, 'serviceDate', e.target.value)}
                            className="field text-xs px-2.5 py-1.5 w-full"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                      ยังไม่มีสินค้าหมวด &quot;ฟิล์มกันรอย&quot; ในใบงานนี้
                      เพิ่มก่อนเพื่อดึงข้อมูลบริการ
                    </p>
                  )}
                  {/*
                    The visits themselves. Above this point the ticket only says
                    how many were SOLD; this is the record of the ones that
                    happened — which is what "รถคันนี้เซอร์วิสไปกี่ครั้งแล้ว"
                    needs. Only rendered for a saved ticket: a visit is a child
                    row and has nothing to hang off until the ticket has an id.
                  */}
                  {serviceVisits &&
                    serviceVisits({
                      entitled: Number(ex.serviceCount ?? wrapStock?.serviceCount ?? 0) || 0,
                      filmProduct: wrapStock?.name ?? wrapItem?.sold ?? '',
                      assignedTechnicians: t.techByCategory?.['ฟิล์มกันรอย'] ?? [],
                    })}
                </div>
              )}
            </div>
          );
        })}
        {addingExtra ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={newExtraName}
              onChange={(e) => setNewExtraName(e.target.value)}
              placeholder="ชื่อตัวเลือกใหม่"
              className="field flex-1 text-sm px-3 py-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (newExtraName.trim()) setExtraOptions([...extraOptions, newExtraName.trim()]);
                  setAddingExtra(false);
                  setNewExtraName('');
                }
                if (e.key === 'Escape') setAddingExtra(false);
              }}
            />
            <button
              onClick={() => {
                if (newExtraName.trim()) setExtraOptions([...extraOptions, newExtraName.trim()]);
                setAddingExtra(false);
                setNewExtraName('');
              }}
              className="btn-primary px-3 rounded-lg text-xs font-semibold"
            >
              เพิ่ม
            </button>
            <button
              onClick={() => setAddingExtra(false)}
              className="btn-outline px-3 rounded-lg text-xs"
            >
              ยกเลิก
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingExtra(true)}
            className="btn-outline text-xs px-3 py-1.5 rounded-full"
          >
            <i className="fa-solid fa-plus mr-1"></i>เพิ่มตัวเลือกใหม่
          </button>
        )}
      </div>
    </div>
  );
}
