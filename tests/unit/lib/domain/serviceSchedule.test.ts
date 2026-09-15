import { describe, it, expect } from 'vitest';

import {
  addMonths,
  buildServiceSchedule,
  confirmServiceDate,
  resetServiceDate,
  skipSunday,
  suggestedServiceStart,
} from '@/lib/domain/serviceSchedule';

/**
 * นัดเข้า Service: เริ่ม 14 วันหลังส่งมอบ ทุก 6 เดือน วันอาทิตย์เลื่อนเป็นวันจันทร์
 * เป็นร่างจนกว่าพนักงานโทรยืนยันกับลูกค้า.
 */

describe('date steps', () => {
  it('moves a Sunday to the Monday and leaves other days alone', () => {
    expect(skipSunday('2026-09-20')).toBe('2026-09-21'); // อาทิตย์
    expect(skipSunday('2026-09-19')).toBe('2026-09-19'); // เสาร์
  });

  it('steps months on the calendar, clamping the 31st to a short month', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-09-30', 12)).toBe('2027-09-30');
  });

  it('suggests a start 14 days after handover, never on a Sunday', () => {
    expect(suggestedServiceStart('2026-09-15')).toBe('2026-09-29'); // อังคาร
    expect(suggestedServiceStart('2026-09-06')).toBe('2026-09-21'); // 20 = อาทิตย์ → จันทร์
    expect(suggestedServiceStart('')).toBe('');
  });
});

describe('buildServiceSchedule', () => {
  it('draws one draft per visit sold, every 6 months from the start', () => {
    expect(buildServiceSchedule('2026-09-29', 3)).toEqual([
      { no: 1, date: '2026-09-29', confirmed: false },
      { no: 2, date: '2027-03-29', confirmed: false },
      { no: 3, date: '2027-09-29', confirmed: false },
    ]);
  });

  it('moves a draft that lands on a Sunday to the Monday', () => {
    // 2027-03-28 is a Sunday.
    expect(buildServiceSchedule('2026-09-28', 2)[1]).toEqual({
      no: 2,
      date: '2027-03-29',
      confirmed: false,
    });
  });

  it('keeps a confirmed date exactly as written, even when the start moves', () => {
    const agreed = confirmServiceDate(buildServiceSchedule('2026-09-29', 3), 2, '2027-04-03');
    const moved = buildServiceSchedule('2026-10-06', 3, agreed);
    expect(moved[0]).toEqual({ no: 1, date: '2026-10-06', confirmed: false });
    expect(moved[1]).toEqual({ no: 2, date: '2027-04-03', confirmed: true });
    // Counted from ครั้งที่ 2 as agreed: 3 ต.ค. 2570 is a Sunday → Monday.
    expect(moved[2]).toEqual({ no: 3, date: '2027-10-04', confirmed: false });
  });

  it('counts each visit from the one before, so changing a date moves the ones after it', () => {
    const agreed = confirmServiceDate(buildServiceSchedule('2026-09-30', 3), 1, '2026-10-02');
    expect(buildServiceSchedule('2026-09-30', 3, agreed)).toEqual([
      { no: 1, date: '2026-10-02', confirmed: true },
      { no: 2, date: '2027-04-02', confirmed: false },
      { no: 3, date: '2027-10-02', confirmed: false },
    ]);
  });

  it('does not let a Sunday moved to Monday push every later visit a day later', () => {
    // 28 ก.ย. 2569 + 6 เดือน = 28 มี.ค. 2570, a Sunday → shown as the Monday; the
    // visit after is still counted from the 28th, not from the Monday.
    expect(buildServiceSchedule('2026-09-28', 3).map((s) => s.date)).toEqual([
      '2026-09-28',
      '2027-03-29',
      '2027-09-28',
    ]);
  });

  it('follows the number of visits sold', () => {
    expect(buildServiceSchedule('2026-09-29', 5)).toHaveLength(5);
    expect(buildServiceSchedule('2026-09-29', '2')).toHaveLength(2);
    expect(buildServiceSchedule('2026-09-29', '')).toEqual([]);
  });

  it('lists the visits without dates until there is a start date', () => {
    expect(buildServiceSchedule('', 2)).toEqual([
      { no: 1, date: '', confirmed: false },
      { no: 2, date: '', confirmed: false },
    ]);
  });

  it('puts a visit back to the rule when it is reset', () => {
    const agreed = confirmServiceDate(buildServiceSchedule('2026-09-29', 2), 2, '2027-04-03');
    const reset = buildServiceSchedule('2026-09-29', 2, resetServiceDate(agreed, 2));
    expect(reset[1]).toEqual({ no: 2, date: '2027-03-29', confirmed: false });
  });

  it('ignores anything malformed in what was stored', () => {
    expect(
      buildServiceSchedule('2026-09-29', 1, [{ no: 1, date: 'เมื่อไหร่ก็ได้', confirmed: true }]),
    ).toEqual([{ no: 1, date: '2026-09-29', confirmed: false }]);
    expect(buildServiceSchedule('2026-09-29', 1, 'junk')).toHaveLength(1);
  });
});
