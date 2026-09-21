import { notFound } from 'next/navigation';

import { ActivityModule } from '@/components/activity/ActivityModule';
import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

import { loadActivity, parseActivityFilter } from './data';

/**
 * ประวัติการใช้งาน (`/activity`) — who changed what, when, and what it was.
 *
 * แอดมินเท่านั้น, as the shop decided (19 ก.ย. 2569). Checked on the role, not
 * on a nav permission: a nav key is something จัดการสิทธิ์ can hand to another
 * role, and this one is not meant to be handed out. The table's RLS applies the
 * same rule, so the check here is about the screen, not the data.
 *
 * `notFound()` rather than a refusal, so the route does not advertise itself.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (session.roleId !== 'admin') notFound();

  const filter = parseActivityFilter(await searchParams);
  const supabase = await createClient();
  const [{ entries, hasMore }, { data: shopRows }, { data: userRows }] = await Promise.all([
    loadActivity(supabase, filter),
    supabase.from('shops').select('id, name, sort_order').order('sort_order'),
    supabase.from('app_users').select('id, name').order('name'),
  ]);

  return (
    <ActivityModule
      entries={entries}
      hasMore={hasMore}
      filter={filter}
      shops={(shopRows ?? []).map((s) => ({ id: s.id, name: s.name }))}
      users={(userRows ?? []).map((u) => ({ id: u.id, name: u.name }))}
    />
  );
}
