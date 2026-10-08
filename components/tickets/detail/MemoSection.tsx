'use client';

import { useEffect, useRef, useState } from 'react';

import { fmtThaiDate, fmtThaiDateTime, hhmm, shopDayKey } from '@/lib/domain/format';
import { daysAgoValue, todayValue } from '@/lib/domain/now';
import type { TicketMemo } from '../types';

/**
 * ป้ายคั่นวัน — "วันนี้" / "เมื่อวาน" / วันที่เต็ม.
 *
 * เส้นแชทที่ติดวันที่เต็มไว้ทุกข้อความอ่านยากกว่าที่คิด เพราะสิ่งที่คนมองหาคือ
 * "ข้อความนี้มาก่อนหรือหลังอันนั้น" ไม่ใช่วันที่ของแต่ละอัน วันเต็มจึงขึ้นครั้ง
 * เดียวตอนข้ามวัน ที่เหลือเหลือแค่เวลา
 */
function dayLabel(key: string): string {
  if (key === todayValue()) return 'วันนี้';
  if (key === daysAgoValue(1)) return 'เมื่อวาน';
  return fmtThaiDate(new Date(`${key}T00:00:00+07:00`));
}

/** หัวแทนรูปโปรไฟล์ — ตัวอักษรแรกของชื่อ ซึ่งเป็นทุกอย่างที่ระบบนี้รู้เรื่องหน้าตาคน */
function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/**
 * ข้อความติดกันของคนเดียวกัน ภายในห้านาที = ก้อนเดียวกัน.
 *
 * ก้อนเดียวกันไม่ต้องขึ้นชื่อกับรูปซ้ำ เหมือนทุกแอปแชท — คนพิมพ์สามบรรทัดรวด
 * ไม่ได้แปลว่ามีสามคนพูด
 */
const SAME_BLOCK_MS = 5 * 60 * 1000;

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
  const threadRef = useRef<HTMLDivElement>(null);

  /*
    เปิดมาให้เห็นข้อความล่าสุด ไม่ใช่ข้อความแรกสุด.

    เส้นเรียงเก่าขึ้นบน ซึ่งถูกสำหรับการอ่านย้อน แต่สิ่งที่คนเปิดใบงานมาดูคือ
    "ล่าสุดว่าไง" ถ้าไม่เลื่อนให้ ใบที่คุยกันมาสามสิบข้อความจะเปิดมาเจอเรื่อง
    เมื่ออาทิตย์ที่แล้ว
  */
  const count = memos.length;
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

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
        <div
          ref={threadRef}
          /*
            เส้นแชทมีเพดานความสูงของตัวเอง ไม่ยืดไปเรื่อย ๆ.

            ใบงานที่คุยกันห้าสิบข้อความ ไม่ควรดันส่วนอื่นของหน้าหายไปข้างล่าง
            และช่องพิมพ์ต้องอยู่ที่เดิมเสมอ ไม่ใช่ไล่ตามความยาวของบทสนทนา
          */
          className="mb-3 overflow-y-auto rounded-xl px-2 py-2"
          style={{ maxHeight: '20rem', background: 'var(--paper)' }}
        >
          <ol className="flex flex-col gap-1">
            {memos.map((m, i) => {
              const mine = !!m.authorId && m.authorId === currentUserId;
              const at = new Date(m.createdAt);
              const prev = i > 0 ? memos[i - 1] : null;
              const newDay = !prev || shopDayKey(new Date(prev.createdAt)) !== shopDayKey(at);
              const sameBlock =
                !newDay &&
                !!prev &&
                prev.authorId === m.authorId &&
                at.getTime() - new Date(prev.createdAt).getTime() < SAME_BLOCK_MS;

              /* เวลา (กับปุ่มลบ) อยู่นอกฟอง ชิดก้นฟอง — ข้างซ้ายเมื่อเป็นของเรา
                 ข้างขวาเมื่อเป็นของคนอื่น คือด้านที่หันออกจากตัวฟองเสมอ */
              const stamp = (
                <span
                  className="text-[10px] flex items-end gap-1 flex-shrink-0"
                  style={{ color: 'var(--ink-faint)' }}
                >
                  {(mine || canDeleteAny) && (
                    <button
                      type="button"
                      onClick={() => remove(m)}
                      disabled={busy}
                      aria-label={`ลบข้อความของ ${m.authorName} เมื่อ ${fmtThaiDateTime(at)}`}
                      /*
                        ไม่ซ่อนไว้จนกว่าเมาส์จะชี้ — บนแท็บเล็ตที่หน้าร้านใช้ ไม่มี
                        การชี้เมาส์ ปุ่มนั้นก็คือปุ่มที่ไม่มีอยู่จริง

                        แต่ก็ไม่ใช่สีแดง: ในแอปนี้สีแดงแปลว่ามีอะไรผิดปกติ และถ้า
                        ทุกข้อความของตัวเองมีจุดแดงกำกับ เส้นแชทก็อ่านเหมือนมี
                        ปัญหาทั้งเส้น สีจางพอให้มองข้ามได้จนกว่าจะมองหา
                      */
                      style={{ color: 'var(--ink-faint)' }}
                    >
                      <i className="fa-solid fa-trash text-[10px]"></i>
                    </button>
                  )}
                  <time dateTime={m.createdAt}>{hhmm(at)}</time>
                </span>
              );

              return (
                <li key={m.id}>
                  {newDay && (
                    <div className="flex justify-center my-2">
                      <span
                        className="text-[10px] px-2.5 py-0.5 rounded-full"
                        style={{ background: 'var(--line)', color: 'var(--ink-soft)' }}
                      >
                        {dayLabel(shopDayKey(at))}
                      </span>
                    </div>
                  )}
                  <div
                    className={`flex gap-1.5 items-end ${mine ? 'justify-end' : 'justify-start'}`}
                  >
                    {/* รูปแทนตัวคนอื่น — ข้อความต่อเนื่องเว้นที่ไว้เฉย ๆ ให้ฟองตรงกัน */}
                    {!mine &&
                      (sameBlock ? (
                        <span className="flex-shrink-0" style={{ width: 24 }} aria-hidden="true" />
                      ) : (
                        <span
                          className="flex-shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{
                            width: 24,
                            height: 24,
                            background: 'var(--line-strong)',
                            color: 'var(--ink)',
                          }}
                          aria-hidden="true"
                        >
                          {initial(m.authorName || 'ระบบ')}
                        </span>
                      ))}
                    {mine && stamp}
                    <div style={{ maxWidth: '78%' }}>
                      {/*
                        ชื่อขึ้นเฉพาะของคนอื่น และเฉพาะข้อความแรกของก้อน — ของ
                        ตัวเองไม่ต้องบอกว่าใคร ตำแหน่งฟองบอกอยู่แล้ว
                      */}
                      {!mine && !sameBlock && (
                        <p className="text-[10px] mb-0.5 px-1" style={{ color: 'var(--ink-soft)' }}>
                          {m.authorName || 'ระบบ'}
                        </p>
                      )}
                      <p
                        className="text-xs px-3 py-1.5 text-left"
                        style={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          background: mine ? 'var(--primary-soft)' : 'var(--surface)',
                          border: '1px solid var(--line)',
                          /*
                            มุมที่ถูกตัดคือมุมที่ชี้กลับไปหาคนพูด — ใช้แทนหางฟอง
                            สามเหลี่ยม ซึ่งต้องวาดด้วย pseudo-element และเพี้ยน
                            ทันทีที่ฟองสูงไม่เท่ากัน
                          */
                          borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                        }}
                      >
                        {m.body}
                      </p>
                    </div>
                    {!mine && stamp}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
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
