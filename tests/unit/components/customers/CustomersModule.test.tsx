import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { CustomersModule } from '@/components/customers/CustomersModule';
import type { CustomerRow } from '@/components/customers/types';

/**
 * ทะเบียนลูกค้า — ไม่มีปุ่มเพิ่มลูกค้า (ร้านขอ 15 ก.ย. 2569).
 *
 * Customers added from this page had no job behind them and filled the register
 * with names nobody served. A customer now enters the register with a ticket;
 * this page looks people up and corrects them.
 */

const CUSTOMER: CustomerRow = {
  id: 1,
  name: 'คุณ วิภา',
  phone: '081-234-5678',
  ticketCount: 2,
  totalSpent: 12900,
  lastVisit: new Date('2026-09-14T03:00:00Z'),
  vehicles: [{ plate: 'ขข 4417', brand: 'Honda', model: 'HR-V', carType: '' }],
  tickets: [],
};

function renderModule(saveAction = vi.fn(async () => ({ ok: true }))) {
  render(
    <CustomersModule
      customers={[CUSTOMER]}
      shops={[{ id: 'cm', name: 'FINNIX FILM เชียงใหม่' }]}
      statuses={[]}
      canEdit
      canCreateTicket
      saveAction={saveAction}
      deleteAction={vi.fn(async () => ({ ok: true }))}
    />,
  );
  return { saveAction, user: userEvent.setup() };
}

describe('CustomersModule', () => {
  it('has no button to add a customer, even for someone who may edit', () => {
    renderModule();
    expect(screen.queryByRole('button', { name: /เพิ่มลูกค้า/ })).not.toBeInTheDocument();
    expect(screen.getByText('ลูกค้าใหม่เข้าทะเบียนเองตอนสร้างใบงาน')).toBeInTheDocument();
  });

  it('still lets a customer be corrected', async () => {
    const { saveAction, user } = renderModule();
    await user.click(screen.getByRole('button', { name: 'แก้ไข คุณ วิภา' }));
    expect(screen.getByText('แก้ไขข้อมูลลูกค้า')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('เบอร์โทร'));
    await user.type(screen.getByLabelText('เบอร์โทร'), '089-000-0000');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await vi.waitFor(() =>
      expect(saveAction).toHaveBeenCalledWith(
        // Typed with dashes, which the field leaves out (ร้านขอ 15 ก.ย. 2569).
        expect.objectContaining({ id: 1, phone: '0890000000' }),
      ),
    );
  });
});
