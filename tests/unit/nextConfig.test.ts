import { describe, it, expect } from 'vitest';

import nextConfig from '@/next.config';

/*
  Security headers on every response.

  Without them the POS could be framed by another site and its admin buttons
  clickjacked, and the browser was free to guess content types. CSP here is only
  `frame-ancestors` — a full script policy needs a nonce for the inline theme
  script, and is a separate change.
*/
describe('next.config security headers', () => {
  async function headersFor(path: string) {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((r) => new RegExp(`^${r.source.replace('(.*)', '.*')}$`).test(path));
    return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
  }

  it.each(['/login', '/dashboard', '/tickets/JT-CM-00212', '/auth/callback'])(
    'sends them on %s',
    async (path) => {
      const h = await headersFor(path);
      expect(h['content-security-policy']).toBe("frame-ancestors 'self'");
      expect(h['x-frame-options']).toBe('SAMEORIGIN');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    },
  );

  it('does not switch off anything the app uses (camera for photos, clipboard for links)', async () => {
    const policy = (await headersFor('/dashboard'))['permissions-policy'] ?? '';
    expect(policy).not.toMatch(/camera|clipboard/);
  });
});
