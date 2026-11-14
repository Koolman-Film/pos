import { shopDayKey } from '@/lib/domain/format';
import { buildServiceSchedule } from '@/lib/domain/serviceSchedule';

import { appointmentDate, isCancelled, type UpcomingTicket } from './Dashboard';
import type { CalendarTicket } from './JobCalendar';

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
  /** จองผ่าน — เดินทางไปถึงการ์ดนัดหมายพร้อมกับแถว */
  bookingChannel?: string;
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
  /**
   * ครั้งที่ — `service_visits.visit_no` (เคลมประกัน ไม่มี).
   *
   * ใช้ตัดนัดที่ผ่านไปแล้วออกจากตารางนัด การนับจำนวนแถวแทนเลขครั้ง พังทันทีที่
   * เลขครั้งไม่เรียงติดกัน — ร้านบันทึกครั้งที่ 1 กับ 3 ไว้ จำนวนแถวได้ 2 ระบบ
   * จึงยังวาดนัดครั้งที่ 3 ที่เข้ามาแล้วค้างไว้บนการ์ด
   */
  no?: number;
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
      bookingChannel: t.bookingChannel,
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

    /*
      นัดเข้า Service ที่ยังมาไม่ถึง — the schedule the package was sold with
      (lib/domain/serviceSchedule.ts). A draft is on the card so the
      salesperson sees whom to ring; it says ร่าง until they have. Visits
      already recorded are counted off the front, so ครั้งที่ 1 does not
      appear again once the car has been in for it.
    */
    const service = t.extras['Service'];
    if (service?.checked) {
      const recorded = visitsByTicket.get(t.id) ?? [];
      /*
        เข้ามาแล้วครั้งไหนบ้าง — อ่านจากเลขครั้ง ไม่ใช่จำนวนแถว.

        ของเดิมนับจำนวนแถวแล้วตัดนัดที่เลขน้อยกว่าหรือเท่ากันออก ซึ่งถูกเฉพาะ
        ตอนที่เลขครั้งเรียง 1, 2, 3 ติดกันพอดี ร้านที่บันทึกครั้งที่ 1 กับ 3 ไว้
        (ครั้งที่ 2 ลูกค้าไม่ได้มา) ได้จำนวนแถว 2 ระบบจึงยังวาดนัดครั้งที่ 3 ที่
        เข้ามาแล้ว ค้างอยู่บนการ์ดตลอดไป

        แถวเก่าที่ไม่มีเลขครั้งมาด้วย ถอยไปใช้กฎเดิม เพื่อไม่ให้ผู้เรียกที่ยัง
        ไม่ได้ส่งเลขมา เห็นนัดที่ผ่านไปแล้วโผล่กลับมาทั้งชุด
      */
      const visitNos = new Set(recorded.map((v) => v.no).filter((n): n is number => !!n));
      const done = visitNos.size === recorded.length ? 0 : recorded.length;
      /*
        วันที่มีคนเข้ามาจริงแล้ว ไม่ต้องมีนัดของวันนั้นซ้ำอีก (ร้านเจอ 7 พ.ย. 2569).

        นัดคือแผน ส่วนการเข้ารับบริการคือสิ่งที่เกิดขึ้นจริง — รถคันเดียวเข้ามา
        วันเดียว การแสดงทั้งสองอันทำให้การ์ดอ่านได้ว่ามีรถสองคัน ต่างกันแค่อัน
        หนึ่งมีเวลากำกับ อันหนึ่งไม่มี หลักเดียวกับที่แถวการจองถูกตัดเมื่อมี
        การเข้ารับบริการวันเดียวกันอยู่แล้ว
      */
      const recordedDays = new Set(
        recorded
          .map((v) => asDate(v.from, v.fromTime) ?? asDate(v.to, v.toTime))
          .filter((d): d is Date => !!d)
          .map(shopDayKey),
      );
      const saved = Array.isArray(service.schedule) ? service.schedule : [];
      const count = Number(service.serviceCount) || saved.length;
      for (const s of buildServiceSchedule(String(service.serviceDate ?? ''), count, saved)) {
        const at = asDate(s.date);
        if (!at) continue;
        if (visitNos.has(s.no) || s.no <= done) continue;
        if (recordedDays.has(shopDayKey(at))) continue;
        visits.push({
          t,
          appt: at,
          row: {
            ...base,
            serviceType: 'Service',
            products: [`นัด Service ครั้งที่ ${s.no}${s.confirmed ? '' : ' (ร่าง — รอโทรยืนยัน)'}`],
            dropOff: at,
            pickup: null,
          },
        });
      }
    }
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

/**
 * คิวงานเจ็ดวันข้างหน้า — เรียงตามเวลานัด.
 *
 * ช่วงเวลาถูกวัดบนนาฬิกาของร้าน ไม่ใช่ของเซิร์ฟเวอร์ ตัวที่ส่งเข้ามาจึงเป็น
 * ขอบเขตที่คำนวณไว้แล้ว ไม่ใช่ "วันนี้"
 *
 * งานที่ยกเลิกไม่อยู่ในคิว (ร้านแจ้ง 14 พ.ย. 2569) — การ์ดนี้ตอบว่าวันไหนต้อง
 * มีคนเตรียมพร้อม งานที่ยกเลิกไปแล้วไม่ใช่คำตอบของคำถามนั้น มันนั่งอยู่บน
 * การ์ดเหมือนงานที่ยังมาอยู่ แล้วคนก็กันคิวให้รถที่ไม่มาจริง
 */
export function upcomingRows<T extends AppointmentTicket>(
  appointments: Appointment<T>[],
  windowStart: Date,
  windowEnd: Date,
): UpcomingTicket[] {
  return appointments
    .filter(({ t, appt }) => !isCancelled(t) && appt && appt >= windowStart && appt <= windowEnd)
    .sort((x, y) => (x.appt as Date).getTime() - (y.appt as Date).getTime())
    .map(({ row }) => row);
}

/**
 * สิ่งที่ปฏิทินต้องวาด — ใบงานทุกใบที่มีวันรับ บวกการมาแต่ละครั้งของรถ.
 *
 * งานแก้/เซอร์วิส/เคลม/รถสไลด์ ไม่ใช่สถานะ ใบงานยังถืออะไรอยู่ก็ถืออันนั้น
 * ต่อไป แต่ปฏิทินตอบว่า "วันนั้นมีอะไรเกิดขึ้น" และรถที่กลับมาก็คือหนึ่งใน
 * สิ่งที่เกิดขึ้น สร้างจากรายการเดียวกับการ์ดเจ็ดวัน สองที่นี้จึงขัดกันไม่ได้
 *
 * `isVisitKind` ถูกส่งเข้ามา แทนที่จะรู้จักรายชื่อเอง เพราะสีกับชื่อของการมา
 * แต่ละแบบเป็นเรื่องของหน้าที่วาด ไม่ใช่ของกฎข้อนี้
 */
export function calendarEntries<T extends AppointmentTicket & { shop: string }>(
  tickets: (T & { dropOff: Date | null; statusHistory: { status: string; changedAt: Date }[] })[],
  appointments: Appointment<T>[],
  isVisitKind: (serviceType: string) => boolean,
): CalendarTicket[] {
  // ปฏิทินตอบคำถามเดียวกับคิวงาน จึงกรองด้วยกฎเดียวกัน
  const entries: CalendarTicket[] = tickets
    .filter((t) => t.dropOff && !isCancelled(t))
    .map((t) => ({
      id: t.id,
      shop: t.shop,
      status: t.status,
      dropOff: t.dropOff as Date,
      statusHistory: t.statusHistory,
    }));

  for (const ap of appointments) {
    if (!isVisitKind(ap.row.serviceType)) continue;
    if (!ap.appt) continue;
    // ใบงานถูกยกเลิก เซอร์วิสกับงานแก้ที่นัดไว้บนใบนั้นก็ไม่เกิดเหมือนกัน
    if (isCancelled(ap.t)) continue;
    entries.push({
      id: ap.t.id,
      shop: ap.t.shop,
      status: ap.row.serviceType,
      // ว่างโดยตั้งใจ: ปฏิทินอ่านการเปลี่ยนสถานะครั้งล่าสุดเมื่อมีประวัติ
      // ส่วนแถวนี้พูดถึงวันของตัวมันเอง ไม่ใช่ของใบงาน
      statusHistory: [],
      dropOff: ap.appt,
    });
  }

  return entries;
}
