'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { fmt } from '@/lib/domain/format';
import type { CountItem } from '@/components/dailyReport/buildDailyReport';

/**
 * ตัวเลข "จำนวน" ที่ชี้เมาส์หรือกดค้างแล้วบอกว่ามันมาจากไหน (ร้านขอ 2 ต.ค. 2569).
 *
 * "1 งาน" ตอบได้แค่ว่ามีกี่อัน และคำถามถัดไปของคนอ่านคือ "อันไหน" เสมอ เดิมต้อง
 * ออกจากรายงานไปเปิดอีกโมดูลแล้วไล่หาเอง ซึ่งแปลว่าเลิกอ่านรายงานกลางคัน
 *
 * เปิดด้วยสามทาง เพราะคนอ่านรายงานนี้อยู่บนสามอุปกรณ์: ชี้เมาส์ (คอม) กดค้าง
 * (มือถือ/แท็บเล็ต) และคลิก/แตะ ซึ่งเป็นทางที่คนส่วนใหญ่ลองเป็นอย่างแรกอยู่ดี
 * ปุ่มจริง ๆ ไม่ใช่ span ที่ผูก event ไว้ — คนที่ใช้คีย์บอร์ดหรือโปรแกรมอ่าน
 * หน้าจอจึงเข้าถึงได้เหมือนกัน
 */

/** กดค้างนานแค่ไหนถึงนับว่าตั้งใจ — สั้นกว่านี้จะเด้งตอนเลื่อนหน้าจอ. */
const LONG_PRESS_MS = 400;

export function CountPopover({
  count,
  items,
  label,
  title,
  emptyNote = 'ไม่มีรายการ',
}: {
  /** ข้อความที่แสดงตามปกติ เช่น "1 งาน". */
  count: React.ReactNode;
  items: CountItem[];
  /** ให้โปรแกรมอ่านหน้าจอรู้ว่ากำลังจะเปิดที่มาของอะไร. */
  label: string;
  /** หัวป๊อปอัพ. */
  title: string;
  emptyNote?: string;
}) {
  /*
    ชี้เมาส์ กับ กดค้าง/คลิก เป็นคนละเรื่องกัน.

    ถ้ารวมเป็นสถานะเดียว การคลิกบนคอมจะปิดกล่องที่เพิ่งเปิดจากการชี้เมาส์ —
    เพราะเมาส์เข้าก่อนคลิกเสมอ คลิกจึงกลายเป็น "สลับ" ของสิ่งที่เปิดอยู่แล้ว
    (เจอตอนเขียนเทสต์ ไม่ใช่ตอนใช้งานจริง ซึ่งแปลว่าถ้าไม่มีเทสต์ก็หลุดไป)

    `pinned` คือการตั้งใจให้ค้างไว้ — กล่องจะอยู่ต่อแม้เมาส์ออกไปแล้ว ซึ่งเป็น
    สิ่งที่คนทำเมื่อจะกดลิงก์ข้างใน
  */
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const open = pinned || hovering;

  /** ปิดทั้งสองทาง — ปักหมุดไว้แล้วกด Escape ต้องปิดจริง ไม่ใช่ค้างเพราะเมาส์ยังอยู่. */
  const close = () => {
    setPinned(false);
    setHovering(false);
  };
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // กันนาฬิกากดค้างค้างไว้เมื่อคอมโพเนนต์หายไปกลางทาง
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const startPress = () => {
    timer.current = setTimeout(() => setPinned(true), LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const total = items.reduce((n, i) => n + i.amount, 0);

  return (
    <span className="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        aria-label={`ดูที่มาของ${label}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setPinned((v) => !v)}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHovering(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHovering(false)}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        className="underline decoration-dotted underline-offset-2"
        style={{ textDecorationColor: 'var(--ink-faint)' }}
      >
        {count}
      </button>
      {open && (
        <span
          id={panelId}
          role="dialog"
          aria-label={title}
          /* กล่องที่ลอยอยู่ตอนกดแคป ไม่ใช่ส่วนหนึ่งของรายงาน */
          data-capture-hide=""
          className="absolute z-30 rounded-xl p-2 text-left"
          style={{
            top: 'calc(100% + 4px)',
            // ชิดขวาของตัวเลข: ตัวเลขพวกนี้อยู่ชิดขวาของตารางเกือบทั้งหมด
            // กล่องที่กางไปทางขวาจะล้นออกนอกการ์ด
            right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: '0 10px 28px rgba(0,0,0,.16)',
            minWidth: '15rem',
            maxWidth: '22rem',
            maxHeight: '16rem',
            overflowY: 'auto',
            whiteSpace: 'normal',
            cursor: 'default',
          }}
        >
          <span
            className="block text-xs font-semibold px-1.5 pb-1.5 mb-1"
            style={{ borderBottom: '1px solid var(--line)' }}
          >
            {title}
          </span>
          {items.length === 0 && (
            <span className="block text-xs px-1.5 py-1" style={{ color: 'var(--ink-faint)' }}>
              {emptyNote}
            </span>
          )}
          {items.map((item, i) => (
            <span
              key={`${item.label}-${i}`}
              className="flex items-start justify-between gap-3 text-xs px-1.5 py-1"
            >
              <span className="min-w-0">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="font-medium"
                    style={{ color: 'var(--primary)' }}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="font-medium">{item.label}</span>
                )}
                {item.note && (
                  <span className="block" style={{ color: 'var(--ink-faint)' }}>
                    {item.note}
                  </span>
                )}
              </span>
              <span className="font-semibold whitespace-nowrap">{fmt(item.amount)}</span>
            </span>
          ))}
          {items.length > 1 && (
            <span
              className="flex items-center justify-between gap-3 text-xs px-1.5 pt-1.5 mt-1 font-semibold"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <span>รวม</span>
              <span className="whitespace-nowrap">{fmt(total)}</span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
