'use client';

import { useState } from 'react';

import { FilePreview } from '@/components/ui/FilePreview';
import { fileNameFromPath } from '@/lib/storage/attachments';

/**
 * ไฟล์ที่แนบไว้แล้ว — ชื่อที่กดแล้วเปิดดูได้จริง.
 *
 * ทุก bucket ในระบบเป็นแบบส่วนตัว ชื่อไฟล์ที่พิมพ์ออกมาเฉย ๆ จึงเป็นทางตัน: คน
 * อ่านรู้ว่ามีไฟล์อยู่ แต่เปิดไม่ได้ ต้องไปหาในแชทหรือในเครื่องของคนที่แนบเอา
 * ซึ่งแปลว่าหลักฐานที่บังคับให้แนบ ไม่เคยถูกใช้ตรวจสอบเลยสักครั้ง (ร้านเจอใน
 * ขายส่ง 26 ต.ค. 2569)
 *
 * ลิงก์ถูกขอทีละครั้งตอนกด ไม่ใช่ขอล่วงหน้าทั้งหน้า — มันมีอายุหนึ่งนาที และ
 * หน้าที่โชว์ PO สิบใบไม่ควรยิงขอลิงก์ที่ไม่มีใครกดดูสามสิบเส้น
 *
 * `variant` แยกสองที่ใช้: `chip` คือในฟอร์มที่ไฟล์เป็นของชิ้นหนึ่งที่จับต้องได้
 * ส่วน `inline` คือบรรทัดสรุปในการ์ดที่แน่นอยู่แล้ว ซึ่งชิปเขียวจะกินที่เกินตัว
 */
export function AttachmentLinks({
  paths,
  urlAction,
  variant = 'inline',
  onRemove,
}: {
  /** Storage paths — the bucket is whatever `urlAction` signs against. */
  paths: string[];
  /** ไม่ส่งมา = ไม่มีสิทธิ์เปิด ชื่อไฟล์จึงเป็นข้อความเฉย ๆ ไม่ใช่ปุ่มที่กดแล้วเงียบ */
  urlAction?: (path: string) => Promise<{ url?: string; error?: string }>;
  variant?: 'chip' | 'inline';
  /** ลบไฟล์ออกจากรายการ — ไม่ส่งมาคือดูได้อย่างเดียว */
  onRemove?: (path: string) => void;
}) {
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(path: string) {
    if (!urlAction) return;
    setError(null);
    setOpeningPath(path);
    try {
      const res = await urlAction(path);
      if (res.url) setPreview({ url: res.url, fileName: fileNameFromPath(path) });
      else setError(res.error || 'เปิดไฟล์ไม่สำเร็จ');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปิดไฟล์ไม่สำเร็จ');
    } finally {
      setOpeningPath(null);
    }
  }

  if (paths.length === 0) return null;

  /** ชื่อไฟล์ + สถานะกำลังเปิด — เหมือนกันทั้งสองแบบ ต่างแค่กรอบที่ห่อ */
  const name = (path: string) => (
    <>
      <i
        className={`fa-solid ${
          openingPath === path
            ? 'fa-spinner fa-spin'
            : variant === 'chip'
              ? 'fa-circle-check'
              : 'fa-paperclip'
        } ${variant === 'chip' ? '' : 'mr-1'}`}
      ></i>
      <span className="truncate" style={{ maxWidth: 160 }}>
        {fileNameFromPath(path)}
      </span>
    </>
  );

  return (
    <>
      <div
        className={
          variant === 'chip' ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap items-center gap-x-2'
        }
      >
        {paths.map((path) =>
          variant === 'chip' ? (
            <span
              key={path}
              className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-lg"
              style={{ background: 'var(--paper)', color: '#4C7A3E' }}
            >
              <button
                type="button"
                onClick={() => open(path)}
                className="flex items-center gap-1.5"
                disabled={!urlAction}
                title={urlAction ? `ดู ${fileNameFromPath(path)}` : fileNameFromPath(path)}
              >
                {name(path)}
              </button>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(path)}
                  aria-label={`เอา ${fileNameFromPath(path)} ออก`}
                  style={{ color: '#B23A48' }}
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              )}
            </span>
          ) : (
            <button
              key={path}
              type="button"
              onClick={() => open(path)}
              disabled={!urlAction}
              title={urlAction ? `ดู ${fileNameFromPath(path)}` : fileNameFromPath(path)}
              className={`text-xs flex items-center ${urlAction ? 'underline' : ''}`}
              style={{
                color: urlAction ? 'var(--primary)' : 'var(--ink-faint)',
                textUnderlineOffset: 2,
              }}
            >
              {name(path)}
            </button>
          ),
        )}
      </div>

      {error && (
        <p className="text-xs" style={{ color: '#B23A48' }} role="alert">
          {error}
        </p>
      )}

      {preview && (
        <FilePreview
          url={preview.url}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
