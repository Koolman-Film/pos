import type { SupabaseClient } from '@supabase/supabase-js';

import { CURRENT_RELEASE, unreadCount } from './releaseNotes';

/**
 * สถานะการอ่านข่าวของคนที่ล็อกอินอยู่ (migration 0090).
 *
 * สองเลข ไม่ใช่เลขเดียว — `seen` คือ "อ่านจริงแล้ว" ซึ่งคุมจุดสีบนเมนู ส่วน
 * `dismissed` คือ "กดไว้ก่อนบนแถบแล้ว" ซึ่งคุมแค่แถบ การกดไว้ก่อนตอนลูกค้ายืน
 * รออยู่ ต้องไม่นับเป็นการอ่าน ไม่งั้นข่าวหายไปทั้งหมดโดยที่ยังไม่มีใครอ่าน
 */
export type NoticeState = {
  seen: number;
  dismissed: number;
  /** จำนวนเรื่องที่คนนี้ยังไม่ได้อ่าน — เฉพาะที่เกี่ยวกับสิทธิ์ของตัวเอง. */
  unread: number;
  /** ควรขึ้นแถบแจ้งหลังอัปเดตไหม. */
  showBar: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * อ่านสถานะ แล้วตอบว่าต้องขึ้นจุดสีและแถบหรือเปล่า.
 *
 * ยังไม่มีแถวในตาราง = ยังไม่เคยอ่านอะไรเลย ซึ่งเป็นคำตอบที่ถูกสำหรับทุกคนใน
 * วันที่ฟีเจอร์นี้ขึ้นระบบ — ไม่มีใครเคยถูกบอกอะไรจริง ๆ
 *
 * อ่านพังก็ไม่เป็นไร คืนค่าว่าอ่านครบแล้ว: ข่าวที่หายไปเงียบ ๆ ดีกว่าแถบที่
 * ค้างอยู่บนทุกหน้าเพราะฐานข้อมูลตอบไม่ได้
 */
export async function loadNoticeState(
  supabase: Db,
  userId: string,
  hasNav: (key: string) => boolean,
): Promise<NoticeState> {
  const { data, error } = await supabase
    .from('user_notice_state')
    .select('seen_release, dismissed_release')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return { seen: CURRENT_RELEASE, dismissed: CURRENT_RELEASE, unread: 0, showBar: false };
  }

  const seen = Number(data?.seen_release ?? 0);
  const dismissed = Number(data?.dismissed_release ?? 0);
  const unread = unreadCount(hasNav, seen);
  return {
    seen,
    dismissed,
    unread,
    // มีเรื่องที่ยังไม่ได้อ่าน และยังไม่ได้ปิดแถบของรุ่นนี้
    showBar: unread > 0 && dismissed < CURRENT_RELEASE,
  };
}
