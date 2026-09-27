import type { Instrumentation } from 'next';

/**
 * One line in the server log per failure, tagged for searching in Vercel's
 * runtime logs (`[action-error]`, `[request-error]`).
 *
 * Before this the codebase had a single `console.error`. Server actions caught
 * their own exceptions and returned `{ ok: false, error }`, so a failing save
 * reached exactly one place — the screen of the person who pressed บันทึก — and
 * the owner found out when staff complained, if they did.
 *
 * Deliberately not called for EXPECTED rejections (no permission, a rule the
 * database enforces such as "attach delivery evidence"): those are answers, not
 * failures, and logging them as errors would bury the ones that matter.
 */

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Log a server action's caught failure and hand back its message, so a catch
 * block can report and answer in one line.
 */
export function reportActionError(action: string, err: unknown, userId?: string): string {
  const message = messageOf(err);
  console.error(
    `[action-error] ${action}${userId ? ` user=${userId}` : ''}: ${message}`,
    err instanceof Error && err.stack ? err.stack : '',
  );
  return message;
}

/**
 * Everything that escapes a render, route handler, action or proxy — wired in
 * `instrumentation.ts` as `onRequestError`. `digest` is the id Next shows the
 * user on its error page, so a staff member's screenshot can be matched to the
 * log line.
 */
export async function reportRequestError(
  ...[err, request, context]: Parameters<Instrumentation.onRequestError>
): Promise<void> {
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err
      ? String((err as { digest: unknown }).digest)
      : '';
  console.error(
    `[request-error] ${context.routeType} ${request.method} ${context.routePath} (${request.path})` +
      `${digest ? ` digest=${digest}` : ''}: ${messageOf(err)}`,
    err instanceof Error && err.stack ? err.stack : '',
  );
}
