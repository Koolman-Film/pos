import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: '/dashboard' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => nav.pathname,
}));
vi.mock('@/app/login/actions', () => ({ logout: vi.fn() }));

import { Header } from '@/components/layout/Header';

/**
 * ช่องค้นหาด้านบน — it used to be a picture of a search box. It now searches
 * the list on screen, or the first list this person may open.
 */

async function searchFor(words: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'ค้นหา' }), `${words}{Enter}`);
}

describe('Header — ค้นหา', () => {
  beforeEach(() => {
    nav.push.mockClear();
  });

  it('searches the list already on screen', async () => {
    nav.pathname = '/customers';
    render(<Header name="แอดมินระบบ" roleId="admin" searchHome="/tickets" />);
    await searchFor('081-234-5678');
    expect(nav.push).toHaveBeenCalledWith(`/customers?q=${encodeURIComponent('081-234-5678')}`);
  });

  it('sends a search typed away from a list to this person’s first list', async () => {
    nav.pathname = '/dashboard';
    render(<Header name="พนักงานขาย" roleId="sales" searchHome="/wholesale" />);
    await searchFor('WS-NT-0002');
    expect(nav.push).toHaveBeenCalledWith('/wholesale?q=WS-NT-0002');
  });

  it('offers no search to someone with no list to search', () => {
    nav.pathname = '/dashboard';
    render(<Header name="ช่าง" roleId="tech" />);
    expect(screen.queryByRole('textbox', { name: 'ค้นหา' })).not.toBeInTheDocument();
  });
});
