import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TicketCustomerPicker } from '@/components/tickets/TicketCustomerPicker';

/**
 * เพิ่มลูกค้าใหม่ตอนสร้างใบงาน — เบอร์ไม่มีขีด หลายเบอร์คั่นด้วย , และเตือนเมื่อเบอร์ซ้ำ.
 */

const customers = [{ id: 1, name: 'คุณ เอ', phone: '081-234-5678' }];

function renderPicker() {
  const onSelect = vi.fn();
  const setCustomers = vi.fn();
  render(
    <TicketCustomerPicker
      customerName=""
      customerPhone=""
      customers={customers}
      setCustomers={setCustomers}
      onSelect={onSelect}
    />,
  );
  return { onSelect, setCustomers, user: userEvent.setup() };
}

async function startNew(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'เลือกลูกค้าจากทะเบียน' }));
  await user.click(screen.getByRole('option', { name: '+ เพิ่มลูกค้าใหม่' }));
}

describe('TicketCustomerPicker — เบอร์โทร', () => {
  it('leaves the dashes out as the number is typed', async () => {
    const { user } = renderPicker();
    await startNew(user);
    await user.type(screen.getByLabelText('เบอร์โทรลูกค้าใหม่'), '089-999-0000');
    expect(screen.getByLabelText('เบอร์โทรลูกค้าใหม่')).toHaveValue('0899990000');
  });

  it('warns when the number already belongs to a customer, even one saved with dashes', async () => {
    const { user } = renderPicker();
    await startNew(user);
    await user.type(screen.getByPlaceholderText('ชื่อลูกค้า'), 'คุณ เอ (ซ้ำ)');
    await user.type(screen.getByLabelText('เบอร์โทรลูกค้าใหม่'), '0812345678');
    expect(screen.getByRole('alert')).toHaveTextContent('เบอร์นี้มีในทะเบียนแล้ว');
    expect(screen.getByRole('alert')).toHaveTextContent('คุณ เอ · 081-234-5678');
    // Saving anyway has to be a deliberate choice.
    expect(screen.getByRole('button', { name: 'ยืนยันเพิ่มเป็นลูกค้าใหม่' })).toBeInTheDocument();
  });

  it('picks the existing customer instead of adding a second one', async () => {
    const { onSelect, setCustomers, user } = renderPicker();
    await startNew(user);
    await user.type(screen.getByLabelText('เบอร์โทรลูกค้าใหม่'), '0812345678');
    await user.click(screen.getByRole('button', { name: 'ใช้ลูกค้าคนนี้' }));
    expect(onSelect).toHaveBeenCalledWith(customers[0]);
    expect(setCustomers).not.toHaveBeenCalled();
  });

  it('saves several numbers separated by commas', async () => {
    const { onSelect, user } = renderPicker();
    await startNew(user);
    await user.type(screen.getByPlaceholderText('ชื่อลูกค้า'), 'คุณ ใหม่');
    await user.type(screen.getByLabelText('เบอร์โทรลูกค้าใหม่'), '0899990000,053-123-456');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'บันทึกลูกค้าใหม่' }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'คุณ ใหม่', phone: '0899990000, 053123456' }),
    );
  });
});
