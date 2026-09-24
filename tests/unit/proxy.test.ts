import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ claims: null as null | { sub: string } }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: auth.claims ? { claims: auth.claims } : null }) },
  }),
}));

import { isReportHost, proxy } from '@/proxy';

/**
 * รายงานสำหรับผู้บริหาร on its own host: signed in, every page path is the
 * report; signed out, it is the usual sign-in. The POS host is unchanged.
 */

const req = (host: string, path: string) =>
  new NextRequest(new URL(`https://${host}${path}`), { headers: { host } });
const rewrittenTo = (res: Response) => res.headers.get('x-middleware-rewrite');

describe('proxy — report host', () => {
  beforeEach(() => {
    auth.claims = { sub: 'u1' };
  });

  it('knows the report host by its first label', () => {
    expect(isReportHost('report.kool-man.com')).toBe(true);
    expect(isReportHost('report.localhost:3000')).toBe(true);
    expect(isReportHost('finnixpos.kool-man.com')).toBe(false);
    expect(isReportHost(null)).toBe(false);
  });

  it('shows the report for every page path, keeping the query', async () => {
    for (const path of ['/', '/dashboard', '/tickets/JT-1', '/money']) {
      const res = await proxy(req('report.kool-man.com', `${path}?d=2026-09-23`));
      expect(new URL(rewrittenTo(res)!).pathname).toBe('/report');
      expect(new URL(rewrittenTo(res)!).search).toBe('?d=2026-09-23');
    }
  });

  it('leaves sign-in, the report itself and static files alone', async () => {
    for (const path of ['/login', '/auth/callback', '/report', '/wrap/wrap-body.png']) {
      expect(rewrittenTo(await proxy(req('report.kool-man.com', path)))).toBeNull();
    }
  });

  it('still sends a signed-out visitor to sign in', async () => {
    auth.claims = null;
    const res = await proxy(req('report.kool-man.com', '/'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('does nothing different on the POS host', async () => {
    expect(rewrittenTo(await proxy(req('finnixpos.kool-man.com', '/dashboard')))).toBeNull();
  });
});
