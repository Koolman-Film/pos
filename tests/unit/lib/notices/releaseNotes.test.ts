import { describe, it, expect } from 'vitest';

import {
  CURRENT_RELEASE,
  RELEASES,
  unreadCount,
  visibleReleases,
  type Release,
} from '@/lib/notices/releaseNotes';

/**
 * "มีอะไรใหม่" — กฎว่าใครได้ยินเรื่องไหน (ร้านขอ 17 พ.ย. 2569).
 *
 * หลักเดียวกับกระดิ่ง (docs/DESIGN-notifications.md): เห็นเฉพาะเรื่องที่เกี่ยว
 * กับงานที่ตัวเองทำได้ ถ้าไม่กรอง หัวหน้าช่างฟิล์มจะได้อ่านเรื่องคอลัมน์เช็ค
 * ในรายงานขายส่งทุกครั้งที่อัปเดต แล้วสัปดาห์ที่สามเขาจะเลิกอ่านทั้งหมด
 * รวมถึงเรื่องที่เป็นของเขาจริง ๆ
 */
const sample: Release[] = [
  {
    no: 1,
    date: '2026-11-01',
    title: 'รุ่นเก่า',
    notes: [
      { id: 'a', title: 'ของขายส่ง', what: '', why: '', kind: 'new', nav: ['wholesale'] },
      { id: 'b', title: 'ของทุกคน', what: '', why: '', kind: 'fixed' },
    ],
  },
  {
    no: 2,
    date: '2026-11-20',
    title: 'รุ่นใหม่',
    notes: [
      { id: 'c', title: 'ของสต็อก', what: '', why: '', kind: 'new', nav: ['stock'] },
      {
        id: 'd',
        title: 'ของสต็อกหรือขายส่ง',
        what: '',
        why: '',
        kind: 'changed',
        nav: ['stock', 'wholesale'],
      },
    ],
  },
];

const only =
  (...keys: string[]) =>
  (k: string) =>
    keys.includes(k);

describe('ใครเห็นเรื่องไหน', () => {
  it('เห็นเฉพาะเรื่องของเมนูที่ตัวเองเข้าได้', () => {
    const out = visibleReleases(only('stock'), { releases: sample });
    expect(out.flatMap((r) => r.notes.map((n) => n.id))).toEqual(['c', 'd', 'b']);
  });

  it('เรื่องที่ไม่ระบุเมนู ทุกคนเห็น', () => {
    // ของอย่าง "ชี้เมาส์ที่ไฟล์แนบแล้วเห็นไฟล์" ไม่ได้เป็นของโมดูลไหนโดยเฉพาะ
    const out = visibleReleases(() => false, { releases: sample });
    expect(out.flatMap((r) => r.notes.map((n) => n.id))).toEqual(['b']);
  });

  it('ระบุหลายเมนู = เข้าได้เมนูใดเมนูหนึ่งก็พอ', () => {
    const out = visibleReleases(only('wholesale'), { releases: sample });
    expect(out.flatMap((r) => r.notes.map((n) => n.id))).toEqual(['d', 'a', 'b']);
  });

  it('รุ่นที่ไม่เหลือเรื่องของคนนี้เลย ถูกตัดทั้งรุ่น', () => {
    /*
      หัวข้อรุ่นเปล่า ๆ อ่านแล้วเหมือนระบบซ่อนอะไรไว้ และทำให้คนเลื่อนผ่านของ
      ที่มีเนื้อหาจริง
    */
    const out = visibleReleases(only('stock'), { releases: [sample[0]] });
    expect(out.flatMap((r) => r.notes.map((n) => n.id))).toEqual(['b']);
    expect(out).toHaveLength(1);
  });

  it('ใหม่สุดอยู่บนสุด', () => {
    expect(visibleReleases(() => true, { releases: sample }).map((r) => r.no)).toEqual([2, 1]);
  });
});

describe('อ่านถึงไหนแล้ว', () => {
  it('นับเฉพาะรุ่นที่ยังไม่ได้อ่าน', () => {
    expect(unreadCount(() => true, 0)).toBeGreaterThan(0);
    expect(visibleReleases(() => true, { since: 1, releases: sample }).map((r) => r.no)).toEqual([
      2,
    ]);
  });

  it('อ่านครบแล้ว = ไม่เหลืออะไรค้าง', () => {
    expect(unreadCount(() => true, CURRENT_RELEASE)).toBe(0);
  });

  it('จำนวนที่ยังไม่ได้อ่าน นับตามสิทธิ์ของคนนั้น ไม่ใช่ของทั้งรุ่น', () => {
    // แถบบอกว่า "มี N เรื่องที่เกี่ยวกับงานของคุณ" — N ต้องเป็นของคนนั้นจริง ๆ
    const all = unreadCount(() => true, 0);
    const stockOnly = unreadCount(only('stock'), 0);
    expect(stockOnly).toBeGreaterThan(0);
    expect(stockOnly).toBeLessThan(all);
  });
});

describe('ข่าวที่ปล่อยจริง', () => {
  it('ทุกเรื่องมี id ไม่ซ้ำ', () => {
    // id คือคีย์ถาวรที่ลิงก์ชี้ถึง ซ้ำเมื่อไหร่ก็ชี้ผิดเรื่องเมื่อนั้น
    const ids = RELEASES.flatMap((r) => r.notes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('เลขรุ่นไม่ซ้ำ และ CURRENT_RELEASE คือตัวสูงสุด', () => {
    const nos = RELEASES.map((r) => r.no);
    expect(new Set(nos).size).toBe(nos.length);
    expect(CURRENT_RELEASE).toBe(Math.max(...nos));
  });

  it('ทุกเรื่องเขียนครบทั้งอะไรเปลี่ยนและทำไม', () => {
    /*
      "ทำไม" คือบรรทัดที่ทำให้คนเชื่อว่าของใหม่นี้มีไว้ทำอะไร ข่าวที่บอกแต่ว่า
      อะไรเปลี่ยน อ่านแล้วเหมือนรายการเปลี่ยนแปลงของโปรแกรมเมอร์
    */
    for (const n of RELEASES.flatMap((r) => r.notes)) {
      expect(n.title.length, n.id).toBeGreaterThan(0);
      expect(n.what.length, n.id).toBeGreaterThan(0);
      expect(n.why.length, n.id).toBeGreaterThan(0);
    }
  });

  it('วันที่ของรุ่นเป็นวันที่จริง', () => {
    for (const r of RELEASES) {
      expect(Number.isNaN(new Date(`${r.date}T00:00:00+07:00`).getTime()), r.title).toBe(false);
    }
  });
});
