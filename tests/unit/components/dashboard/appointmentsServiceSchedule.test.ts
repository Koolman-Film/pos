import { describe, it, expect } from 'vitest';

import { buildAppointments, type AppointmentTicket } from '@/components/dashboard/appointments';

/**
 * นัดเข้า Service บนแดชบอร์ด — the drafted visits show up so the salesperson
 * knows whom to ring, and the ones already made do not show again.
 */

const ticket = (service: Record<string, unknown>): AppointmentTicket => ({
  id: 'JT-CM-00164',
  customer: 'คุณ รุ่งทิพย์',
  brand: 'Deepal',
  model: 'S07',
  plate: 'จว8795',
  serviceType: '',
  status: 'ส่งมอบแล้ว',
  categories: ['ฟิล์มกันรอย'],
  products: ['ฟิล์มกันรอย TPU 195 ไมครอน'],
  dropOff: new Date('2026-09-01T09:00:00+07:00'),
  pickup: new Date('2026-09-15T11:00:00+07:00'),
  extras: { Service: { checked: true, ...service } },
});

const scheduled = (out: ReturnType<typeof buildAppointments>) =>
  out
    .filter((a) => a.row.products.some((p) => p.startsWith('นัด Service')))
    .map((a) => ({ product: a.row.products[0], day: a.appt?.toISOString().slice(0, 10) }));

describe('buildAppointments — นัดเข้า Service', () => {
  it('puts every drafted visit on the calendar, marked as a draft', () => {
    const out = buildAppointments(
      [ticket({ serviceDate: '2026-09-29', serviceCount: 2 })],
      new Map(),
    );
    expect(scheduled(out).map((s) => s.product)).toEqual([
      'นัด Service ครั้งที่ 1 (ร่าง — รอโทรยืนยัน)',
      'นัด Service ครั้งที่ 2 (ร่าง — รอโทรยืนยัน)',
    ]);
  });

  it('uses the day the customer agreed, without the draft mark', () => {
    const out = buildAppointments(
      [
        ticket({
          serviceDate: '2026-09-29',
          serviceCount: 2,
          schedule: [{ no: 2, date: '2027-04-03', confirmed: true }],
        }),
      ],
      new Map(),
    );
    expect(scheduled(out)[1].product).toBe('นัด Service ครั้งที่ 2');
    // Midnight on the shop's clock is the previous evening in UTC.
    expect(scheduled(out)[1].day).toBe('2027-04-02');
  });

  it('does not list a visit again once the car has been in for it', () => {
    const out = buildAppointments(
      [ticket({ serviceDate: '2026-09-29', serviceCount: 3 })],
      new Map([['JT-CM-00164', [{ from: '2026-09-30', to: '' }]]]),
    );
    expect(scheduled(out).map((s) => s.product)).toEqual([
      'นัด Service ครั้งที่ 2 (ร่าง — รอโทรยืนยัน)',
      'นัด Service ครั้งที่ 3 (ร่าง — รอโทรยืนยัน)',
    ]);
  });

  it('adds nothing while there is no start date', () => {
    const out = buildAppointments([ticket({ serviceCount: 3 })], new Map());
    expect(scheduled(out)).toEqual([]);
  });
});

/**
 * นัด Service ซ้ำกับการเข้ารับบริการจริง (ร้านเจอ 7 พ.ย. 2569).
 *
 * การ์ด 7 วันแสดงรถคันเดียวกันสองแถวในวันเดียวกัน ต่างกันแค่แถวหนึ่งมีเวลา
 * กำกับ อีกแถวไม่มี — แถวที่มีเวลาคือการเข้ารับบริการที่บันทึกไว้จริง ส่วนแถว
 * ที่ไม่มีเวลาคือ "นัด Service ครั้งที่ 3" ที่ยังค้างอยู่ในตารางนัด
 *
 * นัดคือแผน การเข้ารับบริการคือสิ่งที่เกิดขึ้นจริง รถคันเดียวเข้ามาวันเดียว
 */
describe('buildAppointments — นัด Service ต้องไม่ซ้ำกับการเข้ารับบริการ', () => {
  const SERVICE = { serviceDate: '2026-09-29', serviceCount: 3 };

  it('วันที่มีคนเข้ามาจริงแล้ว ไม่วาดนัดของวันนั้นซ้ำอีก', () => {
    const out = buildAppointments(
      [
        ticket({
          ...SERVICE,
          // ร้านโทรยืนยันครั้งที่ 3 เป็นวันที่ 7 พ.ย. แล้วรถก็เข้ามาวันนั้นจริง
          schedule: [{ no: 3, date: '2026-11-07', confirmed: true }],
        }),
      ],
      new Map([
        [
          'JT-CM-00164',
          [
            { from: '2026-03-30', to: '', no: 1 },
            { from: '2026-11-07', to: '', fromTime: '10:00', no: 3 },
          ],
        ],
      ]),
    );
    expect(scheduled(out).map((s) => s.product)).not.toContain('นัด Service ครั้งที่ 3');
  });

  it('ตัดนัดที่ผ่านไปแล้วด้วยเลขครั้ง ไม่ใช่จำนวนแถว', () => {
    /*
      ร้านบันทึกครั้งที่ 1 กับ 3 ไว้ (ครั้งที่ 2 ลูกค้าไม่ได้มา) จำนวนแถวได้ 2
      กฎเดิมจึงตัดแค่ครั้งที่ 1 กับ 2 แล้วยังวาดครั้งที่ 3 ที่เข้ามาแล้วค้างไว้
      — ส่วนครั้งที่ 2 ที่ยังไม่ได้มา ต้องอยู่ต่อ เพราะยังต้องโทรตาม
    */
    const out = buildAppointments(
      [ticket(SERVICE)],
      new Map([
        [
          'JT-CM-00164',
          [
            { from: '2026-10-13', to: '', no: 1 },
            { from: '2027-10-11', to: '', no: 3 },
          ],
        ],
      ]),
    );
    const products = scheduled(out).map((s) => s.product);
    expect(products).toContain('นัด Service ครั้งที่ 2 (ร่าง — รอโทรยืนยัน)');
    expect(products).not.toContain('นัด Service ครั้งที่ 3 (ร่าง — รอโทรยืนยัน)');
  });

  it('ไม่มีเลขครั้งมาด้วย ก็ยังใช้กฎเดิมคือนับจำนวนแถว', () => {
    // ผู้เรียกที่ยังไม่ได้ส่งเลขครั้งมา ต้องไม่เห็นนัดที่ผ่านไปแล้วโผล่กลับมาทั้งชุด
    const out = buildAppointments(
      [ticket(SERVICE)],
      new Map([['JT-CM-00164', [{ from: '2026-10-13', to: '' }]]]),
    );
    expect(scheduled(out).map((s) => s.product)).toEqual([
      'นัด Service ครั้งที่ 2 (ร่าง — รอโทรยืนยัน)',
      'นัด Service ครั้งที่ 3 (ร่าง — รอโทรยืนยัน)',
    ]);
  });

  it('นัดที่ยังมาไม่ถึง ยังอยู่ครบ แม้จะมีการเข้ารับบริการวันอื่นแล้ว', () => {
    // กันไม่ให้การแก้นี้กลายเป็นการกลืนนัดที่ยังต้องโทรตามไปด้วย
    const out = buildAppointments(
      [ticket(SERVICE)],
      new Map([['JT-CM-00164', [{ from: '2026-10-13', to: '', no: 1 }]]]),
    );
    expect(scheduled(out).map((s) => s.product)).toEqual([
      'นัด Service ครั้งที่ 2 (ร่าง — รอโทรยืนยัน)',
      'นัด Service ครั้งที่ 3 (ร่าง — รอโทรยืนยัน)',
    ]);
  });
});
