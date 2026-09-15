import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CustomerPicker } from '@/components/wholesale/CustomerPicker';

/**
 * ลูกค้าขายส่งใหม่ — เบอร์ไม่มีขีด และเตือนเมื่อเบอร์ซ้ำกับร้านที่มีอยู่แล้ว.
 */

const customers = [{ id: 1, name: 'ร้านออโต้สไตล์', phone: '053-111-222', address: 'เชียงใหม่' }];

function renderPicker() {
  const onSelect = vi.fn();
  const onSaveCustomer = vi.fn(async () => 9);
  render(
    <CustomerPicker
      customerId={null}
      customers={customers}
      onSelect={onSelect}
      onSaveCustomer={onSaveCustomer}
    />,
  );
  return { onSelect, onSaveCustomer, user: userEvent.setup() };
}

describe('CustomerPicker (ขายส่ง) — เบอร์โทร', () => {
  it('warns about a number another shop already has, and can pick that shop', async () => {
    const { onSelect, onSaveCustomer, user } = renderPicker();
    await user.click(screen.getByRole('button', { name: /ลูกค้าใหม่/ }));
    await user.type(screen.getByLabelText('เบอร์โทรลูกค้าใหม่'), '053111222');
    expect(screen.getByRole('alert')).toHaveTextContent('ร้านออโต้สไตล์');
    await user.click(screen.getByRole('button', { name: 'ใช้ลูกค้าคนนี้' }));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onSaveCustomer).not.toHaveBeenCalled();
  });

  it('saves a new shop with its numbers cleaned', async () => {
    const { onSaveCustomer, user } = renderPicker();
    await user.click(screen.getByRole('button', { name: /ลูกค้าใหม่/ }));
    await user.type(screen.getByPlaceholderText('ชื่อลูกค้า/ร้าน'), 'ร้านใหม่');
    await user.type(screen.getByLabelText('เบอร์โทรลูกค้าใหม่'), '081-000-1111,089-000-2222');
    await user.click(screen.getByRole('button', { name: 'บันทึกลูกค้าใหม่' }));
    expect(onSaveCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ร้านใหม่', phone: '0810001111, 0890002222' }),
    );
  });
});
