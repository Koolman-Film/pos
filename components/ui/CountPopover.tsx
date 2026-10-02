'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

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
  const panelRef = useRef<HTMLSpanElement>(null);
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

  /*
    เลื่อนกล่องกลับเข้าจอ หลังจากที่มันกางออกมาแล้ว.

    วัดจากของจริงแทนที่จะเดาจากตำแหน่งตอนเขียนโค้ด เพราะตัวเลขเดียวกันอยู่คนละที่
    บนจอคอมกับจอมือถือ และการ์ดสรุปกับแถวในตารางก็ชิดคนละด้านกัน
  */
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!open || !el) return;
    /*
      ล้างการเลื่อนออกก่อนวัด แล้วคำนวณรอบเดียวจบ.

      ถ้าวัดทั้งที่ยังเลื่อนอยู่ ต้องลบค่าที่เลื่อนไว้ออกเอง ซึ่งแปลว่าผลลัพธ์
      ขึ้นกับว่าค่าที่วัดได้สะท้อน transform แล้วจริงไหม — จริงบนเบราว์เซอร์
      แต่ไม่จริงใน jsdom และ effect ที่ป้อนค่าตัวเองกลับเข้าไปแบบนั้นวนไม่รู้จบ
      เมื่อสมมติฐานพัง (เจอตอนเขียนเทสต์) วัดจากศูนย์เสมอจึงไม่มีทางวน
    */
    el.style.transform = '';
    const box = el.getBoundingClientRect();
    const margin = 8;
    let next = 0;
    if (box.left < margin) next = margin - box.left;
    else if (box.right > window.innerWidth - margin) {
      next = window.innerWidth - margin - box.right;
    }
    // เขียนลงโหนดตรง ๆ ไม่เก็บเป็น state: ค่านี้ไม่มีใครอ่านนอกจากตัวกล่องเอง
    // และกล่องถูกถอดออกตอนปิดอยู่แล้ว จึงไม่มีอะไรต้องรีเซ็ต
    if (next) el.style.transform = `translateX(${next}px)`;
  }, [open, items.length]);

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
          ref={panelRef}
          className="absolute z-30 rounded-xl p-2 text-left"
          style={{
            top: 'calc(100% + 4px)',
            /*
              ตั้งต้นชิดขวาของตัวเลข แล้วค่อยเลื่อนให้อยู่ในจอ.

              ตัวเลขจำนวนส่วนใหญ่อยู่ชิดขวาของตาราง กล่องจึงควรกางไปทางซ้าย —
              แต่ตัวเลขบนการ์ดสรุปอยู่ชิดซ้ายของหน้า กล่องเลยทะลุออกไปทับแถบ
              เมนูจนอ่านไม่ได้ (ร้านเจอ 2 ต.ค. 2569) การเดาทิศทางจากตำแหน่งที่
              เขียนโค้ดไว้ตอบไม่ได้ทุกกรณี โดยเฉพาะบนจอแคบที่ทุกอย่างขยับ —
              จึงวัดเอาหลังกางแล้วเลื่อนเท่าที่ล้นจริง
            */
            right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: '0 10px 28px rgba(0,0,0,.16)',
            minWidth: '15rem',
            // บนมือถือ กล่องกว้างกว่าจอคือกล่องที่อ่านไม่ได้ ไม่ว่าจะวางตรงไหน
            maxWidth: 'min(22rem, calc(100vw - 24px))',
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
