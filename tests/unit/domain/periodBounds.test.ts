import { describe, it, expect } from 'vitest';

import { periodBounds, spanOverlapsPeriod } from '@/lib/domain/period';
import { shopDayKey } from '@/lib/domain/format';

const TODAY = '2026-09-14';

describe('periodBounds', () => {
  it('is one day for วันนี้', () => {
    expect(periodBounds('today', '', '', '', TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it('runs to the real last day of the month', () => {
    expect(periodBounds('month', '2026-09', '', '', TODAY)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(periodBounds('month', '2026-02', '', '', TODAY).to).toBe('2026-02-28');
    expect(periodBounds('month', '2028-02', '', '', TODAY).to).toBe('2028-02-29');
  });

  it('falls back to this month when the month value is unusable', () => {
    expect(periodBounds('month', '', '', '', TODAY).from).toBe('2026-09-01');
  });

  it('accepts a Buddhist-era or a CE year', () => {
    const want = { from: '2026-01-01', to: '2026-12-31' };
    expect(periodBounds('year', '2569', '', '', TODAY)).toEqual(want);
    expect(periodBounds('year', '2026', '', '', TODAY)).toEqual(want);
  });

  it('keeps an open side open, and puts a reversed range the right way round', () => {
    expect(periodBounds('range', '2026-09-01', '2026-09-01', '', TODAY)).toEqual({
      from: '2026-09-01',
      to: '',
    });
    expect(periodBounds('range', '', '2026-09-20', '2026-09-01', TODAY)).toEqual({
      from: '2026-09-01',
      to: '2026-09-20',
    });
  });
});

/**
 * งานกินเวลา เงินไม่กิน (ร้านขอ 15 ต.ค. 2569).
 *
 * "หากเลือกวันนี้ จะแสดงแค่งานที่จองวันนี้ ปรับให้แสดงงานที่อยู่ในช่วงของวันนี้
 * ทุกงาน" — รถที่รับมาเมื่อวานและยังไม่ได้ส่งคืน คือรถที่ยังอยู่ในร้านวันนี้
 */
describe('spanOverlapsPeriod', () => {
  const today = shopDayKey(new Date());
  const day = (offset: number) =>
    new Date(new Date(`${today}T00:00:00+07:00`).getTime() + offset * 86400000);

  const todayHas = (from: Date | null, to: Date | null) =>
    spanOverlapsPeriod(from, to, 'today', '', '', '');

  it('งานที่รับวันนี้ ยังอยู่เหมือนเดิม', () => {
    expect(todayHas(day(0), day(0))).toBe(true);
  });

  it('รับเมื่อวาน ส่งพรุ่งนี้ = ยังอยู่ในร้านวันนี้', () => {
    // นี่คือใบที่หายไปทั้งที่เป็นงานที่ต้องทำวันนี้
    expect(todayHas(day(-1), day(1))).toBe(true);
  });

  it('จบไปเมื่อวานแล้ว ไม่ขึ้น', () => {
    expect(todayHas(day(-3), day(-1))).toBe(false);
  });

  it('ยังไม่เริ่ม ไม่ขึ้น', () => {
    expect(todayHas(day(2), day(3))).toBe(false);
  });

  it('ไม่มีวันส่ง = งานวันเดียว', () => {
    expect(todayHas(day(0), null)).toBe(true);
    expect(todayHas(day(-1), null)).toBe(false);
  });

  it('วันส่งอยู่ก่อนวันรับ (ข้อมูลผิด) ก็ยังอ่านเป็นช่วงได้', () => {
    expect(todayHas(day(1), day(-1))).toBe(true);
  });

  it('ช่วงเวลาที่เลือกเอง ใช้กติกาเดียวกัน', () => {
    const inRange = (from: string, to: string) =>
      spanOverlapsPeriod(
        new Date(`${from}T00:00:00+07:00`),
        new Date(`${to}T00:00:00+07:00`),
        'range',
        '',
        '2026-10-10',
        '2026-10-20',
      );
    expect(inRange('2026-10-08', '2026-10-12')).toBe(true);
    expect(inRange('2026-10-01', '2026-10-05')).toBe(false);
    expect(inRange('2026-10-25', '2026-10-26')).toBe(false);
  });

  it('ไม่มีวันเลย ไม่ถูกคัดทิ้ง — เหมือนที่ isInPeriod ทำ', () => {
    expect(todayHas(null, null)).toBe(true);
  });
});
