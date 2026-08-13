import { describe, it, expect, afterEach, vi } from 'vitest';

import { currentMonthValue, dateInputValue, daysAgoValue, todayValue } from '@/lib/domain/now';

/**
 * These four all used to go through `toISOString()`, which is UTC. Asia/Bangkok
 * is UTC+7, so for every local time before 07:00 they reported the PREVIOUS day
 * — the bug behind "เลือกวันที่ 1 ส.ค. แต่บันทึกเป็น 31 ก.ค.". The clock is
 * frozen just after local midnight here, which is exactly where UTC and local
 * disagree.
 */
const AT_MIDNIGHT_LOCAL = new Date(2026, 7, 1, 0, 30, 0); // 1 Aug 2026, 00:30 local

afterEach(() => {
  vi.useRealTimers();
});

describe('dateInputValue', () => {
  it('formats from the local calendar parts', () => {
    expect(dateInputValue(new Date(2026, 7, 1, 0, 30))).toBe('2026-08-01');
    expect(dateInputValue(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('accepts a date string and returns empty for nothing', () => {
    expect(dateInputValue('2026-08-01')).toBe('2026-08-01');
    expect(dateInputValue(null)).toBe('');
    expect(dateInputValue(undefined)).toBe('');
    expect(dateInputValue('not a date')).toBe('');
  });
});

describe('the period defaults just after local midnight', () => {
  it('todayValue is today, not yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(AT_MIDNIGHT_LOCAL);
    expect(todayValue()).toBe('2026-08-01');
  });

  it('currentMonthValue is this month, not last month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(AT_MIDNIGHT_LOCAL);
    expect(currentMonthValue()).toBe('2026-08');
  });

  it('daysAgoValue counts back from the local day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(AT_MIDNIGHT_LOCAL);
    expect(daysAgoValue(6)).toBe('2026-07-26');
    expect(daysAgoValue(0)).toBe('2026-08-01');
  });
});
