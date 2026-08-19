import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  InsuranceSection,
  coverageText,
  daysLeft,
  remainingCover,
} from '@/components/tickets/detail/InsuranceSection';
import type { InsurancePlan, InsurancePolicy, Ticket } from '@/components/tickets/types';

/**
 * ประกัน was a ticket line at ราคา 0 that someone typed a price into, which tied
 * the money to the ticket's date. The shop sells it two ways — with the install,
 * or months later on a closed ticket — so what these pin down is that a policy
 * carries its own sale date, its own copy of the plan, and a cover that can be
 * counted down.
 */

const ticket = (over: Partial<Ticket> = {}) =>
  ({
    id: 'JT-CM-00216',
    shop: 'cm',
    plate: 'กก 999',
    items: [],
    payments: [],
    extras: {},
    ...over,
  }) as unknown as Ticket;

const plan: InsurancePlan = {
  id: 1,
  shop: null,
  name: 'ประกันฟิล์มกันรอย 1 ปี',
  price: 3000,
  bigPieces: 2,
  smallPieces: 20,
  months: 12,
  terms: 'ไม่คุ้มครองอุบัติเหตุ',
  active: true,
};

const policy = (over: Partial<InsurancePolicy> = {}): InsurancePolicy => ({
  id: 7,
  ticketId: 'JT-CM-00216',
  plate: 'กก 999',
  planName: 'ประกันฟิล์มกันรอย 1 ปี',
  price: 3000,
  bigPieces: 2,
  smallPieces: 20,
  terms: '',
  soldAt: '2026-08-01',
  startsAt: '2026-08-01',
  endsAt: '2027-08-01',
  notes: '',
  claims: [],
  ...over,
});

function renderSection(over: Record<string, unknown> = {}) {
  // Typed through its argument so `mock.calls[0][0]` is the policy, not `never`.
  const onSave = vi.fn(async (p: InsurancePolicy) => ({ ok: true, id: p.id }));
  const onPrint = vi.fn();
  const onPrintClaim = vi.fn();
  render(
    <InsuranceSection
      t={ticket()}
      policies={[]}
      forPlate={[]}
      plans={[plan]}
      technicians={['ช่างเอก']}
      canDelete={false}
      onSave={onSave}
      onDelete={vi.fn(async () => ({ ok: true }))}
      onPrint={onPrint}
      onPrintClaim={onPrintClaim}
      {...over}
    />,
  );
  return { onSave, onPrint, onPrintClaim };
}

describe('InsuranceSection — helpers', () => {
  it('builds the coverage sentence from the two counts', () => {
    expect(coverageText(2, 20)).toBe('ครอบคลุม 2 ชิ้นใหญ่, 20 ชิ้นเล็ก');
    // A plan that only covers one kind should not print a dangling comma.
    expect(coverageText(0, 5)).toBe('ครอบคลุม 5 ชิ้นเล็ก');
    expect(coverageText(0, 0)).toBe('ยังไม่ได้ระบุความคุ้มครอง');
  });

  it('counts the cover down as claims are written against it', () => {
    const p = policy({
      claims: [
        { claimedAt: '2026-09-01', bigUsed: 1, smallUsed: 3, detail: 'กันชนหน้า', technician: '' },
        { claimedAt: '2026-10-01', bigUsed: 0, smallUsed: 2, detail: 'มือจับ', technician: '' },
      ],
    });
    expect(remainingCover(p)).toEqual({ big: 1, small: 15 });
  });

  it('reads the expiry date as local midnight, not UTC', () => {
    // `new Date('2026-08-20')` is UTC; in Asia/Bangkok that is 07:00 the same
    // day, which put the count out by one either side of midnight.
    const today = new Date(2026, 7, 18);
    expect(daysLeft('2026-08-20', today)).toBe(2);
    expect(daysLeft('2026-08-18', today)).toBe(0);
    expect(daysLeft('2026-08-17', today)).toBe(-1);
    expect(daysLeft('', today)).toBeNull();
  });
});

describe('InsuranceSection', () => {
  it('sells a policy on its own date, not the ticket’s', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSection();

    await user.click(screen.getByRole('button', { name: /บันทึกประกันฉบับใหม่/ }));
    // The plan fills the form in; nothing is typed twice.
    expect(screen.getByLabelText('ราคาประกัน')).toHaveValue(3000);
    expect(screen.getByLabelText('ความคุ้มครองชิ้นใหญ่')).toHaveValue(2);

    await user.click(screen.getByRole('button', { name: /^บันทึกประกัน$/ }));
    const sent = onSave.mock.calls[0][0];
    // Today, because that is when the money came in — on an old ticket the two
    // are months apart, and the ticket's own total never moves.
    expect(sent.soldAt).toBe(new Date().toISOString().slice(0, 10));
    expect(sent.planName).toBe('ประกันฟิล์มกันรอย 1 ปี');
  });

  it('copies the plan rather than pointing at it', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSection();

    await user.click(screen.getByRole('button', { name: /บันทึกประกันฉบับใหม่/ }));
    await user.clear(screen.getByLabelText('ราคาประกัน'));
    await user.type(screen.getByLabelText('ราคาประกัน'), '2500');
    await user.click(screen.getByRole('button', { name: /^บันทึกประกัน$/ }));

    // A discount on this sale, and the plan is untouched for the next one.
    expect(onSave.mock.calls[0][0].price).toBe(2500);
    expect(plan.price).toBe(3000);
  });

  it('shows what a policy has left after its claims', () => {
    renderSection({
      policies: [
        policy({
          claims: [
            {
              claimedAt: '2026-09-01',
              bigUsed: 1,
              smallUsed: 5,
              detail: 'ฝากระโปรง',
              technician: '',
            },
          ],
        }),
      ],
    });
    expect(screen.getByText(/เหลือ 1 ชิ้นใหญ่, 15 ชิ้นเล็ก/)).toBeInTheDocument();
    expect(screen.getByText(/เคลมแล้ว 1 ครั้ง/)).toBeInTheDocument();
  });

  it('warns when the cover is nearly up, and says so once it is gone', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const { unmount } = render(
      <InsuranceSection
        t={ticket()}
        policies={[policy({ endsAt: iso(soon) })]}
        forPlate={[]}
        plans={[plan]}
        technicians={[]}
        canDelete={false}
        onSave={vi.fn(async () => ({ ok: true }))}
        onDelete={vi.fn(async () => ({ ok: true }))}
        onPrint={vi.fn()}
        onPrintClaim={vi.fn()}
      />,
    );
    expect(screen.getByText(/เหลืออีก 10 วัน/)).toBeInTheDocument();
    unmount();

    const past = new Date();
    past.setDate(past.getDate() - 3);
    renderSection({ policies: [policy({ endsAt: iso(past) })] });
    expect(screen.getByText('หมดอายุแล้ว')).toBeInTheDocument();
  });

  it('records a claim against the policy it belongs to', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSection({ policies: [policy()] });

    await user.click(screen.getByLabelText('แก้ไขประกัน ประกันฟิล์มกันรอย 1 ปี'));
    await user.click(screen.getByRole('button', { name: /เพิ่มการเคลม/ }));
    await user.clear(screen.getByLabelText('ชิ้นใหญ่ที่ใช้ครั้งที่ 1'));
    await user.type(screen.getByLabelText('ชิ้นใหญ่ที่ใช้ครั้งที่ 1'), '1');
    await user.type(screen.getByLabelText('รายละเอียดการเคลมครั้งที่ 1'), 'กันชนหน้า');

    // The remaining count follows what is being typed, before it is even saved.
    expect(screen.getByText(/เหลือ 1 ชิ้นใหญ่, 20 ชิ้นเล็ก/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^บันทึกประกัน$/ }));
    expect(onSave.mock.calls[0][0].claims).toEqual([
      expect.objectContaining({ bigUsed: 1, detail: 'กันชนหน้า' }),
    ]);
  });

  it('prints the receipt and the claim sheet through separate buttons', async () => {
    const user = userEvent.setup();
    const p = policy();
    const { onPrint, onPrintClaim } = renderSection({ policies: [p] });

    await user.click(screen.getByLabelText('พิมพ์ใบเสร็จประกัน ประกันฟิล์มกันรอย 1 ปี'));
    expect(onPrint).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));

    // The ใบเคลม button on the policy row is the BLANK sheet — the one the
    // technician carries to the car before anything is recorded.
    await user.click(screen.getByLabelText('พิมพ์ใบเคลมประกัน ประกันฟิล์มกันรอย 1 ปี'));
    expect(onPrintClaim).toHaveBeenLastCalledWith(expect.objectContaining({ id: 7 }), null);
  });

  it('reprints one recorded claim from its own row', async () => {
    const user = userEvent.setup();
    const saved = policy({
      claims: [
        {
          id: 3,
          claimedAt: '2026-09-01',
          bigUsed: 1,
          smallUsed: 0,
          detail: 'กันชนหน้า',
          technician: 'ช่างเอก',
        },
      ],
    });
    const { onPrintClaim } = renderSection({ policies: [saved] });

    await user.click(screen.getByLabelText('แก้ไขประกัน ประกันฟิล์มกันรอย 1 ปี'));
    await user.click(screen.getByLabelText('พิมพ์ใบเคลมครั้งที่ 1'));
    expect(onPrintClaim).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      expect.objectContaining({ id: 3, detail: 'กันชนหน้า' }),
    );
  });
  it("lists the car's other policies, so the counter sees the whole history", () => {
    renderSection({
      policies: [policy()],
      forPlate: [policy(), policy({ id: 9, ticketId: 'JT-CM-00100', planName: 'ประกันปีก่อน' })],
    });
    expect(screen.getByText(/เคยทำประกันจากใบงานอื่นอีก 1 ฉบับ/)).toBeInTheDocument();
  });
});
