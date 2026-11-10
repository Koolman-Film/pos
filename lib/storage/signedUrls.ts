'use client';

/**
 * ลิงก์ที่เซ็นแล้วของไฟล์แนบ — ขอครั้งเดียว ใช้ได้ทั้งตอนชี้ดูและตอนกดเปิดเต็มจอ.
 *
 * ทุก bucket เป็นแบบส่วนตัว ลิงก์จึงต้องถูกเซ็นทีละเส้นโดย Server Action และมี
 * อายุหนึ่งนาที เดิมลิงก์ถูกขอตอน "กด" เท่านั้นจึงไม่มีอะไรต้องจำ แต่พอการ์ด
 * ชี้ดู (AttachmentPeek) ขอลิงก์ด้วย ไฟล์เดียวกันจะถูกเซ็นสองรอบทุกครั้งที่คน
 * ชี้แล้วกด — รอบที่สองคือการรอเปล่า ๆ ทั้งที่เส้นแรกยังใช้ได้อยู่
 *
 * กุญแจเป็น path อย่างเดียวได้ เพราะทุก path มี uuid อยู่ข้างใน (ดู
 * `uploadAttachments`) ไฟล์จากคนละ bucket จึงชนกันไม่ได้
 *
 * เก็บไว้ที่ระดับโมดูล ไม่ใช่ใน state ของชิป เพราะรายการชิปถูกสร้างใหม่ทุกครั้ง
 * ที่ฟอร์มรีเรนเดอร์ แคชที่อยู่ในนั้นจะหายไปก่อนได้ใช้เสมอ
 */

export type UrlAction = (path: string) => Promise<{ url?: string; error?: string }>;

type Entry = { url: string; at: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<{ url?: string; error?: string }>>();

/**
 * สั้นกว่าอายุจริง (60 วิ) อยู่ 20 วิ — เส้นที่เหลืออีกอึดใจเดียวคือเส้นที่
 * ภาพโหลดไม่ทัน แล้วคนเห็นกรอบว่างแทนสลิป
 */
const TTL_MS = 40_000;

/** ลิงก์ที่ยังใช้ได้ ถ้ามี — ไม่ยิงขอใหม่ ใช้ตอนอยากรู้ว่าต้องรอไหม. */
export function cachedSignedUrl(path: string): string | null {
  const hit = cache.get(path);
  if (!hit) return null;
  if (Date.now() - hit.at < TTL_MS) return hit.url;
  cache.delete(path);
  return null;
}

/**
 * ลิงก์ของไฟล์นี้ — จากแคช จากคำขอที่กำลังวิ่งอยู่ หรือขอใหม่ ตามลำดับ.
 *
 * ไม่ throw: ผู้เรียกทุกรายแสดงข้อความผิดพลาดในที่ของตัวเองอยู่แล้ว และการ์ด
 * ชี้ดูที่ระเบิดออกมากลางการเลื่อนเมาส์คือสิ่งที่ไม่ควรมี
 */
export async function signedUrl(
  path: string,
  action: UrlAction,
): Promise<{ url?: string; error?: string }> {
  const hit = cachedSignedUrl(path);
  if (hit) return { url: hit };

  const running = inflight.get(path);
  if (running) return running;

  const pending = action(path)
    .then((res) => {
      if (res.url) cache.set(path, { url: res.url, at: Date.now() });
      return res;
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : 'เปิดไฟล์ไม่สำเร็จ' }))
    .finally(() => inflight.delete(path));

  inflight.set(path, pending);
  return pending;
}

/** สำหรับเทสต์เท่านั้น — แคชระดับโมดูลไม่หายไปเองระหว่างเคส. */
export function resetSignedUrlCache(): void {
  cache.clear();
  inflight.clear();
}
