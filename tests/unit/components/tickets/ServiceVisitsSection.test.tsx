import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ServiceVisitsSection } from '@/components/tickets/detail/ServiceVisitsSection';
import type { ServiceVisit, Ticket } from '@/components/tickets/types';

/**
 * The ticket has always recorded how many service visits were SOLD. What the
 * shop could not answer was "รถคันนี้เซอร์วิสไปกี่ครั้งแล้ว วันไหน ทำอะไรบ้าง" —
 * this section is that record, so what it counts and what it sends to the server
 * are the parts worth pinning.
 */

const ticket = (over: Partial<Ticket> = {}) =>
  ({
    id: 'JT-CM-00216',
    shop: 'cm',
    plate: 'กก 999',
    items: [],
    payments: [],
    extras: {},
    serviceVisits: [],
    serviceVisitsForPlate: 0,
    ...over,
  }) as unknown as Ticket;

const visit = (over: Partial<ServiceVisit> = {}): ServiceVisit => ({
  id: 1,
  visitNo: 1,
  plate: 'กก 999',
  receivedAt: '2026-08-20',
  receivedTime: '09:00',
  deliveredAt: '',
  deliveredTime: '',
  salesBy: 'พนักงานขาย',
  qcBy: '',
  technicians: ['ช่างเอก'],
  filmType: 'TPU',
  filmThickness: '195',
  filmColourCode: '',
  customerWaits: true,
  overallOk: true,
  checks: {},
  notes: '',
  points: [{ seq: 1, position: 'กันชนหน้า', detail: 'ฟิล์มเผยอ', note: '' }],
  ...over,
});

function renderSection(t: Ticket, over: Record<string, unknown> = {}) {
  const onSave = vi.fn(async (visit: ServiceVisit) => ({ ok: true, visit }));
  const onPrint = vi.fn();
  render(
    <ServiceVisitsSection
      t={t}
      visits={t.serviceVisits ?? []}
      visitsForPlate={t.serviceVisitsForPlate ?? 0}
      entitled={10}
      technicians={['ช่างเอก', 'ช่างบอย']}
      setTechnicians={vi.fn()}
      currentUserName="แอดมินระบบ"
      film={{ type: 'TPU', thickness: '195', colourCode: 'BK-01' }}
      canDelete={false}
      onSave={onSave}
      onDelete={vi.fn(async () => ({ ok: true }))}
      onPrint={onPrint}
      {...over}
    />,
  );
  return { onSave, onPrint };
}

describe('ServiceVisitsSection', () => {
  it('counts visits used against the entitlement sold on the ticket', () => {
    renderSection(ticket({ serviceVisits: [visit({ visitNo: 2 }), visit({ id: 2, visitNo: 1 })] }));
    expect(screen.getByText(/ใช้ไป 2 \/ 10 ครั้ง/)).toBeInTheDocument();
  });

  it('warns once the entitlement is used up', () => {
    const visits = Array.from({ length: 3 }, (_, i) => visit({ id: i + 1, visitNo: i + 1 }));
    renderSection(ticket({ serviceVisits: visits }), { entitled: 3 });
    expect(screen.getByText('ครบสิทธิ์แล้ว')).toBeInTheDocument();
  });

  it("reports the car's total across tickets, not just this one's", () => {
    renderSection(ticket({ serviceVisits: [visit()], serviceVisitsForPlate: 4 }));
    // The entitlement is per ticket; "how many times has this car been in" is not.
    expect(screen.getByText(/เคยเซอร์วิสรวม 4 ครั้ง/)).toBeInTheDocument();
  });

  it('stays quiet about the plate total when it matches this ticket', () => {
    renderSection(ticket({ serviceVisits: [visit()], serviceVisitsForPlate: 1 }));
    expect(screen.queryByText(/เคยเซอร์วิสรวม/)).not.toBeInTheDocument();
  });

  it('summarises each visit by date, technicians and points fixed', () => {
    renderSection(ticket({ serviceVisits: [visit()] }));
    expect(screen.getByText(/ครั้งที่ 1/)).toBeInTheDocument();
    expect(screen.getByText(/ช่างเอก · 1 จุดแก้ไข · รอบคันปกติ/)).toBeInTheDocument();
  });

  it('prints a blank sheet and a recorded one through the same handler', async () => {
    const user = userEvent.setup();
    const { onPrint } = renderSection(ticket({ serviceVisits: [visit()] }));

    await user.click(screen.getByLabelText('พิมพ์ใบเซอร์วิสครั้งที่ 1'));
    expect(onPrint).toHaveBeenLastCalledWith(expect.objectContaining({ visitNo: 1 }));

    // null is the blank sheet — the "print it, fill it in at the car" workflow.
    await user.click(screen.getByRole('button', { name: /พิมพ์ใบเซอร์วิสเปล่า/ }));
    expect(onPrint).toHaveBeenLastCalledWith(null);
  });

  it('numbers a new visit after the ones already recorded', async () => {
    const user = userEvent.setup();
    renderSection(ticket({ serviceVisits: [visit({ visitNo: 2 }), visit({ id: 2, visitNo: 1 })] }));
    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิสครั้งใหม่/ }));
    expect(screen.getByText('การเซอร์วิสครั้งที่ 3')).toBeInTheDocument();
  });

  it('sends only the จุดพิเศษ rows that were filled in', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSection(ticket());

    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิสครั้งใหม่/ }));
    await user.type(screen.getByLabelText('จุดที่ 1 ตำแหน่ง'), 'กันชนหน้า');
    await user.type(screen.getByLabelText('จุดที่ 1 รายละเอียด'), 'ฟิล์มเผยอ');
    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิส$/ }));

    const sent = onSave.mock.calls[0][0];
    // Nine of the ten rows were left blank and must not be stored.
    expect(sent.points).toEqual([{ seq: 1, position: 'กันชนหน้า', detail: 'ฟิล์มเผยอ', note: '' }]);
  });

  it('takes each check as free text, and leaves untouched parts blank', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSection(ticket());

    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิสครั้งใหม่/ }));
    // Whatever the technician writes — a state, a measurement, a note. Three
    // fixed buttons could not carry that.
    await user.type(screen.getByLabelText('หน้าจอ 1'), 'ปกติ');
    await user.type(screen.getByLabelText('Sunroof'), 'รอยขีด 2 ซม.');
    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิส$/ }));

    const sent = onSave.mock.calls[0][0];
    expect(sent.checks['หน้าจอ 1']).toBe('ปกติ');
    expect(sent.checks['Sunroof']).toBe('รอยขีด 2 ซม.');
    // A part nobody wrote against carries nothing, so it prints empty.
    expect(sent.checks['Piano Black']).toBeUndefined();
  });

  it('takes ประเภทฟิล์ม / ความหนา / รหัสสี from the ticket instead of asking', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSection(ticket());

    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิสครั้งใหม่/ }));
    // Shown, not editable — the ticket is the source.
    expect(screen.getByText(/TPU · 195 · BK-01/)).toBeInTheDocument();
    expect(screen.queryByLabelText('ความหนาฟิล์ม')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิส$/ }));
    // Still stored on the visit, so reprinting an old sheet shows what was true
    // that day even after the ticket is edited.
    const sent = onSave.mock.calls[0][0];
    expect(sent.filmType).toBe('TPU');
    expect(sent.filmThickness).toBe('195');
    expect(sent.filmColourCode).toBe('BK-01');
  });
});
