import { shopDayKey } from '@/lib/domain/format';

import { appointmentDate, type UpcomingTicket } from './Dashboard';

/**
 * การนัดหมายของใบงานหนึ่งใบ — one ticket, several appointments.
 *
 * The booking is one. A งานแก้ is another (the car comes back on its own day),
 * and every recorded เซอร์วิส visit is another again. They were invisible on the
 * dashboard once: the 7-day card read the ticket's own dates, which are in the
 * past by the time a car returns, so the day somebody actually had to be ready
 * never appeared.
 *
 * Lives beside `receivables.ts` rather than inside the page for the same reason
 * that one does: it is the only real logic on the page, and a Server Component
 * cannot be rendered in a unit test.
 */

/** The fields of a dashboard ticket that an appointment is derived from. */
export type AppointmentTicket = {
  id: string;
  customer: string;
  brand: string;
  model: string;
  plate: string;
  serviceType: string;
  status: string;
  categories: string[];
  products: string[];
  dropOff: Date | null;
  pickup: Date | null;
  extras: Record<string, Record<string, unknown>>;
};

export type Appointment<T extends AppointmentTicket = AppointmentTicket> = {
  t: T;
  appt: Date | null;
  row: UpcomingTicket;
};

/**
 * A visit as stored: a date and the clock the shop wrote beside it, either of
 * which may be empty. The time is free text ("16:00") because that is how the
 * paper form works and how `service_visits` and `insurance_claims` store it.
 */
/** One leg of a รถสไลด์ — where the car is moved from and to, and when. */
export type SlideLeg = { from?: string; to?: string; date?: string; time?: string };

export type VisitDates = {
  from: string;
  to: string;
  fromTime?: string;
  toTime?: string;
  /** What the visit is for — printed under the row when there is one. */
  detail?: string;
};

/**
 * Date + optional clock, read on the SHOP's clock — the server runs UTC.
 *
 * Without the time the card could only ever say which day, so a เซอร์วิส at
 * 16:00 and one at 09:00 read identically. A missing time falls back to
 * midnight, which `appointmentTime` renders as blank rather than "00:00".
 */
const asDate = (v: string, time = '') =>
  v ? new Date(`${v}T${/^\d{2}:\d{2}$/.test(time) ? time : '00:00'}:00+07:00`) : null;

export function buildAppointments<T extends AppointmentTicket>(
  tickets: T[],
  visitsByTicket: Map<string, VisitDates[]>,
  claimsByTicket: Map<string, VisitDates[]> = new Map(),
): Appointment<T>[] {
  const appointments: Appointment<T>[] = [];

  for (const t of tickets) {
    const base: UpcomingTicket = {
      id: t.id,
      customer: t.customer,
      brand: t.brand,
      model: t.model,
      plate: t.plate,
      serviceType: t.serviceType,
      categories: t.categories,
      products: t.products,
      dropOff: t.dropOff as Date,
      status: t.status,
      pickup: t.pickup,
    };

    /*
      หนึ่งวัน หนึ่งงาน.

      A car that comes in for a เซอร์วิส on the same day its ใบงาน is booked
      appeared TWICE on the card — once under its booking heading and once under
      Service — which reads as two cars due that day when it is one car making
      one visit. The visit is the specific thing: it names what is actually
      happening to the car, so it wins and the booking row for that day goes.

      Per DAY, not per ticket. A job booked Monday that comes back for a
      เซอร์วิส on Friday really is two appointments in the week, and dropping
      Monday would take a day somebody has to be ready off the card entirely.
    */
    const visits: Appointment<T>[] = [];

    const rework = t.extras['แก้งาน'];
    if (rework?.checked) {
      const from = asDate(String(rework.receivedAt ?? ''), String(rework.receivedTime ?? ''));
      const to = asDate(String(rework.deliveredAt ?? ''), String(rework.deliveredTime ?? ''));
      if (from || to) {
        const category = String(rework.category ?? '').trim();
        visits.push({
          t,
          appt: appointmentDate({ status: t.status, dropOff: from, pickup: to }),
          row: {
            ...base,
            serviceType: 'แก้งาน',
            categories: category ? [category] : t.categories,
            products: [String(rework.detail ?? '').trim()].filter(Boolean),
            dropOff: (from ?? to) as Date,
            pickup: to,
          },
        });
      }
    }

    /**
     * `categories` names what the row is about, and for a เคลมประกัน that is
     * always the wrap warranty — not whatever else the ticket happened to
     * carry. A เซอร์วิส keeps the ticket’s categories: it is a visit on the
     * whole job.
     */
    const pushVisits = (rows: VisitDates[], label: string, categories?: string[]) => {
      for (const v of rows) {
        const from = asDate(v.from, v.fromTime);
        const to = asDate(v.to, v.toTime);
        if (!from && !to) continue;
        visits.push({
          t,
          appt: appointmentDate({ status: t.status, dropOff: from, pickup: to }),
          row: {
            ...base,
            serviceType: label,
            categories: categories ?? base.categories,
            products: v.detail ? [v.detail] : base.products,
            dropOff: (from ?? to) as Date,
            pickup: to,
          },
        });
      }
    };
    pushVisits(visitsByTicket.get(t.id) ?? [], 'Service');
    pushVisits(claimsByTicket.get(t.id) ?? [], 'เคลมประกัน', ['ฟิล์มกันรอย']);

    const visitDays = new Set<string>();
    for (const v of visits) {
      if (v.appt) visitDays.add(shopDayKey(v.appt));
      appointments.push(v);
    }

    /*
      รถสไลด์ — every leg, each on its own day and time.

      Deliberately NOT one of the rows above: a leg is the truck moving the car,
      not the work being done to it, so it does not stand in for the booking the
      way a เซอร์วิส does. A car collected at 09:00 and fitted the same day is
      two things the shop has to be ready for, and both belong on the card.
    */
    const slide = t.extras['รถสไลด์'];
    if (slide?.checked) {
      const legs = (slide.legs as SlideLeg[] | undefined) ?? [];
      legs.forEach((leg, i) => {
        const at = asDate(String(leg.date ?? ''), String(leg.time ?? ''));
        if (!at) return;
        const where =
          slide.slideType === 'Walk-in'
            ? 'ถึงหน้าร้าน'
            : `ขาที่ ${i + 1} ${leg.from || '-'} → ${leg.to || '-'}`;
        appointments.push({
          t,
          appt: at,
          row: {
            ...base,
            serviceType: 'รถสไลด์',
            products: [where],
            dropOff: at,
            pickup: null,
          },
        });
      });
    }

    const baseAppt = appointmentDate(t);
    if (!baseAppt || !visitDays.has(shopDayKey(baseAppt))) {
      appointments.push({ t, appt: baseAppt, row: base });
    }
  }

  return appointments;
}
