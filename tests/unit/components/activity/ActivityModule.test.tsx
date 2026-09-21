import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { ActivityModule } from '@/components/activity/ActivityModule';
import type { ActivityEntry } from '@/lib/domain/activity';

/**
 * ประวัติการใช้งาน (ร้านขอ 19 ก.ย. 2569) — the screen that answers
 * "ใครแก้ใบงานนี้ทับ": who, when, which document, and what it was before.
 */

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: 1,
  at: '2026-09-21T03:15:00Z',
  tx: 100,
  actorName: 'พนักงานขาย',
  shop: 'cm',
  entity: 'tickets',
  recordId: 'JT-CM-00214',
  docRef: 'JT-CM-00214',
  action: 'แก้ไข',
  changes: { color: ['ขาว', 'แดง'] },
  ...over,
});

const shops = [{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }];
const users = [{ id: 'u-sales', name: 'พนักงานขาย' }];

function renderModule(entries: ActivityEntry[], filter = {}) {
  render(
    <ActivityModule
      entries={entries}
      hasMore={false}
      filter={filter}
      shops={shops}
      users={users}
    />,
  );
}

beforeEach(() => push.mockReset());

describe('ActivityModule', () => {
  it('leads with who and which document, and shows the old value beside the new', () => {
    renderModule([entry({})]);
    const card = screen.getByRole('article');
    expect(within(card).getByText('พนักงานขาย')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'JT-CM-00214' })).toHaveAttribute(
      'href',
      '/tickets/JT-CM-00214',
    );
    expect(within(card).getByText('ขาว')).toBeInTheDocument();
    expect(within(card).getByText('แดง')).toBeInTheDocument();
  });

  it('shows one save of a header and its lines as one card', () => {
    renderModule([
      entry({
        id: 2,
        entity: 'ticket_lines',
        changes: {
          payments: [
            [{ uid: 'p1', type: 'มัดจำ', method: 'เงินสด', amount: 4400 }],
            [{ uid: 'p1', type: 'มัดจำ', method: 'เงินสด', amount: 4500 }],
          ],
        },
      }),
      entry({ id: 1 }),
    ]);
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText('การรับเงิน')).toBeInTheDocument();
    expect(within(cards[0]).getByText('4,400.00')).toBeInTheDocument();
    expect(within(cards[0]).getByText('4,500.00')).toBeInTheDocument();
  });

  it('keeps separate saves apart', () => {
    renderModule([entry({ id: 2, tx: 101 }), entry({ id: 1, tx: 100 })]);
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('puts the filter in the address, so a filtered view can be sent to somebody', async () => {
    const user = userEvent.setup();
    renderModule([]);
    await user.type(screen.getByLabelText('ค้นตามเลขเอกสาร'), 'JT-CM-00214');
    await user.selectOptions(screen.getByLabelText('กรองตามผู้ทำ'), 'u-sales');
    await user.click(screen.getByRole('button', { name: /ค้นหา/ }));
    expect(push).toHaveBeenCalledWith('/activity?actor=u-sales&doc=JT-CM-00214');
  });

  it('says plainly when a filter finds nothing', () => {
    renderModule([], { doc: 'JT-XX' });
    expect(screen.getByText('ไม่พบประวัติตามที่กรอง')).toBeInTheDocument();
  });
});
