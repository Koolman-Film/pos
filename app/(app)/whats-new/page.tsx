import { WhatsNewView } from '@/components/notices/WhatsNewView';
import { getSessionContext } from '@/lib/auth/session';
import { loadNoticeState } from '@/lib/notices/load';
import { visibleReleases } from '@/lib/notices/releaseNotes';
import { createClient } from '@/lib/supabase/server';

import { markNoticesSeen } from './actions';

/**
 * หน้า "มีอะไรใหม่" (docs/DESIGN-whats-new.md).
 *
 * ไม่มีคีย์สิทธิ์รายเมนูของตัวเอง และไม่อยู่ในแถบเมนูซ้าย — ทุกคนที่ล็อกอินได้
 * ต้องอ่านข่าวที่เกี่ยวกับงานตัวเองได้ การกรองเกิดที่ตัวข่าวทีละเรื่อง ไม่ใช่
 * ที่ประตูหน้า `getSessionContext()` คือด่านตรวจสิทธิ์ของหน้านี้ตามปกติ
 *
 * แสดง "ทั้งหมด" ไม่ใช่ "เฉพาะที่ยังไม่ได้อ่าน" — คนที่กดไว้ก่อนไปเมื่อวาน
 * แล้วพรุ่งนี้นึกขึ้นได้ ต้องหาเจอ ส่วนจำนวนที่ยังไม่ได้อ่านส่งไปให้หน้าจอไว้
 * ตัดสินว่าต้องบันทึกว่าอ่านแล้วหรือเปล่าเท่านั้น
 */
export default async function WhatsNewPage() {
  const session = await getSessionContext();
  const supabase = await createClient();
  const state = await loadNoticeState(supabase, session.userId, session.hasNav);

  return (
    <WhatsNewView
      releases={visibleReleases(session.hasNav)}
      unread={state.unread}
      markSeenAction={markNoticesSeen}
    />
  );
}
