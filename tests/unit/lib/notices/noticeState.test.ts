import { describe, it, expect } from 'vitest';

import { loadNoticeState } from '@/lib/notices/load';
import { CURRENT_RELEASE } from '@/lib/notices/releaseNotes';

/**
 * จุดสีกับแถบ ถูกคุมด้วยเลขคนละตัว (migration 0090).
 *
 * `seen` = อ่านจริงแล้ว คุมจุดสี · `dismissed` = กดไว้ก่อนแล้ว คุมแค่แถบ
 *
 * ถ้าใช้เลขเดียว การกด "ไว้ก่อน" ตอนลูกค้ายืนรออยู่ จะนับเป็น "อ่านแล้ว" แล้ว
 * ข่าวก็หายไปทั้งหมดโดยที่ยังไม่มีใครอ่าน ซึ่งเป็นสิ่งที่ฟีเจอร์นี้มีไว้กันพอดี
 */
type Row = { seen_release: number; dismissed_release: number } | null;

/** พอแค่ที่ `loadNoticeState` เรียกจริง — select → eq → maybeSingle. */
const db = (data: Row, error: { message: string } | null = null) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data, error }) }),
      }),
    }),
  }) as never;

const all = () => true;

describe('สถานะการอ่านข่าว', () => {
  it('ยังไม่เคยมีแถว = ยังไม่เคยอ่านอะไรเลย', async () => {
    // คำตอบที่ถูกสำหรับทุกคนในวันที่ฟีเจอร์นี้ขึ้นระบบ — ไม่มีใครเคยถูกบอกอะไร
    const s = await loadNoticeState(db(null), 'u1', all);
    expect(s.seen).toBe(0);
    expect(s.unread).toBeGreaterThan(0);
    expect(s.showBar).toBe(true);
  });

  it('อ่านครบแล้ว = ไม่มีทั้งจุดสีและแถบ', async () => {
    const s = await loadNoticeState(
      db({ seen_release: CURRENT_RELEASE, dismissed_release: CURRENT_RELEASE }),
      'u1',
      all,
    );
    expect(s.unread).toBe(0);
    expect(s.showBar).toBe(false);
  });

  it('กดไว้ก่อนแล้ว แถบหาย แต่ข่าวยังค้างรออ่านอยู่', async () => {
    const s = await loadNoticeState(
      db({ seen_release: 0, dismissed_release: CURRENT_RELEASE }),
      'u1',
      all,
    );
    expect(s.showBar).toBe(false);
    expect(s.unread).toBeGreaterThan(0);
  });

  it('เคยอ่านรุ่นเก่า แล้วมีรุ่นใหม่ แถบกลับมา', async () => {
    const s = await loadNoticeState(
      db({ seen_release: CURRENT_RELEASE - 1, dismissed_release: CURRENT_RELEASE - 1 }),
      'u1',
      all,
    );
    expect(s.showBar).toBe(true);
  });

  it('คนที่เข้าไม่ได้สักเมนู ยังเห็นเรื่องที่เป็นของทุกคน แต่ไม่เห็นของโมดูล', async () => {
    /*
      ข่าวอย่าง "ชี้เมาส์ที่ไฟล์แนบแล้วเห็นไฟล์" ไม่ได้เป็นของโมดูลไหน ทุกคน
      จึงเห็น ส่วนเรื่องคอลัมน์เช็คในรายงานขายส่ง ต้องไม่ตามมาด้วย
    */
    const none = await loadNoticeState(db(null), 'u1', () => false);
    const every = await loadNoticeState(db(null), 'u1', all);
    expect(none.unread).toBeGreaterThan(0);
    expect(none.unread).toBeLessThan(every.unread);
    expect(none.showBar).toBe(true);
  });

  it('อ่านฐานข้อมูลไม่ได้ ก็เงียบไว้ ไม่ใช่ขึ้นแถบค้างทุกหน้า', async () => {
    // ข่าวที่พลาดไปหนึ่งรอบ ดีกว่าแถบที่ลบไม่ออกเพราะเขียนสถานะกลับไม่ได้
    const s = await loadNoticeState(db(null, { message: 'boom' }), 'u1', all);
    expect(s.unread).toBe(0);
    expect(s.showBar).toBe(false);
  });
});
