import { describe, it, expect } from 'vitest';

import { checkCover, claimProblem, coverLeft } from '@/lib/domain/insuranceCover';

/**
 * เคลมประกันในการเซอร์วิส — the same rules the database enforces (0059), asked
 * by the form first so it can say why.
 */

const policy = {
  bigPieces: 2,
  smallPieces: 20,
  startsAt: '2026-08-01',
  endsAt: '2027-08-01',
  claims: [
    { bigUsed: 1, smallUsed: 5, serviceVisitId: 11 },
    { bigUsed: 0, smallUsed: 3, serviceVisitId: null },
  ],
};

describe('coverLeft', () => {
  it('takes every claim off the cover', () => {
    expect(coverLeft(policy)).toEqual({ big: 1, small: 12 });
  });

  it("leaves out the visit's own claim when it is being edited", () => {
    expect(coverLeft(policy, 11)).toEqual({ big: 2, small: 17 });
  });
});

describe('checkCover', () => {
  it('allows a claim on a day inside the cover', () => {
    expect(checkCover(policy, '2026-09-17')).toMatchObject({ ok: true, reason: '' });
  });

  it('refuses before the cover starts and after it ends', () => {
    expect(checkCover(policy, '2026-07-31')).toMatchObject({
      ok: false,
      reason: 'ประกันยังไม่เริ่มคุ้มครอง',
    });
    expect(checkCover(policy, '2027-08-02')).toMatchObject({
      ok: false,
      reason: 'ประกันหมดอายุแล้ว',
    });
  });

  it('counts the last day of cover as covered', () => {
    expect(checkCover(policy, '2027-08-01').ok).toBe(true);
  });

  it('refuses once every piece is used', () => {
    const spent = { ...policy, claims: [{ bigUsed: 2, smallUsed: 20 }] };
    expect(checkCover(spent, '2026-09-17')).toMatchObject({
      ok: false,
      reason: 'ใช้ความคุ้มครองครบแล้ว',
    });
  });
});

describe('claimProblem', () => {
  const ok = checkCover(policy, '2026-09-17');

  it('passes a claim within what is left', () => {
    expect(claimProblem(ok, 1, 12)).toBeNull();
  });

  it('asks for at least one piece', () => {
    expect(claimProblem(ok, 0, 0)).toBe('ระบุจำนวนชิ้นที่เคลมอย่างน้อย 1 ชิ้น');
  });

  it('refuses more than is left, and says what is', () => {
    expect(claimProblem(ok, 2, 0)).toBe(
      'เคลมเกินความคุ้มครองที่เหลือ (เหลือ 1 ชิ้นใหญ่, 12 ชิ้นเล็ก)',
    );
  });

  it('passes on the reason a policy cannot be used at all', () => {
    expect(claimProblem(checkCover(policy, '2028-01-01'), 1, 0)).toBe('ประกันหมดอายุแล้ว');
  });
});
