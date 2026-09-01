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

/** A visit as stored: two date-only strings, either of which may be empty. */
export type VisitDates = { from: string; to: string };

/** Date-only, read on the shop's clock — the server runs UTC. */
const asDate = (v: string) => (v ? new Date(`${v}T00:00:00+07:00`) : null);

export function buildAppointments<T extends AppointmentTicket>(
  tickets: T[],
  visitsByTicket: Map<string, VisitDates[]>,
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
      const from = asDate(String(rework.receivedAt ?? ''));
      const to = asDate(String(rework.deliveredAt ?? ''));
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

    for (const v of visitsByTicket.get(t.id) ?? []) {
      const from = asDate(v.from);
      const to = asDate(v.to);
      if (!from && !to) continue;
      visits.push({
        t,
        appt: appointmentDate({ status: t.status, dropOff: from, pickup: to }),
        row: {
          ...base,
          serviceType: 'Service',
          dropOff: (from ?? to) as Date,
          pickup: to,
        },
      });
    }

    const visitDays = new Set<string>();
    for (const v of visits) {
      if (v.appt) visitDays.add(shopDayKey(v.appt));
      appointments.push(v);
    }

    const baseAppt = appointmentDate(t);
    if (!baseAppt || !visitDays.has(shopDayKey(baseAppt))) {
      appointments.push({ t, appt: baseAppt, row: base });
    }
  }

  return appointments;
}
