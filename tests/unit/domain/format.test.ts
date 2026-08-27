import { describe, it, expect } from 'vitest';
import {
  fmt,
  fmtThaiDate,
  hhmm,
  shopDayKey,
  startOfShopDay,
  thaiBahtText,
  daysFromNow,
} from '@/lib/domain/format';

describe('fmt', () => {
  it('formats a number as Thai-locale currency-style with 2 decimals', () => {
    expect(fmt(1234.5)).toBe('1,234.50');
  });
  it('treats null/undefined as 0', () => {
    expect(fmt(undefined)).toBe('0.00');
    expect(fmt(null)).toBe('0.00');
  });
  it('groups thousands', () => {
    expect(fmt(1234567.891)).toBe('1,234,567.89');
  });
  it('formats 0 as 0.00', () => {
    expect(fmt(0)).toBe('0.00');
  });
});

describe('fmtThaiDate', () => {
  it('returns "-" for a null/undefined date', () => {
    expect(fmtThaiDate(null)).toBe('-');
    expect(fmtThaiDate(undefined)).toBe('-');
  });
  it('formats a date in the Thai locale (Buddhist era, short month)', () => {
    expect(fmtThaiDate(new Date(2026, 6, 15))).toBe('15 ก.ค. 2569');
  });
});

describe('thaiBahtText', () => {
  it('renders zero as ศูนย์บาทถ้วน', () => {
    expect(thaiBahtText(0)).toBe('ศูนย์บาทถ้วน');
  });
  it('renders a simple whole number', () => {
    expect(thaiBahtText(100)).toBe('หนึ่งร้อยบาทถ้วน');
  });
  it('renders the irregular tens (สิบ / ยี่สิบ) and the units เอ็ด', () => {
    expect(thaiBahtText(10)).toBe('สิบบาทถ้วน');
    expect(thaiBahtText(11)).toBe('สิบเอ็ดบาทถ้วน');
    expect(thaiBahtText(20)).toBe('ยี่สิบบาทถ้วน');
    expect(thaiBahtText(21)).toBe('ยี่สิบเอ็ดบาทถ้วน');
    expect(thaiBahtText(25)).toBe('ยี่สิบห้าบาทถ้วน');
    expect(thaiBahtText(1)).toBe('หนึ่งบาทถ้วน');
  });
  it('renders hundreds and thousands', () => {
    expect(thaiBahtText(101)).toBe('หนึ่งร้อยเอ็ดบาทถ้วน');
    expect(thaiBahtText(111)).toBe('หนึ่งร้อยสิบเอ็ดบาทถ้วน');
    expect(thaiBahtText(1000)).toBe('หนึ่งพันบาทถ้วน');
    expect(thaiBahtText(5100)).toBe('ห้าพันหนึ่งร้อยบาทถ้วน');
  });
  it('renders millions with the ล้าน group separator', () => {
    expect(thaiBahtText(1000000)).toBe('หนึ่งล้านบาทถ้วน');
    expect(thaiBahtText(21000000)).toBe('ยี่สิบเอ็ดล้านบาทถ้วน');
    expect(thaiBahtText(1234567)).toBe('หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน');
    expect(thaiBahtText(1000021)).toBe('หนึ่งล้านยี่สิบเอ็ดบาทถ้วน');
  });
  it('says หนึ่ง (not เอ็ด) for a lone unit in a later million-group', () => {
    // prototype quirk: the group is left-zero-stripped to "1", so len===1 and the
    // เอ็ด rule (which requires len>1) does not fire.
    expect(thaiBahtText(1000001)).toBe('หนึ่งล้านหนึ่งบาทถ้วน');
  });
  it('rounds satang to the nearest baht', () => {
    expect(thaiBahtText(1234.5)).toBe('หนึ่งพันสองร้อยสามสิบห้าบาทถ้วน');
    expect(thaiBahtText(1234.4)).toBe('หนึ่งพันสองร้อยสามสิบสี่บาทถ้วน');
  });
});

describe('daysFromNow', () => {
  it('returns a date n days from now, normalized to 09:00', () => {
    const d = daysFromNow(1);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
  it('offsets the calendar day by n', () => {
    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    const d = daysFromNow(7);
    expect(d.getFullYear()).toBe(expected.getFullYear());
    expect(d.getMonth()).toBe(expected.getMonth());
    expect(d.getDate()).toBe(expected.getDate());
  });
  it('accepts negative offsets', () => {
    const expected = new Date();
    expected.setDate(expected.getDate() - 3);
    expect(daysFromNow(-3).getDate()).toBe(expected.getDate());
  });
});

/**
 * The shop's clock (Asia/Bangkok), not the process's.
 *
 * A `timestamptz` is an instant; turning it into "16:00" needs a zone. These ran
 * in whatever zone the process happened to be in — the shop's own machine in
 * development, UTC on the deployed server — so a job booked for 11:00 printed as
 * 04:00 on the live site and looked right on the laptop. Every assertion below
 * must hold with TZ=UTC, TZ=Asia/Bangkok and anything else.
 */
describe('shop-clock formatting', () => {
  const elevenAm = new Date('2026-08-27T11:00:00+07:00');
  const fourPm = new Date('2026-08-27T16:00:00+07:00');
  // 02:00 in Bangkok is still the PREVIOUS day in UTC.
  const earlyMorning = new Date('2026-08-27T02:00:00+07:00');

  it('prints the time the ticket was booked for', () => {
    expect(hhmm(elevenAm)).toBe('11:00');
    expect(hhmm(fourPm)).toBe('16:00');
    expect(hhmm(earlyMorning)).toBe('02:00');
  });

  it('prints the day the shop is open on, not the server\u2019s day', () => {
    expect(fmtThaiDate(earlyMorning)).toBe('27 ส.ค. 2569');
    expect(fmtThaiDate(fourPm)).toBe('27 ส.ค. 2569');
  });

  it('groups by the shop\u2019s calendar day', () => {
    expect(shopDayKey(earlyMorning)).toBe('2026-08-27');
    expect(shopDayKey(fourPm)).toBe('2026-08-27');
    // …and a booking half an hour later belongs to the next day.
    expect(shopDayKey(new Date('2026-08-27T23:30:00+07:00'))).toBe('2026-08-27');
    expect(shopDayKey(new Date('2026-08-28T00:30:00+07:00'))).toBe('2026-08-28');
  });

  it('starts the shop day at midnight in Bangkok', () => {
    // Not the server's midnight, which is 07:00 in Bangkok — the seven hours the
    // 7-day booking window used to lose off the front of every day.
    expect(startOfShopDay(fourPm).toISOString()).toBe('2026-08-26T17:00:00.000Z');
  });

  it('has nothing to say about a missing or broken date', () => {
    expect(hhmm(null)).toBe('');
    expect(hhmm(new Date('nonsense'))).toBe('');
    expect(fmtThaiDate(null)).toBe('-');
    expect(shopDayKey(undefined)).toBe('');
  });
});
