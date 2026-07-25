import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// `logout` is a Server Action; importing it for real pulls in the Supabase
// server client and `next/headers`, neither of which exists under jsdom.
vi.mock('@/app/login/actions', () => ({ logout: vi.fn() }));

import { Header } from '@/components/layout/Header';

describe('Header', () => {
  it('renders the signed-in user name', () => {
    render(<Header name="ผู้บริหาร" roleId="exec" email="exec@finnixfilm.com" />);
    expect(screen.getByText('ผู้บริหาร')).toBeInTheDocument();
  });

  it('shows the role label, email and logout control in the user menu', async () => {
    const user = userEvent.setup();
    render(<Header name="แอดมินระบบ" roleId="admin" email="admin@finnixfilm.com" />);

    // The prototype keeps all three behind the dropdown, as does the port.
    expect(screen.queryByText('แอดมิน/หลังบ้าน')).not.toBeInTheDocument();

    await user.click(screen.getByText('แอดมินระบบ'));

    expect(screen.getByText('แอดมิน/หลังบ้าน')).toBeInTheDocument();
    expect(screen.getByText('admin@finnixfilm.com')).toBeInTheDocument();

    const logoutButton = screen.getByRole('button', { name: 'ออกจากระบบ' });
    expect(logoutButton).toBeInTheDocument();
    // Sign-out must be a form submission, so it POSTs the Server Action rather
    // than clearing anything client-side only.
    expect(logoutButton).toHaveAttribute('type', 'submit');
    expect(logoutButton.closest('form')).not.toBeNull();
  });

  it('falls back to the raw role id for a role added after this map was written', () => {
    render(<Header name="พนักงานใหม่" roleId="warehouse" />);
    expect(screen.getByText('พนักงานใหม่')).toBeInTheDocument();
  });
});
