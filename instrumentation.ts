import type { Instrumentation } from 'next';

import { reportRequestError } from '@/lib/observability/reportError';

/*
  Server errors that escape — a page that fails to render, a server action or
  route handler that throws — go to the server log with their route and digest
  (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
  Vercel keeps that log; search it for `[request-error]`.
*/
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  await reportRequestError(err, request, context);
};
