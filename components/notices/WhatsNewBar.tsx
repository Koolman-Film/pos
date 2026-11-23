'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * แถบแจ้งหลังอัปเดต — ขึ้นครั้งแรกที่เข้าระบบหลังมีของใหม่.
 *
 * ━━ ทำไมเป็นแถบ ไม่ใช่หน้าต่างกลางจอ ━━
 *
 * พนักงานเปิดระบบตอนลูกค้ายืนรออยู่ตรงหน้า หน้าต่างที่มาขวางงานในวินาทีแรกจะ
 * ถูกกดปิดโดยไม่อ่าน แล้วข้อมูลนั้นก็หายไปตลอดกาล — คนที่ควรได้ประโยชน์ที่สุด
 * คือคนที่รีบที่สุด และเป็นคนที่จะไม่มีวันได้อ่าน แถบอ่านได้โดยไม่ต้องหยุดงาน
 * และไม่ต้องกดปิดก่อนถึงจะทำงานต่อได้
 *
 * "ไว้ก่อน" ปิดแค่แถบ จุดสีบนเมนูชื่อผู้ใช้ยังอยู่จนกว่าจะเปิดอ่านจริง ข้อมูล
 * จึงไม่หายไปไหน แค่ไม่ยืนขวาง
 *
 * ไม่กลับมาพรุ่งนี้เหมือนหน้าต่างของกระดิ่ง เพราะกระดิ่งเตือนเรื่องที่ยังค้าง
 * ต้องทำ ส่วนข่าวที่เลือกจะยังไม่อ่าน ไม่ใช่เรื่องค้าง
 */
export function WhatsNewBar({
  count,
  dismissAction,
}: {
  /** จำนวนเรื่องที่เกี่ยวกับคนนี้ — ไม่ใช่จำนวนเรื่องทั้งหมดในรุ่น. */
  count: number;
  dismissAction: () => Promise<{ ok: boolean; error?: string }>;
}) {
  /*
    ซ่อนทันทีที่กด ไม่รอเซิร์ฟเวอร์.

    การเขียนลงฐานข้อมูลมีไว้ให้พรุ่งนี้บนเครื่องอื่นก็ยังจำได้ ส่วนคนที่เพิ่งกด
    ไม่ควรต้องรอ round-trip เพื่อให้แถบหายไปจากหน้าจอตัวเอง
  */
  const [hidden, setHidden] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  if (hidden || count < 1) return null;

  return (
    <div
      role="status"
      className="mx-4 sm:mx-6 mt-4 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap"
      style={{
        background: 'var(--surface)',
        border: '1.5px solid var(--primary)',
      }}
    >
      <i className="fa-solid fa-wand-magic-sparkles" style={{ color: 'var(--primary)' }} />
      <p className="text-sm font-semibold flex-1 min-w-[12rem]">
        ระบบอัปเดตแล้ว · มี {count} เรื่องที่เกี่ยวกับงานของคุณ
      </p>
      {/*
        ไม่ซ่อนแถบตอนกดลิงก์นี้ — การ setState ตรงนี้จะถอดลิงก์ออกจากหน้าจอ
        กลางคัน แล้วการพาไปหน้าใหม่ก็ถูกยกเลิกไปด้วย (เจอตอนลองของจริง)
        หน้าปลายทางบันทึกว่าอ่านแล้วอยู่แล้ว แถบจึงหายเองในรอบถัดไป
      */}
      <Link href="/whats-new" className="btn-primary text-xs px-3 py-1.5 rounded-lg font-semibold">
        ดูว่าอะไรเปลี่ยน
      </Link>
      <button
        type="button"
        onClick={() => {
          setHidden(true);
          startTransition(async () => {
            await dismissAction();
            router.refresh();
          });
        }}
        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
        style={{ border: '1.5px solid var(--line)', color: 'var(--ink-soft)' }}
      >
        ไว้ก่อน
      </button>
    </div>
  );
}
