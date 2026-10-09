import { describe, expect, it } from 'vitest';

import {
  countMissingEvidence,
  hasMissingEvidence,
  missingEvidence,
} from '@/lib/domain/paymentEvidence';

describe('paymentEvidence', () => {
  it('รับเงินไว้แต่ไม่มีไฟล์ = ขาดหลักฐาน', () => {
    expect(missingEvidence({ amount: 5000 })).toBe(true);
    expect(missingEvidence({ amount: 5000, attachments: [] })).toBe(true);
    expect(missingEvidence({ amount: 5000, attachments: null })).toBe(true);
  });

  it('มีไฟล์แล้วไม่ขาด', () => {
    expect(missingEvidence({ amount: 5000, attachments: ['cm/slip.jpg'] })).toBe(false);
  });

  it('แถวเปล่าไม่นับ', () => {
    /*
      ฟอร์มเปิดแถวว่างไว้ให้กรอก การเตือนตั้งแต่ยังไม่มีตัวเลขคือการเตือนที่ขึ้น
      ก่อนจะมีอะไรให้ลืม แล้วก็จะเป็นป้ายที่ติดอยู่ตลอดเวลาจนไม่มีใครอ่าน
    */
    expect(missingEvidence({ amount: 0 })).toBe(false);
    expect(missingEvidence({ amount: '' })).toBe(false);
  });

  it('ยอดที่เป็นสตริงจากฟอร์มก็อ่านออก', () => {
    expect(missingEvidence({ amount: '5000' })).toBe(true);
    expect(missingEvidence({ amount: '0' })).toBe(false);
  });

  it('ยอดติดลบนับด้วย — การคืนเงินก็ควรมีหลักฐาน', () => {
    expect(missingEvidence({ amount: -500 })).toBe(true);
  });

  it('นับจำนวนแถวที่ขาด และตอบว่าใบนี้มีแถวที่ขาดไหม', () => {
    const rows = [
      { amount: 3000, attachments: ['cm/a.jpg'] },
      { amount: 2000 },
      { amount: 0 },
      { amount: 1500, attachments: [] },
    ];
    expect(countMissingEvidence(rows)).toBe(2);
    expect(hasMissingEvidence(rows)).toBe(true);
    expect(hasMissingEvidence([{ amount: 3000, attachments: ['cm/a.jpg'] }])).toBe(false);
    expect(hasMissingEvidence([])).toBe(false);
  });
});
