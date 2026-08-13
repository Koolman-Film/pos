import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Sidebar } from '@/components/layout/Sidebar';
import { NAV_ITEMS, resolveActiveNavId } from '@/components/layout/navItems';

// `SidebarNav` calls `usePathname()`, which reads app-router context that does
// not exist outside Next. Every assertion below passes `activePath` explicitly,
// so the stubbed value is only there to keep the hook from reaching for it.
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

describe('Sidebar', () => {
  it('hides nav items the current role does not have access to', () => {
    render(<Sidebar activePath="/dashboard" hasNav={(k) => k === 'dashboard'} />);
    expect(screen.getByText('แดชบอร์ด')).toBeInTheDocument();
    expect(screen.queryByText('จัดการสิทธิ์')).not.toBeInTheDocument();
  });

  it('shows all nav items for a role with full access', () => {
    render(<Sidebar activePath="/dashboard" hasNav={() => true} />);
    expect(screen.getByText('จัดการสิทธิ์')).toBeInTheDocument();
  });

  it('registers every module, each gated on its own nav permission', () => {
    // Wave 4 builds the module routes concurrently and none of them may edit
    // this component, so every entry has to exist before they start. Asserting
    // the ids AND that each is individually gated is what keeps a later
    // "gate the whole group on one key" refactor from going unnoticed.
    // `customers` (ทะเบียนลูกค้า) joined after the trial run.
    expect(NAV_ITEMS.map((i) => i.id)).toEqual([
      'dashboard',
      'list',
      'customers',
      'wholesale',
      'stock',
      'commission',
      'accounting',
      'permissions',
    ]);

    for (const item of NAV_ITEMS) {
      const { unmount } = render(<Sidebar activePath="/dashboard" hasNav={(k) => k === item.id} />);
      expect(screen.getByText(item.label)).toBeInTheDocument();
      for (const other of NAV_ITEMS) {
        if (other.id !== item.id) expect(screen.queryByText(other.label)).not.toBeInTheDocument();
      }
      unmount();
    }
  });

  it('links each nav item at its route', () => {
    render(<Sidebar activePath="/dashboard" hasNav={() => true} />);
    expect(screen.getByText('Book งาน').closest('a')).toHaveAttribute('href', '/tickets');
    expect(screen.getByText('จัดการสิทธิ์').closest('a')).toHaveAttribute('href', '/permissions');
  });

  it('marks the entry matching the current path as active', () => {
    render(<Sidebar activePath="/wholesale" hasNav={() => true} />);
    expect(screen.getByText('ขายส่ง').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('แดชบอร์ด').closest('a')).not.toHaveAttribute('aria-current');
  });
});

describe('resolveActiveNavId', () => {
  it('keeps the parent module highlighted on a sub-route', () => {
    // Replaces the prototype's `view==='new'||view==='detail' ? 'list' : view`.
    expect(resolveActiveNavId(NAV_ITEMS, '/tickets/new')).toBe('list');
    expect(resolveActiveNavId(NAV_ITEMS, '/tickets/8f3a-1')).toBe('list');
  });

  it('returns undefined for a path outside the registry', () => {
    expect(resolveActiveNavId(NAV_ITEMS, '/login')).toBeUndefined();
    // A prefix that is not a path segment boundary must not match.
    expect(resolveActiveNavId(NAV_ITEMS, '/stockroom')).toBeUndefined();
  });
});
