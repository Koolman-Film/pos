import { describe, it, expect } from 'vitest';

import { buildAppointments, type AppointmentTicket } from '@/components/dashboard/appointments';

/**
 * การนัดหมายวันนี้ – อีก 7 วันข้างหน้า: หนึ่งวัน หนึ่งงาน.
 *
 * Found in real use: a car booked for 1 ก.ย. that also had a เซอร์วิส recorded
 * on 1 ก.ย. was listed twice on the same day — once under its booking heading
 * (which read "ยังไม่ระบุการนัดหมาย", because the ticket had no appointment type
 * set) and once under Service. The card is photographed and sent out, so two
 * rows for one car reads as two cars due that day.
 */

const ticket = (over: Partial<AppointmentTicket> = {}): AppointmentTicket => ({
  id: 'JT-CM-00164',
  customer: 'คุณ รุ่งทิพย์',
  brand: 'Deepal',
  model: 'S07',
  plate: 'จว8795',
  serviceType: '',
  status: 'จองแล้ว',
  categories: ['ฟิล์มกันรอย'],
  products: ['ฟิล์มกันรอย TPU 195 ไมครอน'],
  dropOff: new Date('2026-09-01T09:00:00+07:00'),
  pickup: new Date('2026-09-01T11:00:00+07:00'),
  extras: {},
  ...over,
});

const kinds = (rows: { row: { serviceType: string } }[]) => rows.map((a) => a.row.serviceType);

describe('buildAppointments — หนึ่งวัน หนึ่งงาน', () => {
  it('shows only the เซอร์วิส when it falls on the booking’s own day', () => {
    const out = buildAppointments(
      [ticket()],
      new Map([['JT-CM-00164', [{ from: '2026-09-01', to: '' }]]]),
    );
    expect(kinds(out)).toEqual(['Service']);
  });

  it('keeps both when the car comes back on a different day', () => {
    // Booked Monday, back for a เซอร์วิส on Friday: two days somebody has to be
    // ready. Hiding the booking would take Monday off the card entirely.
    const out = buildAppointments(
      [ticket()],
      new Map([['JT-CM-00164', [{ from: '2026-09-05', to: '' }]]]),
    );
    expect(kinds(out).sort()).toEqual(['', 'Service']);
    expect(out.find((a) => a.row.serviceType === '')!.appt).toEqual(
      new Date('2026-09-01T09:00:00+07:00'),
    );
  });

  it('suppresses the booking for a งานแก้ on the same day too', () => {
    const out = buildAppointments(
      [
        ticket({
          extras: {
            แก้งาน: { checked: true, receivedAt: '2026-09-01', category: 'ฟิล์มกันรอย' },
          },
        }),
      ],
      new Map(),
    );
    expect(kinds(out)).toEqual(['แก้งาน']);
  });

  it('leaves a ticket with no visits exactly as it was', () => {
    const out = buildAppointments([ticket({ serviceType: 'เข้าทำ/ติดตั้ง' })], new Map());
    expect(kinds(out)).toEqual(['เข้าทำ/ติดตั้ง']);
  });

  it('measures the day on the shop’s clock, not the server’s', () => {
    // A 09:00 Bangkok booking is 02:00 UTC the same day; on a UTC server a
    // naive date comparison still agrees. The case that bites is the evening:
    // 23:00 Bangkok on the 1st is 16:00 UTC on the 1st, but a pickup-driven
    // appointment at 00:30 Bangkok on the 2nd is 17:30 UTC on the 1st — the
    // same UTC day, a different shop day.
    const out = buildAppointments(
      [
        ticket({
          status: 'รอส่งมอบ',
          dropOff: new Date('2026-09-01T09:00:00+07:00'),
          pickup: new Date('2026-09-02T00:30:00+07:00'),
        }),
      ],
      new Map([['JT-CM-00164', [{ from: '2026-09-01', to: '' }]]]),
    );
    // The booking is due on the 2nd (รอส่งมอบ reads the pickup); the visit is on
    // the 1st. Different days, so both stand.
    expect(kinds(out).sort()).toEqual(['', 'Service']);
  });

  it('drops a visit row with no dates at all rather than inventing one', () => {
    const out = buildAppointments([ticket()], new Map([['JT-CM-00164', [{ from: '', to: '' }]]]));
    expect(kinds(out)).toEqual(['']);
  });
});
