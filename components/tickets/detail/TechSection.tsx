'use client';

import { useState } from 'react';

import { ManagedMultiChipPicker } from '@/components/ui/ManagedMultiChipPicker';

import type { Ticket } from '../types';

const labelCls = 'text-xs font-medium block mb-1';

/**
 * ข้อมูลของช่าง — QC photos, install-confirmation form, and per-category
 * technician assignment + actual-quantity entry (which decrements stock).
 * Ported from reference/v0.4/finnix-film.html:1657-1760.
 */
export function TechSection({
  t,
  field,
  technicians,
  setTechnicians,
  updateActualQty,
  confirmInstall,
  shareQcAlbum,
  shopName,
}: {
  t: Ticket;
  field: (key: keyof Ticket, value: unknown) => void;
  technicians: string[];
  setTechnicians: (v: string[]) => void;
  updateActualQty: (idx: number, productName: string, newQty: string) => void;
  confirmInstall: () => void;
  shareQcAlbum: () => void;
  shopName: (id: string) => string;
}) {
  const [showQcPreview, setShowQcPreview] = useState(false);

  const qcCategories = [...new Set(t.items.filter((i) => i.sold).map((i) => i.category))].filter(
    (c) => c === 'ฟิล์มกรองแสง' || c === 'ฟิล์มกันรอย',
  );
  const showInstallConfirm = !!(t.qcPhotos && t.qcPhotos.length > 0) && qcCategories.length > 0;

  return (
    <div className="mb-5 pt-5" style={{ borderTop: '1px solid var(--line)' }}>
      <p
        className="text-xs font-medium mb-3 flex items-center gap-1.5"
        style={{ color: 'var(--ink-soft)' }}
      >
        <i className="fa-solid fa-user-gear"></i>ข้อมูลของช่าง{' '}
        <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>
          (แยกตามชนิดสินค้า เพราะแต่ละชนิดใช้ช่างคนละคนและตัดสต็อกต่างกัน)
        </span>
      </p>
      <div className="mb-3 rounded-xl p-3" style={{ background: 'var(--paper)' }}>
        <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
          <i className="fa-solid fa-camera mr-1"></i>QC ก่อนติดตั้ง
        </label>
        <label
          className="text-xs flex items-center gap-1.5 field px-2.5 py-1.5 cursor-pointer mt-1"
          style={{ color: 'var(--ink-soft)' }}
        >
          <i className="fa-solid fa-camera"></i>
          แนบรูป QC ก่อนติดตั้ง (เลือกได้หลายไฟล์)...
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length)
                field('qcPhotos', [...(t.qcPhotos || []), ...files.map((f) => f.name)]);
              e.target.value = '';
            }}
          />
        </label>
        {(t.qcPhotos || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {t.qcPhotos!.map((fn, fi) => (
              <span
                key={fi}
                className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
                style={{ background: '#fff', color: '#4C7A3E' }}
              >
                <i className="fa-solid fa-image"></i>
                {fn}
                <i
                  className="fa-solid fa-xmark cursor-pointer"
                  style={{ color: '#B23A48' }}
                  onClick={() =>
                    field(
                      'qcPhotos',
                      t.qcPhotos!.filter((_, fi2) => fi2 !== fi),
                    )
                  }
                ></i>
              </span>
            ))}
          </div>
        )}
      </div>
      {showInstallConfirm && (
        <div
          className="mb-3 rounded-xl p-3"
          style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}
        >
          <p
            className="text-xs font-semibold mb-2 flex items-center gap-1.5"
            style={{ color: 'var(--primary)' }}
          >
            <i className="fa-solid fa-file-signature"></i>แบบฟอร์มการยืนยันการติดตั้ง
          </p>
          {t.installConfirmed ? (
            <p
              className="text-xs font-semibold flex items-center gap-1.5 mb-3"
              style={{ color: '#4C7A3E' }}
            >
              <i className="fa-solid fa-circle-check"></i>ยืนยันการติดตั้งแล้ว &middot;{' '}
              {t.installConfirmedAt}
            </p>
          ) : (
            <button
              onClick={confirmInstall}
              className="btn-primary text-xs px-4 py-2 rounded-lg font-semibold w-full mb-3"
            >
              ยืนยันการติดตั้ง
            </button>
          )}
          <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
            <button
              onClick={shareQcAlbum}
              className="btn-outline text-xs px-4 py-2 rounded-lg font-medium w-full flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-share-nodes"></i>แชร์อัลบั้มรูป QC ให้ลูกค้า (ดูอย่างเดียว)
            </button>
            <button
              onClick={() => setShowQcPreview(!showQcPreview)}
              className="text-xs px-4 py-2 rounded-lg font-medium w-full flex items-center justify-center gap-2"
              style={{ color: 'var(--primary)' }}
            >
              <i className={`fa-solid fa-eye${showQcPreview ? '-slash' : ''}`}></i>
              {showQcPreview
                ? 'ซ่อนตัวอย่างข้อมูลที่แชร์ให้ลูกค้า'
                : 'ดูตัวอย่างข้อมูลที่แชร์ให้ลูกค้า'}
            </button>
          </div>
          {showQcPreview && (
            <div
              className="mt-3 rounded-xl p-4"
              style={{ background: '#fff', border: '1.5px dashed var(--primary)' }}
            >
              <p
                className="text-xs font-semibold mb-3 text-center"
                style={{ color: 'var(--ink-faint)' }}
              >
                ตัวอย่างหน้าที่ลูกค้าเห็น (ดูอย่างเดียว)
              </p>
              <p className="text-sm font-bold mb-1">{shopName(t.shop)}</p>
              <p className="text-xs mb-3" style={{ color: 'var(--ink-soft)' }}>
                ลูกค้า: {t.customer || '-'} &middot; ทะเบียน: {t.plate || '-'}
              </p>
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--primary)' }}>
                <i className="fa-solid fa-camera mr-1"></i>รูป QC ก่อนติดตั้ง (
                {(t.qcPhotos || []).length} รูป)
              </p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(t.qcPhotos || []).map((fn, fi) => (
                  <span
                    key={fi}
                    className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
                    style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}
                  >
                    <i className="fa-solid fa-image"></i>
                    {fn}
                  </span>
                ))}
              </div>
              {qcCategories.includes('ฟิล์มกรองแสง') && (
                <div className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
                  <p className="font-semibold mb-1" style={{ color: 'var(--ink)' }}>
                    ฟิล์มกรองแสง
                  </p>
                  <p className="mb-1">
                    1. การตรวจสภาพรถเป็นการตรวจสภาพก่อนการติดตั้งฟิล์มกรองแสง
                    ไม่ครอบคลุมถึงสภาพตัวรถ และชิ้นส่วนภายหลังจากที่ออกจากศูนย์บริการ
                    หรือมีการใช้งานทุกกรณี
                  </p>
                  <p className="mb-1">
                    2. โปรดนำทรัพย์สินมีค่าออกจากรถของท่านก่อนเข้ารับการบริการ
                    หากทรัพย์สินสูญหายทางร้านจะไม่รับผิดชอบทุกกรณี
                  </p>
                  <p className="mb-1">
                    3. ร้านจะไม่รับผิดชอบต่อความเสียหายใดๆ ทั้งสิ้น
                    ยกเว้นปัญหาที่เกิดจากผลิตภัณฑ์ที่ติดตั้งไปจากร้าน
                  </p>
                  <p>
                    4. ลูกค้าได้รับทราบข้อตกลงทั้งหมดข้างต้น และลงชื่อยินยอมรับทราบข้อตกลงดังกล่าว
                    ก่อนทำการติดตั้ง
                  </p>
                </div>
              )}
              {qcCategories.includes('ฟิล์มกันรอย') && (
                <div className="text-xs leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
                  <p className="font-semibold mb-1" style={{ color: 'var(--ink)' }}>
                    ฟิล์มกันรอย
                  </p>
                  <p className="font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                    แจ้งผลการตรวจสภาพรถและการติดตั้งฟิล์มกันรอย
                  </p>
                  <p className="mb-1.5">
                    ตามที่เจ้าหน้าที่ได้ดำเนินการตรวจสอบสภาพรถของท่านเรียบร้อยแล้ว
                    มีรายละเอียดเพื่อยืนยันการติดตั้งฟิล์มกันรอย ดังนี้ครับ/ค่ะ
                  </p>
                  <ul className="list-disc pl-4 mb-1.5">
                    <li className="mb-1">
                      <b>การรับรองสภาพรถ:</b> ทางร้านได้ตรวจสอบสภาพรถตามข้อเท็จจริงอย่างครบถ้วน
                      หากพบร่องรอยหรือความเสียหายเดิมที่มีอยู่ก่อนแล้ว
                      จะไม่ถือเป็นความรับผิดชอบของทางร้าน
                    </li>
                    <li>
                      <b>กรณีลูกค้าไม่สะดวกตรวจสภาพรถร่วมกัน:</b>{' '}
                      เนื่องจากท่านไม่สามารถอยู่ร่วมตรวจสอบพร้อมกับทางร้านได้
                      ทางร้านจึงขออนุญาตเป็นผู้ดำเนินการตรวจสอบแทน ทั้งนี้ หากพบร่องรอย,
                      ความเสียหายหรือจุดที่มีปัญหาก่อนการติดตั้ง ทางร้านจะรีบแจ้งให้ท่านทราบทันที
                      และรอยดังกล่าวจะไม่ถือเป็นความรับผิดชอบของทางร้าน
                    </li>
                  </ul>
                  <p>
                    ทางร้านจึงเรียนมาเพื่อขอความอนุเคราะห์จากท่านในการตรวจสอบข้อมูลและกดยืนยัน
                    เพื่อให้ทีมงานสามารถดำเนินการติดตั้งฟิล์มกันรอยให้กับรถของท่านได้อย่างราบรื่นต่อไปครับ/ค่ะ
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {[...new Set(t.items.filter((i) => i.sold).map((i) => i.category))].map((cat) => {
        const catItems = t.items.filter((i) => i.sold && i.category === cat);
        const techList = (t.techByCategory && t.techByCategory[cat]) || [];
        return (
          <div key={cat} className="mb-3 rounded-xl p-3" style={{ background: 'var(--paper)' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--primary)' }}>
              {cat}
            </p>
            <div className="mb-3">
              <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                ช่างที่รับผิดชอบ (หมวดนี้)
              </label>
              <ManagedMultiChipPicker
                values={techList}
                onChange={(v) => field('techByCategory', { ...(t.techByCategory || {}), [cat]: v })}
                options={technicians}
                setOptions={setTechnicians}
              />
            </div>
            {t.status !== 'จองแล้ว' && cat !== 'งานบริการ' && (
              <div>
                <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
                  จำนวนสินค้าที่ใช้จริง
                </label>
                {catItems.map((it) => {
                  const realIdx = t.items.indexOf(it);
                  const products =
                    it.positions && it.positions.length
                      ? [...new Set(it.positions.map((p) => p.product).filter(Boolean))]
                      : [it.sold];
                  return products.map((prod) => (
                    <div
                      key={realIdx + '-' + prod}
                      className="flex items-center justify-between gap-2 mb-2"
                    >
                      <span
                        className="text-xs truncate flex-1"
                        style={{ color: 'var(--ink-soft)' }}
                      >
                        {prod}
                      </span>
                      <input
                        type="number"
                        placeholder="จำนวน"
                        value={(it.actualQtyMap && it.actualQtyMap[prod]) || ''}
                        onChange={(e) => updateActualQty(realIdx, prod, e.target.value)}
                        className="field text-xs px-2.5 py-1.5 w-24"
                      />
                    </div>
                  ));
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
