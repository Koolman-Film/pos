import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ServiceVisitsSection } from '@/components/tickets/detail/ServiceVisitsSection';
import type { InsurancePolicy, ServiceVisit, Ticket } from '@/components/tickets/types';

/**
 * เคลมประกันในการเซอร์วิสครั้งนั้น (ร้านขอ 17 ก.ย. 2569).
 *
 * The claim used to be written separately under the policy. It is made at the
 * visit now — and only from cover this car actually has, while it runs.
 */

const t = {
  id: 'JT-CM-00212',
  shop: 'cm',
  plate: 'ไกข 4521',
  items: [],
  payments: [],
  extras: {},
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

function renderSection(policies: InsurancePolicy[]) {
  const onSave = vi.fn(async (v: ServiceVisit) => ({ ok: true, visit: v }));
  render(
    <ServiceVisitsSection
      t={t}
      visits={[]}
      visitsForPlate={0}
      entitled={3}
      technicians={['ช่างเอ']}
      setTechnicians={vi.fn()}
      currentUserName="แอดมินระบบ"
      filmProduct="TPU กันรอยเกรดพรีเมียม"
      assignedTechnicians={['ช่างเอ']}
      canDelete={false}
      onSave={onSave}
      onDelete={vi.fn(async () => ({ ok: true }))}
      onPrint={vi.fn()}
      policies={policies}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิสครั้งใหม่/ }));
}

const tick = () => screen.getByRole('checkbox', { name: 'ใช้ประกันเคลมในการเซอร์วิสครั้งนี้' });

describe('ServiceVisitsSection — เคลมประกัน', () => {
  it('cannot claim for a car with no cover, and says so', async () => {
    const { user } = renderSection([]);
    await openForm(user);
    expect(tick()).toBeDisabled();
    expect(screen.getByText('รถคันนี้ไม่มีประกัน — เคลมไม่ได้')).toBeInTheDocument();
  });

  it('cannot claim on cover that has run out', async () => {
    const { user } = renderSection([policy({ startsAt: '2020-01-01', endsAt: '2021-01-01' })]);
    await openForm(user);
    expect(tick()).toBeDisabled();
    expect(screen.getByText('เคลมไม่ได้: ประกันหมดอายุแล้ว')).toBeInTheDocument();
  });

  it('saves the claim with the visit', async () => {
    const { onSave, user } = renderSection([policy()]);
    await openForm(user);
    await user.click(tick());
    await user.clear(screen.getByLabelText('ชิ้นเล็กที่เคลม'));
    await user.type(screen.getByLabelText('ชิ้นเล็กที่เคลม'), '2');
    await user.type(screen.getByLabelText('รายการที่เคลม'), 'กันชนหน้า');
    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิส$/ }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        claim: { policyId: 7, bigUsed: 0, smallUsed: 2, detail: 'กันชนหน้า' },
      }),
    );
  });

  it('will not save more pieces than the policy has left', async () => {
    const used = policy({
      claims: [{ claimedAt: '2026-08-10', bigUsed: 2, smallUsed: 0, detail: '', technician: '' }],
    });
    const { onSave, user } = renderSection([used]);
    await openForm(user);
    await user.click(tick());
    await user.clear(screen.getByLabelText('ชิ้นใหญ่ที่เคลม'));
    await user.type(screen.getByLabelText('ชิ้นใหญ่ที่เคลม'), '1');
    expect(
      screen.getAllByText('เคลมเกินความคุ้มครองที่เหลือ (เหลือ 0 ชิ้นใหญ่, 20 ชิ้นเล็ก)').length,
    ).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิส$/ }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves the visit without a claim when the box is left unticked', async () => {
    const { onSave, user } = renderSection([policy()]);
    await openForm(user);
    await user.click(screen.getByRole('button', { name: /บันทึกการเซอร์วิส$/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ claim: null }));
  });
});
