'use client';

import { ThaiDateInput } from '@/components/ui/ThaiDateInput';
import {
  buildServiceSchedule,
  confirmServiceDate,
  resetServiceDate,
  type ServiceAppointment,
} from '@/lib/domain/serviceSchedule';

/**
 * นัดเข้า Service แต่ละครั้ง — ร่างตามกฎ จนกว่าพนักงานโทรยืนยันกับลูกค้า.
 *
 * The dates come from lib/domain/serviceSchedule.ts: the start, then every six
 * months, a Sunday moved to the Monday. Each stays a ร่าง until the salesperson
 * has rung the customer; the day they agree is typed over the draft (or the
 * draft accepted as it is), and from then on it is kept exactly as written.
 *
 * `onChange` receives the whole schedule — it is stored on the ticket as
 * `extras.Service.schedule`, which is editable even on a closed ticket (0022).
 */
export function ServiceScheduleList({
  start,
  count,
  saved,
  recordedVisitNos,
  onChange,
}: {
  start: string;
  count: number | string | null | undefined;
  saved: unknown;
  /** `service_visits.visit_no` of the visits that actually happened. */
  recordedVisitNos: number[];
  onChange: (schedule: ServiceAppointment[]) => void;
}) {
  const schedule = buildServiceSchedule(start, count, saved);
  if (schedule.length === 0) return null;
  const done = new Set(recordedVisitNos);

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-soft)' }}>
        <i className="fa-regular fa-calendar-check mr-1"></i>
        นัดเข้า Service {schedule.length} ครั้ง · ทุก 6 เดือน
      </p>
      <p className="text-xs mb-2" style={{ color: 'var(--ink-faint)' }}>
        {start
          ? 'วันที่เป็นร่างจนกว่าจะโทรยืนยันกับลูกค้า — แก้เป็นวันที่ลูกค้ายืนยันได้เลย · วันอาทิตย์เลื่อนเป็นวันจันทร์'
          : 'ใส่วันที่เริ่มเข้า Service ก่อน ระบบจะร่างวันนัดแต่ละครั้งให้'}
      </p>
      <ul className="flex flex-col gap-1.5">
        {schedule.map((s) => {
          const visited = done.has(s.no);
          const badge = visited
            ? { text: 'เข้าแล้ว', bg: '#EAF3EC', color: '#2F6B3F' }
            : s.confirmed
              ? { text: 'ยืนยันแล้ว', bg: '#E8EEF9', color: '#2563EB' }
              : { text: 'ร่าง', bg: 'var(--paper)', color: 'var(--ink-soft)' };
          return (
            <li
              key={s.no}
              className="grid items-center gap-2"
              style={{ gridTemplateColumns: '4.5rem minmax(0, 1fr) auto' }}
            >
              <span className="text-xs font-semibold">ครั้งที่ {s.no}</span>
              <ThaiDateInput
                value={s.date}
                onChange={(v) => onChange(confirmServiceDate(schedule, s.no, v))}
                ariaLabel={`วันนัด Service ครั้งที่ ${s.no}`}
                className="field text-xs px-2.5 py-1.5 w-full"
              />
              <span className="flex items-center gap-1.5 justify-end flex-wrap">
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: badge.bg, color: badge.color }}
                >
                  {badge.text}
                </span>
                {!visited && !s.confirmed && s.date && (
                  <button
                    type="button"
                    onClick={() => onChange(confirmServiceDate(schedule, s.no, s.date))}
                    aria-label={`ลูกค้ายืนยันวันนัดครั้งที่ ${s.no}`}
                    className="btn-outline px-2 py-0.5 rounded-lg text-xs"
                  >
                    ลูกค้ายืนยันวันนี้
                  </button>
                )}
                {!visited && s.confirmed && (
                  <button
                    type="button"
                    onClick={() => onChange(resetServiceDate(schedule, s.no))}
                    aria-label={`กลับเป็นร่าง ครั้งที่ ${s.no}`}
                    className="btn-outline px-2 py-0.5 rounded-lg text-xs"
                  >
                    กลับเป็นร่าง
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
