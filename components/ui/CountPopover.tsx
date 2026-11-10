'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { fmt } from '@/lib/domain/format';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
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
      // กล่องอยู่คนละที่ใน DOM แล้ว การถามแค่ `wrapRef` จะปิดตัวเองทันทีที่
      // คลิกลิงก์ข้างในกล่อง
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
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

  const mounted = useIsMounted();
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  /*
    วางกล่องด้วยพิกัดของหน้าต่าง แล้วแขวนไว้ที่ body (ร้านเจอซ้ำ 16 ต.ค. 2569).

    สองรอบก่อนหน้านี้แก้ด้วยการเลื่อนกล่องให้อยู่ในคอลัมน์เนื้อหา ซึ่งแก้ได้
    เฉพาะตอนที่สิ่งที่บังคือขอบจอ — แต่ของจริงที่ตัดกล่องคือ **บรรพบุรุษที่มี
    overflow** ตารางในรายงานห่อด้วย `overflow-x-auto` เพื่อให้เลื่อนดูคอลัมน์
    ได้บนมือถือ และกล่อง absolute ที่อยู่ข้างในนั้นถูกกล่องนั้นตัดเสมอ ไม่ว่า
    จะเลื่อนไปไหน กล่องที่ว่างเปล่าในภาพคือกล่องที่ถูกตัดจนหมดทั้งใบ

    ย้ายไปไว้ที่ body จึงไม่เหลือบรรพบุรุษให้ตัด และเปลี่ยนเป็น `fixed` เพราะ
    พิกัดที่วัดจาก `getBoundingClientRect` เป็นพิกัดของหน้าต่างอยู่แล้ว

    ความสูงถูกหนีบด้วยที่ว่างจริงใต้ตัวเลข ถ้าข้างล่างไม่พอก็พลิกขึ้นไปข้างบน
    เลือกด้านที่มีที่มากกว่า แทนที่จะยืนยันกางลงล่างแล้วโดนขอบจอตัด
  */
  useLayoutEffect(() => {
    if (!open) return;
    const place1 = () => {
      const anchor = wrapRef.current?.getBoundingClientRect();
      const el = panelRef.current;
      if (!anchor || !el) return;

      const margin = 8;
      const column = document.querySelector('main')?.getBoundingClientRect();
      const minLeft = Math.max(column ? column.left : 0, 0) + margin;
      const maxRight =
        Math.min(column ? column.right : window.innerWidth, window.innerWidth) - margin;

      const width = el.offsetWidth;
      // ชิดขวาของตัวเลขก่อน แล้วค่อยหนีบเข้าพื้นที่อ่านได้ — ตัวเลขส่วนใหญ่
      // ชิดขวาของตาราง กล่องจึงควรกางไปทางซ้าย
      let left = anchor.right - width;
      if (left + width > maxRight) left = maxRight - width;
      if (left < minLeft) left = minLeft;

      const below = window.innerHeight - anchor.bottom - margin;
      const above = anchor.top - margin;
      // ต่ำกว่านี้คือกล่องที่เปิดแล้วอ่านอะไรไม่ได้ ดีกว่าพลิกขึ้นไปข้างบน
      const MIN_USEFUL = 120;
      const downward = below >= MIN_USEFUL || below >= above;
      setPlace({
        left,
        top: downward ? anchor.bottom + 4 : Math.max(margin, anchor.top - 4 - el.offsetHeight),
        maxHeight: Math.max(96, downward ? below : above),
      });
    };
    place1();
    // เลื่อนหน้าหรือย่อขยายแล้วตัวเลขย้ายที่ กล่องต้องตามไป ไม่ใช่ค้างอยู่ที่เดิม
    window.addEventListener('scroll', place1, true);
    window.addEventListener('resize', place1);
    return () => {
      window.removeEventListener('scroll', place1, true);
      window.removeEventListener('resize', place1);
    };
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
      {open &&
        mounted &&
        createPortal(
          <span
            id={panelId}
            role="dialog"
            aria-label={title}
            /* กล่องที่ลอยอยู่ตอนกดแคป ไม่ใช่ส่วนหนึ่งของรายงาน */
            data-capture-hide=""
            ref={panelRef}
            /* เมาส์เข้ามาในกล่องแล้วต้องไม่ปิด — มันออกจากตัวเลขไปแล้วตามนิยาม */
            onPointerEnter={(e) => e.pointerType === 'mouse' && setHovering(true)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setHovering(false)}
            className="fixed z-50 rounded-xl p-2 text-left"
            style={{
              left: place?.left ?? -9999,
              top: place?.top ?? -9999,
              // ยังไม่ได้วัด = ยังไม่ต้องให้เห็น กันกล่องกระพริบที่มุมซ้ายบน
              visibility: place ? 'visible' : 'hidden',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              boxShadow: '0 10px 28px rgba(0,0,0,.16)',
              minWidth: '15rem',
              // บนมือถือ กล่องกว้างกว่าจอคือกล่องที่อ่านไม่ได้ ไม่ว่าจะวางตรงไหน
              maxWidth: 'min(22rem, calc(100vw - 24px))',
              maxHeight: Math.min(place?.maxHeight ?? 256, 256),
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
          </span>,
          document.body,
        )}
    </span>
  );
}
