'use server';

import { getSessionContext } from '@/lib/auth/session';
import { loadAlertSnapshot } from '@/lib/alerts/load';
import type { AlertSnapshot } from '@/lib/alerts/types';
import { shopDayKey } from '@/lib/domain/format';
import { createClient } from '@/lib/supabase/server';

/**
 * การแจ้งเตือนของผู้ใช้ที่ล็อกอินอยู่ — what the bell polls.
 *
 * Per CORRECTION C2 this re-establishes the session itself; the header being
 * rendered is not proof of anything. The loader then reads only what this
 * person's permissions allow, through RLS.
 */
export async function getAlertSnapshot(): Promise<AlertSnapshot> {
  const session = await getSessionContext();
  const supabase = await createClient();
  return loadAlertSnapshot(session, supabase);
}

/**
 * "รับทราบ · ซ่อนถึงพรุ่งนี้".
 *
 * Dated by the server on the shop's calendar — a browser clock set wrong must
 * not be able to hide tomorrow's reminders. RLS keeps the row the caller's own.
 */
export async function acknowledgeAlertsToday(
  urgentKeys: string[],
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const keys = (Array.isArray(urgentKeys) ? urgentKeys : [])
    .filter((k): k is string => typeof k === 'string')
    .slice(0, 1000);

  const { error } = await supabase.from('alert_acknowledgements').upsert(
    {
      user_id: session.userId,
      acked_on: shopDayKey(new Date()),
      acked_keys: keys,
      acked_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,acked_on' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
