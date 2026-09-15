import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ServiceVisitsSection } from '@/components/tickets/detail/ServiceVisitsSection';
import type { ServiceVisit, Ticket } from '@/components/tickets/types';

/**
 * บันทึกการเซอร์วิสอยู่ใต้วันนัดของครั้งนั้น.
 *
 * The record of each visit used to be a separate list below all twelve dates,
 * so filling in ครั้งที่ 2 meant scrolling from its date down to a different
 * box. Each visit now sits under its own appointment.
 */

const t = {
  id: 'JT-CM-00212',
  shop: 'cm',
  plate: 'ไกข 4521',
  items: [],
  payments: [],
  extras: {},
} as unknown as Ticket;

const visit = (over: Partial<ServiceVisit> = {}): ServiceVisit => ({
  id: 1,
  visitNo: 1,
  plate: 'ไกข 4521',
  receivedAt: '2026-09-16',
  receivedTime: '09:00',
  deliveredAt: '',
  deliveredTime: '',
  salesBy: 'พนักงานขาย',
  qcBy: '',
  technicians: ['ช่างเอ'],
  filmProduct: 'TPU กันรอยเกรดพรีเมียม',
  customerWaits: true,
  overallOk: true,
  checks: {},
  notes: '',
  points: [],
  ...over,
});

function renderSection(visits: ServiceVisit[]) {
  const onSave = vi.fn(async (v: ServiceVisit) => ({ ok: true, visit: v }));
  render(
    <ServiceVisitsSection
      t={t}
      visits={visits}
      visitsForPlate={visits.length}
      entitled={3}
      technicians={['ช่างเอ', 'ช่างบอย']}
      setTechnicians={vi.fn()}
      currentUserName="แอดมินระบบ"
      filmProduct="TPU กันรอยเกรดพรีเมียม"
      assignedTechnicians={['ช่างเอ']}
      canDelete={false}
      onSave={onSave}
      onDelete={vi.fn(async () => ({ ok: true }))}
      onPrint={vi.fn()}
      schedule={{ start: '2026-09-16', count: 3, saved: undefined, onChange: vi.fn() }}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

/** The <li> of one appointment in the schedule. */
const row = (no: number) => screen.getByLabelText(`วันนัด Service ครั้งที่ ${no}`).closest('li')!;

describe('ServiceVisitsSection — each visit under its date', () => {
  it('shows a recorded visit inside its own appointment', () => {
    renderSection([visit()]);
    expect(
      within(row(1)).getByRole('button', { name: 'แก้ไขการเซอร์วิสครั้งที่ 1' }),
    ).toBeInTheDocument();
    expect(
      within(row(2)).queryByRole('button', { name: 'แก้ไขการเซอร์วิสครั้งที่ 1' }),
    ).not.toBeInTheDocument();
  });

  it('offers to record the next visit under its date, and only that one', () => {
    renderSection([visit()]);
    expect(
      within(row(2)).getByRole('button', { name: /บันทึกการเซอร์วิสครั้งที่ 2/ }),
    ).toBeInTheDocument();
    expect(within(row(3)).queryByRole('button', { name: /บันทึกการเซอร์วิส/ })).toBeNull();
    // No second, detached way in while the schedule covers the visit.
    expect(screen.queryByRole('button', { name: /บันทึกการเซอร์วิสครั้งใหม่/ })).toBeNull();
    // The blank sheet is still there for working on paper.
    expect(screen.getByRole('button', { name: /พิมพ์ใบเซอร์วิสเปล่า/ })).toBeInTheDocument();
  });

  it('opens the form under that date and saves it as that visit', async () => {
    const { onSave, user } = renderSection([visit()]);
    await user.click(within(row(2)).getByRole('button', { name: /บันทึกการเซอร์วิสครั้งที่ 2/ }));
    expect(within(row(2)).getByText('การเซอร์วิสครั้งที่ 2')).toBeInTheDocument();
    await user.click(within(row(2)).getByRole('button', { name: /บันทึกการเซอร์วิส$/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ visitNo: 2 }));
  });

  it('edits a recorded visit in place', async () => {
    const { user } = renderSection([visit()]);
    await user.click(within(row(1)).getByRole('button', { name: 'แก้ไขการเซอร์วิสครั้งที่ 1' }));
    expect(within(row(1)).getByText('แก้ไขการเซอร์วิสครั้งที่ 1')).toBeInTheDocument();
  });
});
