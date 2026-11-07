import { describe, it, expect } from 'vitest';

import { groupItemsByDeliveryDay, itemDates } from '@/components/tickets/itemDates';

/**
 * วันรับงาน/ส่งงานรายบรรทัด (migration 0089, ร้านแจ้ง 7 พ.ย. 2569).
 *
 * ลูกค้ากลับมาซื้อเพิ่มทีหลัง แล้วรายการนั้นถูกเพิ่มลงในใบงานใบเดิม ของสองชิ้น
 * ในใบเดียวกันจึงส่งมอบกันคนละวัน — เอกสารที่บอกวันเดียวจึงพูดไม่ตรงกับของที่
 * ลูกค้าได้รับไปจริง
 */
const JOB = {
  dropOff: new Date('2025-12-24T15:00:00+07:00'),
  pickup: new Date('2025-12-27T17:00:00+07:00'),
};

describe('itemDates — บรรทัดยืมวันของใบงาน เมื่อไม่ได้กำหนดเอง', () => {
  it('ไม่ได้กำหนดเอง = ใช้วันของใบงาน ซึ่งคือพฤติกรรมเดิมทั้งหมด', () => {
    const d = itemDates({}, JOB);
    expect(d).toEqual({ received: '2025-12-24', delivered: '2025-12-27', own: false });
  });

  it('กำหนดเองแล้ว ใช้วันของบรรทัด', () => {
    const d = itemDates({ receivedAt: '2026-01-05', deliveredAt: '2026-01-06' }, JOB);
    expect(d).toEqual({ received: '2026-01-05', delivered: '2026-01-06', own: true });
  });

  it('กำหนดข้างเดียวได้ อีกข้างยืมของใบงาน', () => {
    /*
      ของที่สั่งพร้อมงานแรกแต่มาส่งทีหลัง มีวันรับเป็นวันเดียวกับใบงาน การบังคับ
      ให้กรอกคู่จะทำให้คนต้องพิมพ์วันที่รู้อยู่แล้วซ้ำ หรือไม่ก็ปล่อยว่างทั้งคู่
    */
    const d = itemDates({ deliveredAt: '2026-01-10' }, JOB);
    expect(d).toEqual({ received: '2025-12-24', delivered: '2026-01-10', own: true });
  });

  it('ใบงานที่ยังไม่ได้นัด ก็ยังได้คำตอบ ไม่ใช่ค่าพัง', () => {
    const d = itemDates({}, { dropOff: null, pickup: null });
    expect(d).toEqual({ received: '', delivered: '', own: false });
  });
});

describe('groupItemsByDeliveryDay — ใบงานขายแยกตามวันส่ง', () => {
  const film = { deliveredAt: '' };
  const speaker = { receivedAt: '2026-01-05', deliveredAt: '2026-01-06' };

  it('งานที่ทำรอบเดียว ได้กลุ่มเดียว — เอกสารหน้าตาเหมือนเดิม', () => {
    const groups = groupItemsByDeliveryDay([film, {}], JOB);
    expect(groups).toHaveLength(1);
    expect(groups[0].day).toBe('2025-12-27');
  });

  it('ของที่ซื้อเพิ่มทีหลัง แยกเป็นกลุ่มของตัวเอง', () => {
    const groups = groupItemsByDeliveryDay([film, speaker], JOB);
    expect(groups.map((g) => g.day)).toEqual(['2025-12-27', '2026-01-06']);
    expect(groups[1].items).toEqual([speaker]);
  });

  it('เรียงตามวัน ไม่ใช่ตามลำดับที่พิมพ์เข้าไป', () => {
    // คนอ่านไล่จากงานแรกไปงานหลัง ลำดับที่พนักงานเพิ่มรายการไม่ได้แปลว่าอะไร
    const groups = groupItemsByDeliveryDay([speaker, film], JOB);
    expect(groups.map((g) => g.day)).toEqual(['2025-12-27', '2026-01-06']);
  });

  it('วันรับงานของกลุ่ม คือวันแรกสุดในกลุ่ม', () => {
    /*
      สองบรรทัดที่ส่งวันเดียวกันแต่รับคนละวัน หัวกลุ่มต้องบอกวันที่รถเข้ามา
      ครั้งแรก ไม่ใช่วันของบรรทัดที่บังเอิญถูกอ่านทีหลัง
    */
    const groups = groupItemsByDeliveryDay(
      [
        { receivedAt: '2026-01-05', deliveredAt: '2026-01-09' },
        { receivedAt: '2026-01-02', deliveredAt: '2026-01-09' },
      ],
      JOB,
    );
    expect(groups[0].received).toBe('2026-01-02');
  });

  it('บรรทัดที่ยังไม่มีวันส่ง ไปอยู่ท้ายสุด — มันไม่ได้อ้างว่าส่งวันไหน', () => {
    const groups = groupItemsByDeliveryDay([{}, { deliveredAt: '2026-01-06' }], {
      dropOff: null,
      pickup: null,
    });
    expect(groups.map((g) => g.day)).toEqual(['2026-01-06', '']);
  });
});
