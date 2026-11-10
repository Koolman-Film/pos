'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { cachedSignedUrl, signedUrl, type UrlAction } from '@/lib/storage/signedUrls';

/**
 * ชี้เมาส์ที่ชื่อไฟล์แนบแล้วเห็นไฟล์นั้นเลย ไม่ต้องกด (ร้านขอ 7 พ.ย. 2569).
 *
 * คำถามที่คนถามกับสลิปโอนเงินเกือบทุกครั้งคือ "ใช่ใบนี้ไหม" ซึ่งตอบได้ด้วยการ
 * เห็นภาพครึ่งวินาที แต่เดิมต้องกด → รอเซ็นลิงก์ → หน้าต่างเต็มจอเปิดทับ PO
 * ทั้งใบ → กดปิด สี่จังหวะสำหรับคำถามจังหวะเดียว และเพราะมันแพงขนาดนั้น คน
 * เลยไม่เปิดดู หลักฐานที่บังคับให้แนบจึงไม่เคยถูกใช้ตรวจ
 *
 * การ์ดนี้เป็น "ดูผ่าน ๆ" ไม่ใช่ตัวแทนของหน้าต่างเต็มจอ — กดยังเปิดเต็มจอได้
 * เหมือนเดิม ซึ่งเป็นทางเดียวที่ซูมดูเลขบัญชีตัวเล็ก ๆ หรือกดเปิดแท็บใหม่ได้
 *
 * **บนมือถือไม่มีการชี้** การแตะจึงยังเปิดหน้าต่างเต็มจอตามเดิม ซึ่งก็คือ "แตะ
 * แล้วเห็นไฟล์" อยู่แล้ว ไม่ผูกกดค้างไว้ที่นี่เพราะปล่อยนิ้วแล้วจะเกิด click
 * ตามมาเสมอ การ์ดที่เพิ่งเปิดจะถูกหน้าต่างเต็มจอทับทันที — เป็นสองจังหวะที่
 * ขัดกันเอง ไม่ใช่สองทางเลือก
 */

/** ชี้ผ่านระหว่างกวาดเมาส์ ไม่ใช่ตั้งใจดู — สั้นกว่านี้การ์ดจะเด้งตามเมาส์ไปทั่ว. */
const HOVER_INTENT_MS = 220;

const CARD_W = 260;

export function AttachmentPeek({
  path,
  fileName,
  mimeType = '',
  urlAction,
  children,
}: {
  path: string;
  fileName: string;
  mimeType?: string;
  /** ไม่ส่งมา = ไม่มีสิทธิ์เปิดไฟล์ จึงไม่มีอะไรให้ชี้ดู */
  urlAction?: UrlAction;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // เริ่มจากแคช: ชี้ซ้ำที่ไฟล์เดิมต้องขึ้นทันที ไม่ใช่หมุนรออีกรอบ
  const [url, setUrl] = useState<string | null>(() => cachedSignedUrl(path));
  const [failed, setFailed] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useIsMounted();
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  const isPdf = /\.pdf$/i.test(fileName) || mimeType === 'application/pdf';
  const isImage =
    !isPdf && (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif)$/i.test(fileName));

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // คงที่ เพราะ effect ของปุ่ม Escape พึ่งมัน — ฟังก์ชันใหม่ทุกเรนเดอร์แปลว่า
  // ถอดแล้วผูก listener ใหม่ทุกเรนเดอร์เช่นกัน
  const close = useCallback(() => {
    cancel();
    setOpen(false);
    setPlace(null);
  }, [cancel]);

  /** เปิดการ์ด แล้วค่อยขอลิงก์ — กรอบที่กำลังโหลดบอกว่ามีอะไรกำลังมา. */
  const show = () => {
    if (!urlAction) return;
    setOpen(true);
    const have = cachedSignedUrl(path);
    if (have) {
      setUrl(have);
      return;
    }
    void signedUrl(path, urlAction).then((res) => {
      if (res.url) setUrl(res.url);
      else setFailed(true);
    });
  };

  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  /*
    วางด้วยพิกัดหน้าต่างแล้วแขวนที่ body — เหมือน CountPopover และด้วยเหตุผล
    เดียวกัน: ชิปไฟล์แนบอยู่ในการ์ดที่มี `overflow` และในแถวตารางที่เลื่อนได้
    กล่อง absolute ข้างในนั้นถูกตัดเสมอ ไม่ว่าจะเลื่อนไปทางไหน
  */
  useLayoutEffect(() => {
    if (!open) return;
    const put = () => {
      const anchor = wrapRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 8;
      const h = cardRef.current?.offsetHeight ?? 200;
      const left = Math.min(
        Math.max(margin, anchor.left + anchor.width / 2 - CARD_W / 2),
        Math.max(margin, window.innerWidth - CARD_W - margin),
      );
      // เหนือชิปก่อน ชิปไฟล์แนบมักอยู่ท้ายฟอร์มซึ่งติดขอบล่างของจอ
      const above = anchor.top - margin - h;
      setPlace({ left, top: above >= margin ? above : anchor.bottom + margin });
    };
    put();
    window.addEventListener('scroll', put, true);
    window.addEventListener('resize', put);
    return () => {
      window.removeEventListener('scroll', put, true);
      window.removeEventListener('resize', put);
    };
  }, [open, url, failed]);

  if (!urlAction) return <>{children}</>;

  return (
    <span
      ref={wrapRef}
      className="inline-flex"
      // เมาส์เท่านั้น: บนทัชสกรีน pointerenter มาพร้อมการแตะ การ์ดจะเปิดแล้ว
      // โดนหน้าต่างเต็มจอทับในจังหวะเดียวกัน
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        cancel();
        timer.current = setTimeout(show, HOVER_INTENT_MS);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        close();
      }}
      // คีย์บอร์ด: แท็บมาถึงชิปแล้วต้องได้เห็นเท่ากับคนที่ใช้เมาส์
      onFocus={show}
      onBlur={close}
      // กดแล้วหน้าต่างเต็มจอขึ้นมาแทน การ์ดที่ค้างอยู่ข้างหลังไม่มีประโยชน์
      onClick={close}
    >
      {children}

      {open &&
        mounted &&
        createPortal(
          <span
            ref={cardRef}
            role="tooltip"
            aria-label={`ตัวอย่าง ${fileName}`}
            /* กล่องที่ลอยอยู่ตอนกดแคป ไม่ใช่ส่วนหนึ่งของเอกสาร */
            data-capture-hide=""
            className="fixed z-50 rounded-xl overflow-hidden flex flex-col"
            style={{
              left: place?.left ?? -9999,
              top: place?.top ?? -9999,
              visibility: place ? 'visible' : 'hidden',
              width: CARD_W,
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              boxShadow: '0 10px 28px rgba(0,0,0,.18)',
              // ไม่รับเมาส์: การ์ดวางทับชิปได้ ถ้ามันดูดเมาส์ไป ชิปจะนับว่า
              // "เมาส์ออก" แล้วการ์ดก็ปิดตัวเอง กะพริบไม่หยุด
              pointerEvents: 'none',
            }}
          >
            <span
              className="flex items-center justify-center"
              style={{ background: '#333', minHeight: 96 }}
            >
              {failed ? (
                <span className="text-xs p-4 text-center" style={{ color: '#fff' }}>
                  เปิดดูตรงนี้ไม่ได้ กดเพื่อลองเปิดเต็มจอ
                </span>
              ) : !url ? (
                <span className="text-xs p-4" style={{ color: '#fff' }}>
                  <i className="fa-solid fa-spinner fa-spin mr-1.5"></i>
                  กำลังเปิด...
                </span>
              ) : isPdf ? (
                <object
                  data={`${url}#toolbar=0&navpanes=0&view=FitH`}
                  type="application/pdf"
                  style={{ width: '100%', height: 300 }}
                  aria-label={fileName}
                >
                  <span className="text-xs p-4 block text-center" style={{ color: '#fff' }}>
                    กดเพื่อเปิด {fileName}
                  </span>
                </object>
              ) : isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={`ตัวอย่าง ${fileName}`}
                  onError={() => setFailed(true)}
                  style={{ display: 'block', maxWidth: '100%', maxHeight: 240 }}
                />
              ) : (
                <span className="text-xs p-4 text-center" style={{ color: '#fff' }}>
                  <i className="fa-solid fa-file mr-1.5"></i>
                  กดเพื่อเปิด {fileName}
                </span>
              )}
            </span>
            <span className="text-xs px-2 py-1" style={{ color: 'var(--ink-faint)' }}>
              กดเพื่อดูเต็มจอ
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
