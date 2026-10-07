'use client';

import { useState } from 'react';

import { fmtThaiDateTime } from '@/lib/domain/format';
import type { TicketMemo } from '../types';

/**
 * MEMO — ช่องคุยกันภายในของใบงานหนึ่งใบ (ร้านขอ 7 ต.ค. 2569).
 *
 * "เพื่อให้เห็นว่าใครได้พิมพ์ข้อมูลของใบงานนี้ไว้บ้าง" — ช่อง หมายเหตุ ที่มีอยู่
 * ตอบคำถามนี้ไม่ได้ เพราะมันเป็นกล่องเดียวที่ทุกคนเขียนทับกัน เหลือแต่ของคนที่
 * บันทึกล่าสุด และมันถูกพิมพ์ลงใบงานทุกใบกับใบเสนอราคา
 *
 * ที่นี่หนึ่งข้อความคือหนึ่งแถวในฐานข้อมูล ต่อกันเป็นเส้น มีชื่อคนเขียนกับเวลา
 * ที่ฐานข้อมูลประทับเอง และไม่มีทางหลุดไปอยู่บนกระดาษที่ลูกค้าถือ
 *
 * ส่งทันทีที่กด ไม่รอปุ่ม "บันทึกใบงาน"
 * ------------------------------------
 * สองอย่างนี้ต้องแยกกัน: คนที่เปิดใบงานค้างไว้แล้วพิมพ์ MEMO ไม่ได้ตั้งใจจะ
 * บันทึกฟอร์มที่ยังกรอกไม่เสร็จ และคนที่กดบันทึกฟอร์มก็ไม่ควรส่งข้อความที่
 * พิมพ์ค้างไว้ครึ่งเดียวออกไป
 */
export function MemoSection({
  memos,
  ticketId,
  currentUserId,
  canDeleteAny,
  disabled,
  disabledNote,
  onAdd,
  onDelete,
  onDone,
}: {
  memos: TicketMemo[];
  ticketId: string;
  /**
   * id ของคนที่กำลังเปิดหน้าอยู่ ใช้เน้นข้อความของตัวเอง และตัดสินว่าจะมีปุ่มลบ
   *
   * เทียบด้วย id ไม่ใช่ชื่อ: `authorName` คือชื่อ ณ ตอนที่เขียน พนักงานสองคน
   * ชื่อซ้ำกันมีจริง และคนที่เปลี่ยนชื่อจะมองไม่เห็นปุ่มลบของข้อความตัวเอง
   */
  currentUserId: string;
  /** แอดมินลบได้ทุกข้อความ คนอื่นลบได้เฉพาะของตัวเอง — ตรงกับกติกาใน RLS */
  canDeleteAny: boolean;
  /** ใบงานที่ยังไม่เคยบันทึก ยังไม่มี id ให้ข้อความไปผูก */
  disabled?: boolean;
  disabledNote?: string;
  onAdd: (input: { ticketId: string; body: string }) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (input: { id: number; ticketId: string }) => Promise<{ ok: boolean; error?: string }>;
  /** เรียกเมื่อเส้นเปลี่ยน เพื่อให้หน้าดึงข้อความล่าสุดมาแสดง */
  onDone: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError('');
    const result = await onAdd({ ticketId, body });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'ส่งไม่สำเร็จ');
      return;
    }
    // ล้างช่องหลังจากที่ฐานข้อมูลรับแล้วเท่านั้น — ล้างก่อนแล้วพลาด คือข้อความ
    // ที่คนพิมพ์หายไปโดยไม่มีที่ให้กดส่งซ้ำ
    setDraft('');
    onDone();
  }

  async function remove(m: TicketMemo) {
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await onDelete({ id: m.id, ticketId });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'ลบไม่สำเร็จ');
      return;
    }
    onDone();
  }

  return (
    <section
      className="card p-4 mb-5"
      aria-label="MEMO"
      /*
        กันพลาดอีกชั้นหนึ่ง: ถ้าวันหนึ่งมีใครย้ายกล่องนี้ไปอยู่ในส่วนที่ถูกแคป
        หน้าจอหรือถูกพิมพ์ มันจะหายไปเอง แทนที่จะโผล่ไปอยู่ในมือลูกค้า
      */
      data-capture-hide=""
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-sm font-bold flex items-center gap-1.5">
          <i className="fa-solid fa-comments" style={{ color: 'var(--ink-soft)' }}></i>
          MEMO
        </p>
        <span
          className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
          style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}
        >
          <i className="fa-solid fa-eye-slash text-[10px]"></i>
          เห็นเฉพาะในระบบ
        </span>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--ink-faint)' }}>
        บันทึกภายในของใบงานนี้ ไม่ถูกพิมพ์ลงใบงาน ใบเสนอราคา หรือใบเสร็จ
      </p>

      {memos.length === 0 ? (
        <p className="text-xs mb-3" style={{ color: 'var(--ink-faint)' }}>
          ยังไม่มีใครเขียนอะไรไว้
        </p>
      ) : (
        <ol className="mb-3 flex flex-col gap-2">
          {memos.map((m) => {
            const mine = !!m.authorId && m.authorId === currentUserId;
            return (
              <li
                key={m.id}
                className="rounded-xl px-3 py-2"
                style={{
                  background: mine ? 'var(--primary-soft)' : 'var(--paper)',
                  border: '1px solid var(--line)',
                }}
              >
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="text-xs font-semibold">{m.authorName || 'ระบบ'}</span>
                  <span
                    className="text-xs flex items-center gap-2"
                    style={{ color: 'var(--ink-faint)' }}
                  >
                    <time dateTime={m.createdAt}>{fmtThaiDateTime(new Date(m.createdAt))}</time>
                    {(mine || canDeleteAny) && (
                      <button
                        type="button"
                        onClick={() => remove(m)}
                        disabled={busy}
                        aria-label={`ลบข้อความของ ${m.authorName} เมื่อ ${fmtThaiDateTime(new Date(m.createdAt))}`}
                        /* ไม่ใช่ `row-action` ที่ซ่อนไว้จนกว่าเมาส์จะชี้ — บนแท็บเล็ตที่
                           หน้าร้านใช้ ไม่มีการชี้เมาส์ ปุ่มนั้นก็คือปุ่มที่ไม่มีอยู่จริง */
                        style={{ color: '#B23A48' }}
                      >
                        <i className="fa-solid fa-trash text-[10px]"></i>
                      </button>
                    )}
                  </span>
                </div>
                <p className="text-xs" style={{ whiteSpace: 'pre-wrap' }}>
                  {m.body}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {disabled ? (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          {disabledNote}
        </p>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter ส่ง — Enter เปล่าขึ้นบรรทัดใหม่ เพราะข้อความในนี้
              // มักเป็นรายการหลายบรรทัด ไม่ใช่แชทประโยคเดียว
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void send();
            }}
            aria-label="เขียน MEMO"
            placeholder="พิมพ์ข้อความถึงคนที่ทำงานใบนี้ต่อ..."
            rows={2}
            className="field w-full text-xs px-3 py-2"
            style={{ resize: 'vertical' }}
          />
          {error && (
            <p className="text-xs mt-1.5" style={{ color: '#B23A48' }} role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              กด Ctrl + Enter เพื่อส่ง
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !draft.trim()}
              className="btn-primary rounded-xl px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5"
              style={{ opacity: busy || !draft.trim() ? 0.5 : 1 }}
            >
              <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i>
              {busy ? 'กำลังส่ง...' : 'ส่ง'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
