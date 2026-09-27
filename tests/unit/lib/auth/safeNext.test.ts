import { describe, it, expect } from 'vitest';

import { safeNextPath } from '@/lib/auth/safeNext';

describe('safeNextPath', () => {
  it('keeps the paths the app itself sends', () => {
    expect(safeNextPath('/auth/accept')).toBe('/auth/accept');
    expect(safeNextPath('/tickets/JT-CM-00212?tab=pay#top')).toBe(
      '/tickets/JT-CM-00212?tab=pay#top',
    );
  });

  it('falls back to the dashboard when nothing is given', () => {
    expect(safeNextPath(null)).toBe('/dashboard');
    expect(safeNextPath('')).toBe('/dashboard');
  });

  it.each([
    ['javascript:alert(document.cookie)'],
    ['JavaScript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['https://evil.example/login'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['/\t/evil.example'],
    ['/\n/evil.example'],
    [' //evil.example'],
    ['dashboard'],
  ])('refuses %j and sends the user to the dashboard instead', (raw) => {
    expect(safeNextPath(raw)).toBe('/dashboard');
  });
});
