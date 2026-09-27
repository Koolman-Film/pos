import { describe, it, expect, vi, afterEach } from 'vitest';

import { reportActionError, reportRequestError } from '@/lib/observability/reportError';

/*
  Failures that used to reach nobody but the person looking at the screen.

  Server actions caught their own exceptions and returned `{ ok: false }`; the
  message went to one browser and nowhere else, so the owner learned about a
  failing save only when staff complained. These write one line per failure to
  the server log (Vercel's runtime logs), tagged so it can be searched for.
*/
describe('error reporting', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs an action failure with the action, the user and the message', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const message = reportActionError('tickets.createTicket', new Error('duplicate key'), 'u-123');
    expect(message).toBe('duplicate key');
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('[action-error]');
    expect(line).toContain('tickets.createTicket');
    expect(line).toContain('u-123');
    expect(line).toContain('duplicate key');
  });

  it('copes with a thrown value that is not an Error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(reportActionError('x', 'boom')).toBe('boom');
    expect(String(log.mock.calls[0][0])).toContain('boom');
  });

  it('logs an escaped request error with its route, kind and digest', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('relation does not exist'), { digest: 'abc123' });
    await reportRequestError(
      err,
      { path: '/revenue?shop=cm', method: 'GET', headers: {} },
      {
        routerKind: 'App Router',
        routePath: '/(app)/revenue',
        routeType: 'render',
        renderSource: 'server-rendering',
        revalidateReason: undefined,
      },
    );
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('[request-error]');
    expect(line).toContain('render');
    expect(line).toContain('/(app)/revenue');
    expect(line).toContain('abc123');
    expect(line).toContain('relation does not exist');
  });
});
