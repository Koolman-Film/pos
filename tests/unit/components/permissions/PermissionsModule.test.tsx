import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionsModule } from '@/components/permissions/PermissionsModule';

const roles = [{ id: 'sales', name: 'พนักงานขาย', icon: 'fa-user-tie' }];

describe('PermissionsModule', () => {
  it('renders a role and lets its module capabilities be toggled', () => {
    render(
      <PermissionsModule
        roles={roles}
        modulePermissions={{ sales: { 'stock.editDelete': false } }}
        onToggle={() => {}}
      />,
    );
    const toggle = screen.getByRole('checkbox', { name: /stock: แก้ไข\/ลบสินค้า/i });
    expect(toggle).not.toBeChecked();
  });

  it('reflects an enabled capability as checked', () => {
    render(
      <PermissionsModule
        roles={roles}
        modulePermissions={{ sales: { 'stock.editDelete': true } }}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /stock: แก้ไข\/ลบสินค้า/i })).toBeChecked();
  });

  it('invokes onToggle with (roleId, key, nextValue) when a cell is clicked', async () => {
    const onToggle = vi.fn();
    render(
      <PermissionsModule
        roles={roles}
        modulePermissions={{ sales: { 'stock.editDelete': false } }}
        onToggle={onToggle}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /stock: แก้ไข\/ลบสินค้า/i }));
    expect(onToggle).toHaveBeenCalledWith('sales', 'stock.editDelete', true);
  });

  it('locks the admin column: its cells are checked, disabled, and never fire a toggle', async () => {
    const onToggle = vi.fn();
    render(
      <PermissionsModule
        roles={[{ id: 'admin', name: 'แอดมิน/หลังบ้าน', icon: 'fa-gear' }]}
        modulePermissions={{ admin: {} }}
        onToggle={onToggle}
      />,
    );
    const cell = screen.getByRole('checkbox', { name: /stock: แก้ไข\/ลบสินค้า/i });
    expect(cell).toBeChecked();
    expect(cell).toBeDisabled();
    await userEvent.click(cell);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('renders nav and dashboard permission checkboxes wired to their own handlers', async () => {
    const onToggleNav = vi.fn();
    const onToggleDash = vi.fn();
    render(
      <PermissionsModule
        roles={roles}
        navPermissions={{ sales: { stock: false } }}
        dashboardPermissions={{ sales: { revenue: false } }}
        onToggleNav={onToggleNav}
        onToggleDash={onToggleDash}
      />,
    );
    // nav row for the "สต็อกสินค้า" menu, key `stock`
    await userEvent.click(screen.getByRole('checkbox', { name: /stock: สต็อกสินค้า/i }));
    expect(onToggleNav).toHaveBeenCalledWith('sales', 'stock', true);
    // dashboard widget row for total-revenue card, key `revenue`
    await userEvent.click(screen.getByRole('checkbox', { name: /revenue: การ์ดยอดขายรวม/i }));
    expect(onToggleDash).toHaveBeenCalledWith('sales', 'revenue', true);
  });

  it('renders with only the required props (all data/callbacks optional)', () => {
    render(<PermissionsModule roles={roles} />);
    expect(screen.getByText('จัดการสิทธิ์การเข้าถึง')).toBeInTheDocument();
  });
});
