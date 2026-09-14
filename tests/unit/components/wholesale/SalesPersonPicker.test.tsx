import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SalesPersonPicker } from '@/components/wholesale/SalesPersonPicker';

/**
 * พนักงานขาย — ชื่อ เบอร์ และบัญชีเข้าระบบ.
 *
 * A rep linked to their login is reminded about their own customers' bills
 * (migration 0058). And adding a rep must add one: it used to overwrite
 * whoever happened to be selected on the PO.
 */

const PEOPLE = [{ id: 1, shop: 'north', name: 'โหน่ง', phone: '089-431-2278', userId: null }];
const ACCOUNTS = [
  { id: 'u-nong', name: 'โหน่ง (บัญชี)' },
  { id: 'u-ken', name: 'เคน (บัญชี)' },
];

function renderPicker(save = vi.fn(async () => ({ ok: true }))) {
  render(
    <SalesPersonPicker
      value="โหน่ง"
      shop="north"
      people={PEOPLE}
      canManage
      onSelect={vi.fn()}
      onSavePerson={save}
      accounts={ACCOUNTS}
    />,
  );
  return { save, user: userEvent.setup() };
}

describe('SalesPersonPicker', () => {
  it('links a rep to their login', async () => {
    const { save, user } = renderPicker();
    await user.click(screen.getByRole('button', { name: 'แก้ไขพนักงานขาย' }));
    await user.selectOptions(screen.getByLabelText('บัญชีเข้าระบบของพนักงานขาย'), 'u-nong');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'โหน่ง', userId: 'u-nong' }),
    );
  });

  it('adds a new rep instead of overwriting the one selected', async () => {
    const { save, user } = renderPicker();
    await user.click(screen.getByRole('button', { name: /เพิ่ม/ }));
    await user.type(screen.getByLabelText('ชื่อพนักงานขาย'), 'เคน');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: undefined, name: 'เคน' }));
  });

  it('can remove a link', async () => {
    const save = vi.fn(async () => ({ ok: true }));
    render(
      <SalesPersonPicker
        value="โหน่ง"
        shop="north"
        people={[{ ...PEOPLE[0], userId: 'u-nong' }]}
        canManage
        onSelect={vi.fn()}
        onSavePerson={save}
        accounts={ACCOUNTS}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'แก้ไขพนักงานขาย' }));
    expect(screen.getByLabelText('บัญชีเข้าระบบของพนักงานขาย')).toHaveValue('u-nong');
    await user.selectOptions(screen.getByLabelText('บัญชีเข้าระบบของพนักงานขาย'), '');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });
});
