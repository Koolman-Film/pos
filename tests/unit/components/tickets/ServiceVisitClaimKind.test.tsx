import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ServiceVisitsSection } from '@/components/tickets/detail/ServiceVisitsSection';
import {
  CLAIM_VISIT,
  SERVICE_VISIT,
  type InsurancePolicy,
  type ServiceVisit,
  type Ticket,
} from '@/components/tickets/types';

/**
 * งานเคลมประกันไม่กินสิทธิ์เซอร์วิส (ร้านขอ 24 ก.ย. 2569, migration 0067).
 *
 * A claim is not always part of a service. A car that comes in only to have a
 * claimed piece replaced used to spend one of the visits the customer PAID for,
 * and a car with cover but no Service package had nowhere to record a claim at
 * all. So a visit now has a kind, and the two are counted separately.
 */

const t = {
  id: 'JT-CM-00212',
  shop: 'cm',
  plate: 'ไกข 4521',
  items: [],
  payments: [],
  extras: {},
  techByCategory: {},
} as unknown as Ticket;

const policy = (over: Partial<InsurancePolicy> = {}): InsurancePolicy => ({
  id: 7,
  ticketId: 'JT-CM-00212',
  plate: 'ไกข 4521',
  planName: 'ประกันฟิล์มกันรอย 1 ปี',
  price: 2500,
  bigPieces: 2,
  smallPieces: 20,
  terms: '',
  soldAt: '2026-08-01',
  startsAt: '2026-08-01',
  endsAt: '2099-08-01',
  notes: '',
  claims: [],
  ...over,
});

const visit = (over: Partial<ServiceVisit> = {}): ServiceVisit => ({
  id: 1,
  kind: SERVICE_VISIT,
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

function renderSection(
  opts: {
    visits?: ServiceVisit[];
    entitled?: number;
    policies?: InsurancePolicy[];
    claimOnly?: boolean;
    schedule?: boolean;
  } = {},
) {
  const onSave = vi.fn(async (v: ServiceVisit) => ({ ok: true, visit: v }));
  render(
    <ServiceVisitsSection
      t={t}
      visits={opts.visits ?? []}
      visitsForPlate={0}
      entitled={opts.entitled ?? 3}
      technicians={['ช่างเอ']}
      setTechnicians={vi.fn()}
      currentUserName="แอดมินระบบ"
      filmProduct="TPU กันรอยเกรดพรีเมียม"
      assignedTechnicians={['ช่างเอ']}
      canDelete={false}
      onSave={onSave}
      onDelete={vi.fn(async () => ({ ok: true }))}
      onPrint={vi.fn()}
      policies={opts.policies ?? [policy()]}
      claimOnly={opts.claimOnly}
      schedule={
        opts.schedule
          ? { start: '2026-09-16', count: 3, saved: undefined, onChange: vi.fn() }
          : undefined
      }
    />,
  );
  return { onSave, user: userEvent.setup() };
}

describe('ServiceVisitsSection — งานเคลมประกันแยกจากเซอร์วิส', () => {
  it('ไม่นับงานเคลมเป็นสิทธิ์เซอร์วิสที่ใช้ไป', () => {
    renderSection({
      visits: [
        visit({ id: 1, visitNo: 1 }),
        visit({ id: 2, kind: CLAIM_VISIT, visitNo: 1, receivedAt: '2026-10-02' }),
      ],
    });
    // Two rows on file, but only one of them was the customer's to spend.
    expect(screen.getByText('ใช้ไป 1 / 3 ครั้ง')).toBeInTheDocument();
    expect(screen.getByText('ไม่นับสิทธิ์เซอร์วิส')).toBeInTheDocument();
  });

  it('เสนอปุ่มบันทึกงานเคลม แม้สิทธิ์เซอร์วิสจะครบแล้ว', async () => {
    // The cover is the policy's, not the package's — running out of free
    // services does not end the warranty.
    renderSection({ entitled: 1, visits: [visit()] });
    expect(screen.getByText('ครบสิทธิ์แล้ว')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /บันทึกงานเคลมประกัน/ })).toBeInTheDocument();
  });

  it('ไม่เสนอปุ่มเคลม เมื่อรถคันนี้ไม่มีประกัน', () => {
    renderSection({ policies: [] });
    expect(screen.queryByRole('button', { name: /บันทึกงานเคลมประกัน/ })).toBeNull();
  });

  it('บันทึกงานเคลมด้วยชนิดของตัวเอง และนับเลขครั้งที่แยกจากเซอร์วิส', async () => {
    const { onSave, user } = renderSection({
      visits: [
        visit({ id: 1, visitNo: 1 }),
        visit({ id: 2, visitNo: 2 }),
        visit({ id: 3, kind: CLAIM_VISIT, visitNo: 1 }),
      ],
    });
    await user.click(screen.getByRole('button', { name: /บันทึกงานเคลมประกัน/ }));

    // Second claim on a ticket that has had two services: งานเคลมครั้งที่ 2,
    // with the cover already chosen — the claim IS the visit here.
    expect(screen.getByText(/งานเคลมประกันครั้งที่ 2/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'ประกันที่ใช้เคลม' })).toBeChecked();
    await user.type(screen.getByLabelText('ชิ้นเล็กที่เคลม'), '1');
    await user.click(screen.getByRole('button', { name: /บันทึกงานเคลม$/ }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: CLAIM_VISIT, visitNo: 2 }));
  });

  it('ปฏิเสธงานเคลมที่ไม่ได้ระบุประกัน — ไม่งั้นเป็นบันทึกที่ไม่ได้บอกอะไร', async () => {
    const { onSave, user } = renderSection();
    await user.click(screen.getByRole('button', { name: /บันทึกงานเคลมประกัน/ }));
    // Untick the cover the form chose: the record would then say nothing
    // happened, and it is not a service either.
    await user.click(screen.getByRole('checkbox', { name: 'ประกันที่ใช้เคลม' }));
    await user.click(screen.getByRole('button', { name: /บันทึกงานเคลม$/ }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('งานเคลมประกันต้องระบุประกันที่ใช้เคลม');
  });

  it('ไม่วางงานเคลมไว้ใต้วันนัดเซอร์วิส — คนละเรื่องกัน', () => {
    renderSection({
      schedule: true,
      visits: [visit({ id: 2, kind: CLAIM_VISIT, visitNo: 1, receivedAt: '2026-10-02' })],
    });
    // ครั้งที่ 1 of the schedule is still open: the claim did not fill it.
    const row = screen.getByLabelText('วันนัด Service ครั้งที่ 1').closest('li')!;
    expect(within(row).getByRole('button', { name: /บันทึกการเซอร์วิสครั้งที่ 1/ })).toBeTruthy();
    // And the claim is listed on its own, below.
    expect(screen.getByText(/งานเคลมครั้งที่/)).toBeInTheDocument();
  });
});

describe('ServiceVisitsSection — โหมดเคลมอย่างเดียว (ใต้บล็อกประกัน)', () => {
  it('แสดงเฉพาะงานเคลม และไม่เปิดทางให้กินสิทธิ์เซอร์วิส', () => {
    renderSection({
      claimOnly: true,
      schedule: true,
      visits: [
        visit({ id: 1, visitNo: 1 }),
        visit({ id: 2, kind: CLAIM_VISIT, visitNo: 1, receivedAt: '2026-10-02' }),
      ],
    });
    expect(screen.getByText('งานเคลมประกัน')).toBeInTheDocument();
    expect(screen.getByText('บันทึกแล้ว 1 ครั้ง')).toBeInTheDocument();
    expect(screen.getByText(/งานเคลมครั้งที่/)).toBeInTheDocument();
    // No schedule, and no way to start a visit that would spend the package.
    expect(screen.queryByLabelText('วันนัด Service ครั้งที่ 1')).toBeNull();
    expect(screen.queryByRole('button', { name: /บันทึกการเซอร์วิสครั้งใหม่/ })).toBeNull();
    expect(screen.getByRole('button', { name: /บันทึกงานเคลมประกัน/ })).toBeInTheDocument();
  });

  it('บอกทางเมื่อยังไม่เคยเคลม', () => {
    renderSection({ claimOnly: true });
    expect(screen.getByText(/ยังไม่มีการเคลม/)).toBeInTheDocument();
  });
});
