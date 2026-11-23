'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { fmtThaiDate } from '@/lib/domain/format';
import type { NoticeKind, Release } from '@/lib/notices/releaseNotes';

/**
 * หน้า "มีอะไรใหม่" — อยู่ตลอด ไม่ใช่เห็นครั้งเดียวแล้วหาย.
 *
 * แถบกับจุดสีเป็นแค่ทางเดินมาที่นี่ ชั้นนี้คือชั้นที่ต้องมีก่อนเพื่อน เพราะคน
 * ที่กด "ไว้ก่อน" ไปตอนยุ่ง ต้องมีที่ให้กลับมาอ่านได้เสมอ
 * (docs/DESIGN-whats-new.md)
 */

/** ไม่ใช่ป้ายสีสวย ๆ — มันบอกว่าเรื่องนั้นควรดังแค่ไหน. */
const KIND: Record<NoticeKind, { label: string; ink: string; bg: string }> = {
  new: { label: 'ของใหม่', ink: '#1F6F4A', bg: '#E6F4EC' },
  changed: { label: 'ความหมายเปลี่ยน', ink: '#8A4B12', bg: '#FDF0E2' },
  fixed: { label: 'แก้ให้ถูก', ink: '#2F5B9C', bg: '#E8F0FB' },
};

export function WhatsNewView({
  releases,
  unread,
  markSeenAction,
}: {
  releases: Release[];
  /** จำนวนที่ยังไม่ได้อ่าน ณ ตอนที่เปิดหน้านี้ — ใช้ตัดสินว่าต้องบันทึกไหม. */
  unread: number;
  markSeenAction: () => Promise<{ ok: boolean; error?: string }>;
}) {
  /*
    "อ่านแล้ว" = เปิดหน้านี้ ไม่ใช่กดปุ่มยืนยันว่าอ่าน.

    ปุ่มยืนยันคือสิ่งที่คนกดโดยไม่อ่านอยู่ดี มันจึงวัดได้แค่ว่ามีคนกดปุ่ม

    ยิงครั้งเดียวต่อการเปิดหน้า — การบันทึกทำให้ layout ถูกเรนเดอร์ใหม่เพื่อ
    เอาจุดสีออก ถ้าไม่กันไว้ มันจะยิงซ้ำไปเรื่อย ๆ
  */
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || unread < 1) return;
    sent.current = true;
    void markSeenAction();
  }, [unread, markSeenAction]);

  return (
    <div className="fade-page max-w-3xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold">มีอะไรใหม่</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>
          เฉพาะเรื่องที่เกี่ยวกับงานที่คุณทำได้ · เข้ามาอ่านย้อนหลังได้ตลอดจากเมนูชื่อคุณมุมขวาบน
        </p>
      </div>

      {releases.length === 0 && (
        <div className="card p-5">
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            ยังไม่มีข่าวการเปลี่ยนแปลงที่เกี่ยวกับงานของคุณ
          </p>
        </div>
      )}

      {releases.map((r) => (
        <section key={r.no} className="mb-6">
          <div className="flex items-baseline gap-2 flex-wrap mb-3">
            <h2 className="text-sm font-bold">{r.title}</h2>
            <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              รุ่นที่ {r.no} · {fmtThaiDate(new Date(`${r.date}T00:00:00`))} · {r.notes.length}{' '}
              เรื่อง
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {r.notes.map((n) => {
              const kind = KIND[n.kind];
              return (
                <article key={n.id} id={n.id} className="card p-4">
                  <div className="flex items-start gap-2.5 flex-wrap">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
                      style={{ background: kind.bg, color: kind.ink }}
                    >
                      {kind.label}
                    </span>
                    <h3 className="text-sm font-bold flex-1 min-w-[12rem]">{n.title}</h3>
                    {n.href && (
                      <Link
                        href={n.href}
                        className="text-xs px-2.5 py-1 rounded-lg font-semibold whitespace-nowrap"
                        style={{ border: '1.5px solid var(--line)', color: 'var(--primary)' }}
                      >
                        ไปดู
                      </Link>
                    )}
                  </div>

                  <p className="text-sm mt-2">{n.what}</p>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--ink-soft)' }}>
                    {n.why}
                  </p>

                  {/*
                    บรรทัดที่สามส่วนใหญ่คือ "ไม่ต้องทำอะไร" และการได้อ่านประโยค
                    นั้นมีค่า — คนที่อ่านข่าวแล้วไม่รู้ว่าต้องลงมือหรือเปล่า จะ
                    ค้างอยู่กับคำถามนั้นทั้งวัน
                  */}
                  <p
                    className="text-xs mt-2 flex items-start gap-1.5"
                    style={{ color: n.todo ? '#8A4B12' : 'var(--ink-faint)' }}
                  >
                    <i
                      className={`fa-solid ${n.todo ? 'fa-circle-exclamation' : 'fa-circle-check'} mt-0.5`}
                    />
                    <span>{n.todo ?? 'ไม่ต้องทำอะไร ใช้ได้เลย'}</span>
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
