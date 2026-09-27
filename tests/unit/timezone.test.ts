import { describe, it, expect } from 'vitest';

import { todayValue } from '@/lib/domain/now';

/*
  The suite runs on the shop's clock, whatever the machine's is.

  Staff devices are set to Asia/Bangkok and client code (`todayValue`, date
  inputs) reads the device's zone. CI runners are UTC, so for the seven hours
  after midnight in Bangkok the two disagree about what "today" is — a test that
  compared them failed every morning and passed every afternoon. Pinning the
  zone in vitest.config.ts makes that impossible; this test fails at any hour
  if the pin is ever lost.
*/
describe('test environment clock', () => {
  it('runs in Asia/Bangkok', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Bangkok');
  });

  it('reads 06:30 Bangkok on the 23rd as the 23rd, not the UTC 22nd', () => {
    // 2026-09-22T23:30Z is 06:30 on the 23rd in Bangkok.
    expect(new Date('2026-09-22T23:30:00Z').getDate()).toBe(23);
  });

  it('agrees with the shop about today', () => {
    expect(todayValue()).toBe(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
  });
});
