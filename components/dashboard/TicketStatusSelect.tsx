'use client';

import { useTransition } from 'react';

import { getStatus, type StatusConfig } from '@/components/ui/Badge';

/**
 * The inline status dropdown on the dashboard's "งานล่าสุด" rows, ported from
 * reference/v0.4/finnix-film.html:944-949.
 *
 * This is the only interactive leaf in the recent-jobs list, so it is the only
 * part that crosses into the client. The prototype called `updateTicketStatus`
 * on an in-memory array; here `onChange` is the `updateTicketStatus` Server
 * Action, which re-checks the caller's capability server-side per correction C2
 * — this control being visible is not authorization.
 *
 * `stopPropagation` on click is kept from the prototype: the row around it is a
 * link to the ticket, and changing status must not also navigate.
 */
export function TicketStatusSelect({
  ticketId,
  status,
  statuses,
  onChange,
}: {
  ticketId: string;
  status: string;
  statuses: StatusConfig[];
  onChange?: (ticketId: string, newStatus: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const conf = getStatus(statuses, status);

  return (
    <select
      value={status}
      aria-label={`สถานะของ ${ticketId}`}
      disabled={pending || !onChange}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        const next = e.target.value;
        if (!onChange || next === status) return;
        startTransition(async () => {
          await onChange(ticketId, next);
        });
      }}
      className="text-xs font-semibold px-2.5 py-1 rounded-full border-none cursor-pointer"
      style={{ background: conf.bg, color: conf.text, opacity: pending ? 0.6 : 1 }}
    >
      {statuses.map((s) => (
        <option key={s.key} value={s.key}>
          {s.short}
        </option>
      ))}
    </select>
  );
}
