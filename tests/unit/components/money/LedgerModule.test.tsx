import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: vi.fn() }),
}));

import type { AccountLedger } from '@/components/dashboard/moneyFlow';
import { LedgerModule } from '@/components/money/LedgerModule';

/**
 * สมุดบัญชีแหล่งเงิน — the screen.
 *
 * The arithmetic is pinned in moneyLedger.test.ts. These pin what the screen
 * promises on top of it: every line says where the money came from, a reference
 * opens its document only for someone allowed to, and the period and the
 * account are URLs that can be followed.
 */

const ACCOUNT = {
  id: 1,
  name: 'K-bank คูลมาน เชียงใหม่',
  kind: 'bank',
  accountNo: '186-369345-0',
  openedAt: '2026-09-01',
  shopName: 'FINNIX FILM เชียงใหม่',
};
const BRANCH = [
  { id: 1, name: 'K-bank คูลมาน เชียงใหม่' },
  { id: 3, name: 'เงินสดย่อย - เชียงใหม่' },
];

const LEDGER: AccountLedger = {
  accountId: 1,
  from: '2026-09-01',
  to: '2026-09-30',
  beforeOpening: false,
  carriedIn: 50_000,
  increase: 13_960.72,
  decrease: 7_500,
  carriedOut: 56_460.72,
  entries: [
    {
      key: 'm0',
      on: '2026-09-05',
      kind: 'receipt',
      amount: 6_400,
      balance: 56_400,
      ref: {
        kind: 'ticket',
        id: 'JT-CM-00001',
        docNo: 'JT-CM-00001',
        title: 'คุณวิภา',
        detail: '1กข 4455 · ชำระเต็มจำนวน',
      },
    },
    {
      key: 't8-in',
      on: '2026-09-12',
      kind: 'transfer-in',
      amount: 7_560.72,
      balance: 63_960.72,
      counterpartId: null,
      note: 'ยอดจากเครื่องรูด',
    },
    {
      key: 't7-out',
      on: '2026-09-12',
      kind: 'transfer-out',
      amount: -5_000,
      balance: 58_960.72,
      counterpartId: 3,
      note: 'เติมเงินสดย่อย',
    },
    {
      key: 'm1',
      on: '2026-09-12',
      kind: 'expense',
      amount: -2_500,
      balance: 56_460.72,
      ref: {
        kind: 'expense',
        id: '9',
        docNo: 'POS-CM-6909059',
        title: 'ค่าอาหารกลางวัน',
        detail: 'สวัสดิการพนักงาน',
      },
    },
  ],
  counts: [
    {
      id: 1,
      on: '2026-09-12',
      counted: 56_460.72,
      systemAtRecord: 56_460.72,
      systemNow: 56_460.72,
      note: 'statement',
    },
  ],
  months: [
    {
      month: '2026-09',
      carriedIn: 50_000,
      increase: 13_960.72,
      decrease: 7_500,
      carriedOut: 56_460.72,
    },
  ],
};

function renderLedger(over: Partial<Parameters<typeof LedgerModule>[0]> = {}) {
  return render(
    <LedgerModule
      account={ACCOUNT}
      branchAccounts={BRANCH}
      ledger={LEDGER}
      caption="สรุปข้อมูลรายเดือน · กันยายน 2569"
      period="month"
      periodValue="2026-09"
      rangeStart=""
      rangeEnd=""
      todayKey="2026-09-14"
      links={{ tickets: true, wholesale: true, expenseFiles: false }}
      reconcileAction={vi.fn(async () => ({ ok: true }))}
      {...over}
    />,
  );
}

beforeEach(() => {
  nav.push.mockReset();
  nav.refresh.mockReset();
});

describe('LedgerModule', () => {
  it('dates ยอดยกมา from the day the account opened when the period starts earlier', () => {
    renderLedger({
      ledger: { ...LEDGER, from: '2026-01-01', to: '2026-12-31' },
      period: 'year',
      periodValue: '2569',
    });
    expect(screen.getByText(/ยอดยกมา 1 ก\.ย\. 2569/)).toBeInTheDocument();
    expect(screen.queryByText(/ยอดยกมา 1 ม\.ค\. 2569/)).not.toBeInTheDocument();
  });

  it('opens with what was carried in and closes with what is carried out', () => {
    renderLedger();
    expect(screen.getAllByText('50,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('56,460.72').length).toBeGreaterThan(0);
    expect(screen.getAllByText('รวมช่วงนี้ · ยอดยกไป').length).toBe(1);
  });

  it('links a ticket payment to its ใบงาน for someone who may open it', () => {
    renderLedger();
    expect(screen.getByRole('link', { name: 'JT-CM-00001' })).toHaveAttribute(
      'href',
      '/tickets/JT-CM-00001',
    );
  });

  it('still prints the reference, as text, for someone who may not', () => {
    renderLedger({ links: { tickets: false, wholesale: false, expenseFiles: false } });
    expect(screen.queryByRole('link', { name: 'JT-CM-00001' })).not.toBeInTheDocument();
    expect(screen.getAllByText('JT-CM-00001').length).toBeGreaterThan(0);
  });

  it("links a transfer to the other account's ledger for the same period", () => {
    renderLedger();
    expect(screen.getByRole('link', { name: 'เงินสดย่อย - เชียงใหม่' })).toHaveAttribute(
      'href',
      '/money/3?period=month&v=2026-09',
    );
  });

  it('names นอกระบบ for money that came from outside the register', () => {
    renderLedger();
    expect(screen.getAllByText(/โอนเข้า จาก นอกระบบ/).length).toBeGreaterThan(0);
  });

  it('opens a month from the year view', async () => {
    const user = userEvent.setup();
    renderLedger({ period: 'year', periodValue: '2569' });
    await user.click(screen.getByRole('button', { name: /กันยายน 2569/ }));
    expect(nav.push).toHaveBeenCalledWith('/money/1?period=month&v=2026-09');
  });

  it('warns when history under a recorded count has changed since', () => {
    renderLedger({
      ledger: {
        ...LEDGER,
        counts: [{ ...LEDGER.counts[0], systemAtRecord: 50_000 }],
      },
    });
    expect(screen.getByText(/ยอดระบบ ณ วันนั้นเปลี่ยนไปจากตอนบันทึก/)).toBeInTheDocument();
  });

  it('will not record a count without the counted figure', async () => {
    const user = userEvent.setup();
    const reconcileAction = vi.fn(async () => ({ ok: true }));
    renderLedger({ reconcileAction });
    await user.click(screen.getByRole('button', { name: 'บันทึกการกระทบยอด' }));
    expect(reconcileAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('กรอกยอดที่นับได้จริง');
  });

  it('records a count dated the last day on screen by default', async () => {
    const user = userEvent.setup();
    const reconcileAction = vi.fn(async () => ({ ok: true }));
    renderLedger({
      reconcileAction,
      ledger: { ...LEDGER, from: '2026-08-01', to: '2026-08-31' },
      periodValue: '2026-08',
    });
    await user.type(screen.getByLabelText('ยอดที่นับได้จริง'), '56460.72');
    await user.click(screen.getByRole('button', { name: 'บันทึกการกระทบยอด' }));
    await vi.waitFor(() =>
      expect(reconcileAction).toHaveBeenCalledWith({
        accountId: 1,
        countedAt: '2026-08-31',
        countedBalance: 56_460.72,
        note: '',
      }),
    );
  });
});
