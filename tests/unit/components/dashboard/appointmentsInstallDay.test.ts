import { describe, it, expect } from 'vitest';

import { shopDayKey } from '@/lib/domain/format';

import {
  buildAppointments,
  calendarEntries,
  upcomingRows,
  type AppointmentTicket,
} from '@/components/dashboard/appointments';

/**
 * ของที่ติดตั้งคนละวันกับหัวใบงาน คือการมาอีกครั้ง (ร้านแจ้ง 16 พ.ย. 2569).
 *
 * JT-LPG-00142 หัวใบงานเป็น 16 พ.ย. ส่วนฟิล์มนิรภัยนัดติดวันที่ 18 พ.ย. ซึ่ง
 * ร้านกรอกไว้ในช่อง "วันของรายการนี้" (migration 0089) ใบงานขายแยกใบให้แล้ว
 * แต่ปฏิทินวันที่ 18 เป็นช่องว่าง และคิวงานเจ็ดวันก็ไม่มีแถวของวันนั้น —
 * วันที่ช่างต้องว่างรอรถ จึงไม่เคยปรากฏที่ไหนเลย
 *
 * เป็นการมาอีกครั้ง ไม่ใช่สถานะ (ร้านเลือกเอง) ใบงานยังถือสถานะเดิมของมัน
 * และถูกนับแยกจากแถบสถานะ ไม่งั้นรถคันเดียวจะถูกนับเป็นสองงาน
 */

type Line = { category?: string; sold?: string; receivedAt?: string; deliveredAt?: string };
type Row = AppointmentTicket & {
  shop: string;
  statusHistory: { status: string; changedAt: Date }[];
};

const ticket = (lines: Line[], over: Partial<Row> = {}): Row => ({
  id: 'JT-LPG-00142',
  shop: 'lpg',
  customer: 'คุณ อัครพัชร์ มหายศนันท์',
  brand: 'JAECOO',
  model: '6T REEV',
  plate: '015070',
  serviceType: '',
  status: 'จองแล้ว',
  categories: ['ฟิล์มกรองแสง', 'ฟิล์มนิรภัย'],
  products: ['ฟิล์ม FN XT 05', 'ฟิล์มนิรภัย Sunroof'],
  dropOff: new Date('2026-11-16T15:00:00+07:00'),
  pickup: new Date('2026-11-16T17:00:00+07:00'),
  extras: {},
  statusHistory: [],
  lines,
  ...over,
});

const FILM: Line = { category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม FN XT 05' };
const LATER: Line = {
  category: 'ฟิล์มนิรภัย',
  sold: 'ฟิล์มนิรภัย Sunroof',
  receivedAt: '2026-11-18',
  deliveredAt: '2026-11-18',
};

const WINDOW_START = new Date('2026-11-16T00:00:00+07:00');
const WINDOW_END = new Date('2026-11-23T23:59:59+07:00');
const isVisit = (kind: string) =>
  ['แก้งาน', 'Service', 'เคลมประกัน', 'รถสไลด์', 'ติดตั้งเพิ่ม'].includes(kind);

// บนนาฬิกาของร้าน ไม่ใช่ของเครื่องที่รันเทสต์ — 18 พ.ย. 00:00 ที่กรุงเทพคือ
// 17 พ.ย. ตาม UTC ส่วนวันที่ปฏิทินวาดคือวันของร้าน
const dayKeys = (dates: (Date | null)[]) => dates.map(shopDayKey).sort();

describe('คิวงานเจ็ดวัน — ของที่ติดตั้งอีกวัน', () => {
  it('วันติดตั้งของรายการ ขึ้นเป็นคิวของตัวเอง', () => {
    const rows = upcomingRows(
      buildAppointments([ticket([FILM, LATER])], new Map()),
      WINDOW_START,
      WINDOW_END,
    );

    expect(rows).toHaveLength(2);
    const extra = rows.find((r) => r.serviceType === 'ติดตั้งเพิ่ม');
    expect(extra).toBeDefined();
    // แถวพูดถึงของที่ติดวันนั้น ไม่ใช่ของทั้งใบงาน
    expect(extra!.products).toEqual(['ฟิล์มนิรภัย Sunroof']);
    expect(extra!.categories).toEqual(['ฟิล์มนิรภัย']);
  });

  it('แถวการจองของวันแรก ไม่ถูกแทนที่', () => {
    /*
      ต่างจากเซอร์วิสตรงนี้: การติดตั้งรอบหลังไม่ได้มาแทนงานของวันแรก วันแรก
      ก็ยังมีรถเข้ามาและมีช่างที่ต้องว่าง
    */
    const rows = upcomingRows(
      buildAppointments([ticket([FILM, LATER])], new Map()),
      WINDOW_START,
      WINDOW_END,
    );

    expect(rows[0].serviceType).toBe('');
    expect(rows[0].dropOff).toEqual(new Date('2026-11-16T15:00:00+07:00'));
    expect(rows[1].serviceType).toBe('ติดตั้งเพิ่ม');
  });

  it('ของสามชิ้นที่นัดวันเดียวกัน คือรถเข้ามาครั้งเดียว', () => {
    const rows = upcomingRows(
      buildAppointments(
        [
          ticket([
            FILM,
            LATER,
            { ...LATER, category: 'สเปรย์', sold: 'สเปรย์ มิ้นท์' },
            { ...LATER, category: 'กล้อง', sold: 'กล้องหน้า-หลัง' },
          ]),
        ],
        new Map(),
      ),
      WINDOW_START,
      WINDOW_END,
    );

    const extras = rows.filter((r) => r.serviceType === 'ติดตั้งเพิ่ม');
    expect(extras).toHaveLength(1);
    expect(extras[0].products).toEqual(['ฟิล์มนิรภัย Sunroof', 'สเปรย์ มิ้นท์', 'กล้องหน้า-หลัง']);
  });

  it('รายการที่ใช้วันของใบงาน ไม่ทำให้เกิดคิวเพิ่ม', () => {
    // ว่าง = ใช้วันของใบงาน ซึ่งเป็นงานเกือบทั้งหมด — การ์ดต้องไม่งอกแถวขึ้นมา
    const rows = upcomingRows(
      buildAppointments([ticket([FILM, { category: 'สเปรย์', sold: 'สเปรย์ มิ้นท์' }])], new Map()),
      WINDOW_START,
      WINDOW_END,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].serviceType).toBe('');
  });

  it('กรอกวันตรงกับหัวใบงานพอดี ก็ไม่นับเป็นการมาอีกครั้ง', () => {
    const same: Line = { ...LATER, receivedAt: '2026-11-16', deliveredAt: '2026-11-16' };
    const rows = upcomingRows(
      buildAppointments([ticket([FILM, same])], new Map()),
      WINDOW_START,
      WINDOW_END,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].serviceType).toBe('');
  });

  it('กรอกแต่วันส่ง รถก็ยังเข้ามาวันเดิม จึงไม่ใช่การมาอีกครั้ง', () => {
    /*
      กฎเดียวกับหัวใบงาน (`appointmentDate`): งานถูกวางไว้ที่วันที่รถเข้ามา
      ส่วนวันส่งมอบจะขึ้นก็ต่อเมื่อสถานะเป็นรอส่งมอบแล้ว ถ้าบรรทัดอ่านด้วยกฎ
      คนละข้อกับใบงาน ปฏิทินจะบอกว่าของชิ้นนี้มีวันส่งที่ต้องเตรียมคน ส่วนของ
      อีกชิ้นในใบเดียวกันไม่มี ทั้งที่ทั้งคู่ส่งวันเดียวกัน

      ใบงานขายยังแยกใบตามวันส่งเหมือนเดิม — กระดาษพูดถึงการส่งมอบ ส่วนปฏิทิน
      พูดถึงวันที่ต้องมีคนอยู่หน้างาน
    */
    const rows = upcomingRows(
      buildAppointments(
        [ticket([FILM, { category: 'จอ', sold: 'จอแอนดรอยด์', deliveredAt: '2026-11-19' }])],
        new Map(),
      ),
      WINDOW_START,
      WINDOW_END,
    );

    expect(rows).toHaveLength(1);
  });

  it('บรรทัดที่ยังไม่ได้ขาย ไม่ใช่การนัด', () => {
    // ของที่ลูกค้ายัง "สนใจ" อยู่ ไม่มีใครต้องว่างรอมัน
    const rows = upcomingRows(
      buildAppointments(
        [ticket([FILM, { category: 'จอ', sold: '', deliveredAt: '2026-11-19' }])],
        new Map(),
      ),
      WINDOW_START,
      WINDOW_END,
    );

    expect(rows).toHaveLength(1);
  });

  it('ใบงานที่ยกเลิก ของที่นัดติดอีกวันก็ไม่ขึ้น', () => {
    const rows = upcomingRows(
      buildAppointments([ticket([FILM, LATER], { status: 'ยกเลิกนัด' })], new Map()),
      WINDOW_START,
      WINDOW_END,
    );

    expect(rows).toEqual([]);
  });
});

describe('ปฏิทิน — ของที่ติดตั้งอีกวัน', () => {
  it('วันที่ 18 ไม่ใช่ช่องว่างอีกต่อไป', () => {
    const t = ticket([FILM, LATER]);
    const out = calendarEntries([t], buildAppointments([t], new Map()), isVisit);

    expect(out).toHaveLength(2);
    expect(dayKeys(out.map((e) => e.dropOff))).toEqual(['2026-11-16', '2026-11-18']);
    expect(out.find((e) => e.status === 'ติดตั้งเพิ่ม')).toBeDefined();
  });

  it('งานที่รอส่งมอบ ของรอบหลังไปอยู่วันที่ส่งมอบของมันเอง', () => {
    /*
      กฎเดียวกับหัวใบงาน: งานที่รอส่งมอบถูกวางไว้ที่วันส่งมอบ เพราะวันที่รับ
      รถเข้ามาผ่านไปแล้ว ของรอบหลังก็ต้องอ่านด้วยกฎเดียวกัน ไม่งั้นมันจะไป
      นั่งอยู่วันที่ไม่มีใครต้องทำอะไร
    */
    const t = ticket([FILM, { ...LATER, receivedAt: '2026-11-18', deliveredAt: '2026-11-20' }], {
      status: 'รอส่งมอบ',
    });
    const out = calendarEntries([t], buildAppointments([t], new Map()), isVisit);

    expect(dayKeys(out.map((e) => e.dropOff))).toEqual(['2026-11-16', '2026-11-20']);
  });
});
