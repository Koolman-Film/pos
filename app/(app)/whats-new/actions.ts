'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { CURRENT_RELEASE } from '@/lib/notices/releaseNotes';
import { createClient } from '@/lib/supabase/server';

/**
 * "ไว้ก่อน" บนแถบแจ้งหลังอัปเดต — ปิดแค่แถบ ไม่ใช่ปิดข่าว.
 *
 * จุดสีบนเมนูชื่อผู้ใช้ยังอยู่ จนกว่าจะเปิดอ่านจริง คนที่กดตอนลูกค้ายืนรออยู่
 * จึงไม่ได้เสียข่าวนั้นไป แค่เลื่อนไปอ่านตอนว่าง
 *
 * ไม่กลับมากวนพรุ่งนี้เหมือนกระดิ่ง เพราะกระดิ่งเตือนเรื่องที่ "ยังค้างต้องทำ"
 * ส่วนข่าวที่เลือกจะยังไม่อ่าน ไม่ใช่เรื่องค้าง
 */
export async function dismissNoticeBar(): Promise<{ ok: boolean; error?: string }> {
  // CORRECTION C2: การที่แถบถูกเรนเดอร์ ไม่ใช่หลักฐานว่าใครเรียกมา
  const session = await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.from('user_notice_state').upsert(
    {
      user_id: session.userId,
      dismissed_release: CURRENT_RELEASE,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) return { ok: false, error: error.message };
  // แถบอยู่บนทุกหน้า จึงต้องหายจากทุกหน้า ไม่ใช่เฉพาะหน้าที่กด
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * เปิดอ่านหน้า "มีอะไรใหม่" แล้ว — ทั้งจุดสีและแถบหายพร้อมกัน.
 *
 * เรียกจากหน้านั้นเอง ไม่ใช่จากปุ่ม เพราะ "อ่านแล้ว" หมายถึงเปิดดู ไม่ใช่กด
 * ยืนยันว่าอ่าน — ปุ่มยืนยันคือสิ่งที่คนกดโดยไม่อ่านอยู่ดี
 */
export async function markNoticesSeen(): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.from('user_notice_state').upsert(
    {
      user_id: session.userId,
      seen_release: CURRENT_RELEASE,
      dismissed_release: CURRENT_RELEASE,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/', 'layout');
  return { ok: true };
}
