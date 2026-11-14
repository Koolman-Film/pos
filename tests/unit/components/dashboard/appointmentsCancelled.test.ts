import { describe, it, expect } from 'vitest';

import {
  buildAppointments,
  calendarEntries,
  upcomingRows,
  type AppointmentTicket,
} from '@/components/dashboard/appointments';

/**
 * งานที่ยกเลิกแล้ว ไม่ใช่คิวงาน (ร้านแจ้ง 14 พ.ย. 2569).
 *
 * ร้านเห็นใบงานที่สถานะเป็น "ยกเลิกนัด" นั่งอยู่บนการ์ดนัดหมายเจ็ดวันเหมือนงาน
 * ที่ยังมาอยู่ และนับเป็นจุดบนปฏิทินของวันนั้น ทั้งการ์ดและปฏิทินตอบคำถาม
 * เดียวกัน — วันไหนต้องมีคนเตรียมพร้อม — งานที่ยกเลิกไปแล้วจึงไม่ใช่คำตอบ
 *
 * ที่ไม่ได้กรองคือแถบงานทั้งหมดกับงานล่าสุด เพราะสองอันนั้นเป็นสำมะโนของงาน
 * ทุกใบ และตัวเลขบนแถบกดแล้วเข้า Book งาน ถ้ากรองที่เดียวตัวเลขกับรายการที่
 * มันเปิดจะไม่ตรงกัน
 */

const ticket = (over: Partial<AppointmentTicket> & { shop?: string } = {}) => ({
  id: 'JT-CM-00164',
  shop: 'cm',
  customer: 'คุณ รุ่งทิพย์',
  brand: 'Deepal',
  model: 'S07',
  plate: 'จว8795',
  serviceType: '',
  status: 'จองแล้ว',
  categories: ['ฟิล์มกันรอย'],
  products: ['ฟิล์มกันรอย TPU 195 ไมครอน'],
  dropOff: new Date('2026-11-14T13:00:00+07:00'),
  pickup: new Date('2026-11-14T17:00:00+07:00'),
  extras: {},
  statusHistory: [] as { status: string; changedAt: Date }[],
  ...over,
});

const WINDOW_START = new Date('2026-11-14T00:00:00+07:00');
const WINDOW_END = new Date('2026-11-21T23:59:59+07:00');

const isVisit = (kind: string) => ['แก้งาน', 'Service', 'เคลมประกัน', 'รถสไลด์'].includes(kind);

describe('คิวงานเจ็ดวัน — งานที่ยกเลิก', () => {
  it('ใบงานที่ยกเลิกนัด ไม่อยู่ในคิว', () => {
    const live = ticket();
    const dead = ticket({ id: 'JT-CM-00165', status: 'ยกเลิกนัด' });

    const rows = upcomingRows(buildAppointments([live, dead], new Map()), WINDOW_START, WINDOW_END);

    expect(rows.map((r) => r.id)).toEqual(['JT-CM-00164']);
  });

  it('ใบงานที่ยังไม่ยกเลิก ยังอยู่ครบ และเรียงตามเวลานัด', () => {
    // ข้อนี้คือด่านกันเผลอ: กฎใหม่ต้องตัดเฉพาะที่ตั้งใจตัด
    const later = ticket({ id: 'JT-A', dropOff: new Date('2026-11-16T09:00:00+07:00') });
    const sooner = ticket({ id: 'JT-B', dropOff: new Date('2026-11-14T09:00:00+07:00') });

    const rows = upcomingRows(
      buildAppointments([later, sooner], new Map()),
      WINDOW_START,
      WINDOW_END,
    );

    expect(rows.map((r) => r.id)).toEqual(['JT-B', 'JT-A']);
  });

  it('เซอร์วิสที่นัดไว้บนใบที่ยกเลิก ก็ไม่โผล่', () => {
    // ใบงานถูกยกเลิก การมาของรถที่ผูกกับใบนั้นก็ไม่เกิด
    const dead = ticket({ status: 'ยกเลิกนัด' });

    const rows = upcomingRows(
      buildAppointments([dead], new Map([['JT-CM-00164', [{ from: '2026-11-18', to: '' }]]])),
      WINDOW_START,
      WINDOW_END,
    );

    expect(rows).toEqual([]);
  });
});

describe('ปฏิทิน — งานที่ยกเลิก', () => {
  it('ใบงานที่ยกเลิกนัด ไม่ถูกวาดลงวันนั้น', () => {
    const live = ticket();
    const dead = ticket({ id: 'JT-CM-00165', status: 'ยกเลิกนัด' });

    const out = calendarEntries([live, dead], buildAppointments([live, dead], new Map()), isVisit);

    expect(out.map((e) => e.id)).toEqual(['JT-CM-00164']);
  });

  it('ยกเลิกหลังจากเคยเปลี่ยนสถานะมาแล้ว ก็ยังหายไป', () => {
    /*
      ปฏิทินวางใบงานไว้ที่ "วันที่เปลี่ยนสถานะครั้งล่าสุด" เมื่อมีประวัติ ใบที่
      ถูกยกเลิกวันนี้จึงไปโผล่ที่วันนี้ ไม่ใช่วันรับงาน — ซึ่งเป็นรูปร่างที่
      ร้านเห็นจริง: จุดสีแดง "ยกเลิกนัด 1" อยู่ข้างจุด "จองแล้ว 1" ของวันเดียวกัน
    */
    const dead = ticket({
      status: 'ยกเลิกนัด',
      statusHistory: [
        { status: 'จองแล้ว', changedAt: new Date('2026-11-10T09:00:00+07:00') },
        { status: 'ยกเลิกนัด', changedAt: new Date('2026-11-14T10:00:00+07:00') },
      ],
    });

    expect(calendarEntries([dead], [], isVisit)).toEqual([]);
  });

  it('การมาของรถบนใบที่ยังอยู่ ยังถูกวาดตามเดิม', () => {
    const live = ticket();
    const out = calendarEntries(
      [live],
      buildAppointments([live], new Map([['JT-CM-00164', [{ from: '2026-11-18', to: '' }]]])),
      isVisit,
    );

    expect(out.map((e) => e.status).sort()).toEqual(['Service', 'จองแล้ว']);
    // แถวของการมาพูดถึงวันของตัวเอง จึงไม่ยืมประวัติสถานะของใบงานมาใช้
    expect(out.find((e) => e.status === 'Service')!.statusHistory).toEqual([]);
  });

  it('การมาของรถบนใบที่ยกเลิก ไม่ถูกวาด', () => {
    const dead = ticket({ status: 'ยกเลิกนัด' });
    const out = calendarEntries(
      [dead],
      buildAppointments([dead], new Map([['JT-CM-00164', [{ from: '2026-11-18', to: '' }]]])),
      isVisit,
    );

    expect(out).toEqual([]);
  });
});
