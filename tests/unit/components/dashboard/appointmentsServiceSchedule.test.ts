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
