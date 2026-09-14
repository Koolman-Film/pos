import { describe, it, expect } from 'vitest';

import { periodBounds } from '@/lib/domain/period';

const TODAY = '2026-09-14';

describe('periodBounds', () => {
  it('is one day for วันนี้', () => {
    expect(periodBounds('today', '', '', '', TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it('runs to the real last day of the month', () => {
    expect(periodBounds('month', '2026-09', '', '', TODAY)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(periodBounds('month', '2026-02', '', '', TODAY).to).toBe('2026-02-28');
    expect(periodBounds('month', '2028-02', '', '', TODAY).to).toBe('2028-02-29');
  });

  it('falls back to this month when the month value is unusable', () => {
    expect(periodBounds('month', '', '', '', TODAY).from).toBe('2026-09-01');
  });

  it('accepts a Buddhist-era or a CE year', () => {
    const want = { from: '2026-01-01', to: '2026-12-31' };
    expect(periodBounds('year', '2569', '', '', TODAY)).toEqual(want);
    expect(periodBounds('year', '2026', '', '', TODAY)).toEqual(want);
  });

  it('keeps an open side open, and puts a reversed range the right way round', () => {
    expect(periodBounds('range', '2026-09-01', '2026-09-01', '', TODAY)).toEqual({
      from: '2026-09-01',
      to: '',
    });
    expect(periodBounds('range', '', '2026-09-20', '2026-09-01', TODAY)).toEqual({
      from: '2026-09-01',
      to: '2026-09-20',
    });
  });
});
