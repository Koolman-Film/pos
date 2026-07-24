import { redirect } from 'next/navigation';

/**
 * The app has no content of its own at `/`. Send callers to the dashboard —
 * `proxy.ts` plus `getSessionContext()` bounce anyone without a session on to
 * `/login` from there.
 */
export default function RootPage() {
  redirect('/dashboard');
}
