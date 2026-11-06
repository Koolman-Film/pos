import { describe, it, expect } from 'vitest';

import { summarisePendingCheques } from '@/lib/domain/cheques';

/**
 * เช็คที่รับมาแล้วแต่ยังขึ้นเงินไม่ได้ — กฎกลางที่หน้ารายการ PO กับหน้า
 * การจัดการเงิน/บัญชี ใช้ร่วมกัน (ร้านแจ้ง 6 พ.ย. 2569).
 */
const TODAY = '2026-11-06';

const chq = (due: string, amount = 1000) => ({ due, amount });

describe('summarisePendingCheques', () => {
  it('แยกยอดที่ถึงกำหนดแล้ว ออกจากยอดที่ยังไม่ถึง', () => {
    const out = summarisePendingCheques([chq('2026-10-02', 23000), chq('2026-12-25', 5000)], TODAY);
    expect(out.total).toBe(28000);
    expect(out.overdueTotal).toBe(23000);
    expect(out.upcomingTotal).toBe(5000);
  });

  it('เช็คลงวันที่วันนี้ ยังไม่เลยกำหนด', () => {
    // วันนี้คือวันแรกที่ขึ้นเงินได้ ไม่ใช่วันที่สาย
    const out = summarisePendingCheques([chq(TODAY)], TODAY);
    expect(out.rows[0].overdue).toBe(false);
    expect(out.upcomingTotal).toBe(1000);
  });

  it('ใบที่ไม่ได้ลงวันที่ ไม่นับว่าเลยกำหนด', () => {
    // การเรียกมันว่าสายจะส่งคนไปตามเช็คที่อาจยังไม่ถึงกำหนดด้วยซ้ำ
    const out = summarisePendingCheques([chq('')], TODAY);
    expect(out.rows[0].overdue).toBe(false);
    expect(out.overdueTotal).toBe(0);
  });

  it('เรียงวันที่ใกล้สุดก่อน และดันใบไม่มีวันที่ไปท้ายสุด', () => {
    const out = summarisePendingCheques([chq('2026-12-25'), chq(''), chq('2026-10-02')], TODAY);
    expect(out.rows.map((r) => r.due)).toEqual(['2026-10-02', '2026-12-25', '']);
  });

  it('ฟิลด์ของผู้เรียกติดไปด้วย ไม่ถูกกฎกลางกลืนทิ้ง', () => {
    // หน้าจอแต่ละหน้าถือข้อมูลคนละชุด — กฎรู้แค่ยอดกับวันที่
    const out = summarisePendingCheques([{ ...chq('2026-10-02'), chequeNo: '0071284' }], TODAY);
    expect(out.rows[0].chequeNo).toBe('0071284');
  });

  it('ไม่มีเช็คเลย ก็ตอบศูนย์ทุกช่อง', () => {
    const out = summarisePendingCheques([], TODAY);
    expect(out).toEqual({ rows: [], total: 0, overdueTotal: 0, upcomingTotal: 0 });
  });
});
