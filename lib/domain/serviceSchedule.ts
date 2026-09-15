/**
 * นัดเข้า Service — the appointments a Service package is sold with.
 *
 * The shop's rule (ร้านขอ 15 ก.ย. 2569):
 *   - the first visit, วันที่เริ่มเข้า Service, is 14 days after the job is
 *     handed over;
 *   - every later visit is 6 months after the start, until the number of
 *     visits sold is used up;
 *   - a date that lands on a Sunday moves to the Monday — the shop is closed.
 *
 * Those dates are a DRAFT. A salesperson rings the customer before each visit
 * and writes down the day they actually agreed; that day is kept exactly as
 * written. A draft that nobody has confirmed moves by itself when the start
 * date or the number of visits changes, so the schedule is always rebuilt from
 * the rule and the confirmed dates rather than stored as a list that goes stale.
 *
 * Dates are `YYYY-MM-DD` strings on the calendar, never `Date`s on a clock: a
 * 6-month step taken through a timezone would move a day now and then.
 */

export const SERVICE_START_AFTER_DAYS = 14;
export const SERVICE_EVERY_MONTHS = 6;
/** No package is sold with more; a typo of 1000 must not draw a thousand rows. */
const MAX_VISITS = 60;

export type ServiceAppointment = {
  /** ครั้งที่ — 1..N, matching `service_visits.visit_no`. */
  no: number;
  /** `YYYY-MM-DD`; empty while there is no start date to work from. */
  date: string;
  /** false = ร่าง (the rule's date); true = the day the customer agreed. */
  confirmed: boolean;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const toKey = (d: Date) => d.toISOString().slice(0, 10);

function parse(day: string): Date | null {
  const m = DAY.exec(day ?? '');
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

export function addDays(day: string, days: number): string {
  const d = parse(day);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return toKey(d);
}

/** Months on the calendar; the 31st of a short month becomes its last day (31 ส.ค. + 6 เดือน = 28/29 ก.พ.). */
export function addMonths(day: string, months: number): string {
  const d = parse(day);
  if (!d) return '';
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toKey(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

/** อาทิตย์ → จันทร์. Any other day is returned as it is. */
export function skipSunday(day: string): string {
  const d = parse(day);
  if (!d) return '';
  return d.getUTCDay() === 0 ? addDays(day, 1) : day;
}

/** วันที่เริ่มเข้า Service ที่แนะนำ: 14 days after handover, never a Sunday. */
export function suggestedServiceStart(handedOver: string): string {
  return handedOver ? skipSunday(addDays(handedOver, SERVICE_START_AFTER_DAYS)) : '';
}

function readSaved(saved: unknown): ServiceAppointment[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      no: Number(s.no) || 0,
      date: typeof s.date === 'string' && DAY.test(s.date) ? s.date : '',
      confirmed: s.confirmed === true,
    }));
}

/**
 * The schedule, visit by visit.
 *
 * `count` is the number of visits sold. `saved` is what the ticket stored last
 * time (`extras.Service.schedule`); only its CONFIRMED dates are taken from it —
 * every draft is worked out again from `start`, so moving the start moves them.
 */
export function buildServiceSchedule(
  start: string,
  count: number | string | null | undefined,
  saved?: unknown,
): ServiceAppointment[] {
  const n = Math.min(Math.max(Math.floor(Number(count) || 0), 0), MAX_VISITS);
  const confirmed = new Map(
    readSaved(saved)
      .filter((s) => s.confirmed && s.date && s.no > 0)
      .map((s) => [s.no, s.date]),
  );
  const from = parse(start) ? start : '';

  return Array.from({ length: n }, (_, i) => {
    const no = i + 1;
    const agreed = confirmed.get(no);
    if (agreed) return { no, date: agreed, confirmed: true };
    return {
      no,
      date: from ? skipSunday(addMonths(from, SERVICE_EVERY_MONTHS * i)) : '',
      confirmed: false,
    };
  });
}

/** Set the day the customer agreed for one visit. */
export function confirmServiceDate(
  schedule: ServiceAppointment[],
  no: number,
  date: string,
): ServiceAppointment[] {
  return schedule.map((s) => (s.no === no ? { no, date, confirmed: !!date } : s));
}

/** Put one visit back to the rule's date. */
export function resetServiceDate(schedule: ServiceAppointment[], no: number): ServiceAppointment[] {
  return schedule.map((s) => (s.no === no ? { ...s, confirmed: false } : s));
}
