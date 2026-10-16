/**
 * วันที่รับงาน / วันที่ส่งงาน ต้องเรียงถูกทาง (ร้านขอ 15 ต.ค. 2569).
 *
 * "วันที่ส่งงานจะเป็นวันที่ก่อนรับงานไม่ได้ ต้องเป็นวันเดียวกันหรือหลังวันที่
 * รับงานเท่านั้น เวลาก็เช่นกันหากเป็นวันเดียวกัน เวลาส่งงานต้องหลังจากเวลา
 * รับงานเท่านั้น"
 *
 * ทั้งสองช่องเก็บวันและเวลาไว้ในค่าเดียว การเทียบตรง ๆ จึงครอบกฎทั้งสองข้อโดย
 * ไม่ต้องแยกเงื่อนไข
 *
 * กติกาเดียวกันนี้ถูกบังคับที่ฐานข้อมูลด้วย (migration 0085) — ที่นี่มีไว้เพื่อ
 * บอกคนกรอกตั้งแต่ก่อนกดบันทึก ไม่ใช่เพื่อเป็นด่าน ด่านอยู่ที่ฐานข้อมูลเสมอ
 * เพราะหน้าจอไม่ใช่สิ่งเดียวที่เขียนข้อมูลได้
 */

/** ข้อความเดียวกับที่ฐานข้อมูลตอบกลับ จะได้ไม่มีสองคำอธิบายสำหรับกฎข้อเดียว. */
export const PICKUP_ORDER_ERROR =
  'วันที่ส่งงานต้องอยู่หลังวันที่รับงาน — ถ้าเป็นวันเดียวกัน เวลาส่งงานต้องหลังเวลารับงาน';

function usable(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * ส่งงานอยู่ก่อนหรือพร้อมกับรับงานไหม — true คือผิดกติกา.
 *
 * ขาดวันใดวันหนึ่งไปถือว่ายังตัดสินไม่ได้ ไม่ใช่ว่าผิด: ใบที่ยังกรอกไม่เสร็จ
 * ไม่ควรขึ้นคำเตือนที่คนยังตอบไม่ได้
 */
export function pickupBeforeDropOff(
  dropOff: Date | null | undefined,
  pickup: Date | null | undefined,
): boolean {
  if (!usable(dropOff) || !usable(pickup)) return false;
  return pickup.getTime() <= dropOff.getTime();
}

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!usable(a) || !usable(b)) return !usable(a) && !usable(b);
  return a.getTime() === b.getTime();
}

/**
 * ปุ่มบันทึกต้องหยุดไหม — กลับหัว **และ** เป็นใบใหม่หรือมีคนแก้วันที่.
 *
 * ใบที่วันที่ผิดมาตั้งแต่ก่อนมีกติกา (0085) ยังต้องรับเงินและแก้อย่างอื่นได้
 * ไม่ใช่ล็อกตายจนกว่าจะมีคนรู้วันจริง (0086). ส่วนคำเตือนข้างช่องยังขึ้นเสมอ
 * เพื่อให้คนที่เปิดมาเห็นและแก้ได้ถ้ารู้
 *
 * @param stored วันที่ตามที่อยู่ในฐานข้อมูลตอนเปิดใบ — null สำหรับใบใหม่
 */
export function datesBlockSave(
  stored: { dropOff: Date | null | undefined; pickup: Date | null | undefined } | null,
  dropOff: Date | null | undefined,
  pickup: Date | null | undefined,
): boolean {
  if (!pickupBeforeDropOff(dropOff, pickup)) return false;
  if (!stored) return true;
  return !sameInstant(stored.dropOff, dropOff) || !sameInstant(stored.pickup, pickup);
}
