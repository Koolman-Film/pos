/**
 * แคปหน้าจอของรายงาน เป็นรูปที่หน้าตาเหมือนที่เห็นบนจอทุกอย่าง.
 *
 * ร้านบอกว่า PDF แบบตารางเปล่าที่ระบบทำให้ "ดูยากกว่าที่เห็นบนหน้าจอ" (ร้านขอ
 * 2 ต.ค. 2569) ซึ่งตรงไปตรงมา: หน้าจอมีการ์ด มีสี มีไอคอนที่บอกว่าตัวเลขไหน
 * เป็นเงินเข้าเงินออก ส่วนใบที่พิมพ์ออกมาเป็นตารางขาวดำที่ต้องอ่านหัวคอลัมน์ก่อน
 * ถึงจะรู้ว่ากำลังดูอะไร
 *
 * `html-to-image` วาดผ่าน `<foreignObject>` ของ SVG ซึ่งแปลว่าเบราว์เซอร์ตัว
 * เดิมเป็นคนจัดหน้าให้ — รูปที่ได้จึงเหมือนบนจอจริง ไม่ใช่การจำลองการจัดหน้า
 * ขึ้นมาใหม่ (ซึ่งเป็นวิธีของ html2canvas และเป็นเหตุผลที่ไม่ได้เลือกตัวนั้น)
 */

/** สิ่งที่ไม่ควรติดไปในรูป — ปุ่มที่กดแล้วไม่มีความหมายในภาพนิ่ง. */
const HIDE_IN_CAPTURE = 'data-capture-hide';

export type CaptureResult = { dataUrl: string; width: number; height: number };

/**
 * วาด element เป็น PNG.
 *
 * `pixelRatio` 2 เพราะรูปนี้ถูกส่งต่อใน LINE และเปิดบนมือถือ — ขนาดเท่าจอจริง
 * จะอ่านตัวเลขไม่ออกเมื่อซูม
 *
 * พื้นหลังถูกกำหนดให้ทึบเสมอ: ถ้าปล่อยโปร่งใส รูปที่ส่งเข้าแชตจะกลายเป็นตัวหนังสือ
 * ลอยบนพื้นของแอปแชต ซึ่งอ่านไม่ออกเมื่ออีกฝั่งใช้ธีมตรงข้าม
 */
export async function captureElement(
  node: HTMLElement,
  options: { background: string; pixelRatio?: number } = { background: '#ffffff' },
): Promise<CaptureResult> {
  const { toPng } = await import('html-to-image');
  const dataUrl = await toPng(node, {
    backgroundColor: options.background,
    pixelRatio: options.pixelRatio ?? 2,
    // กรองทีละโหนด: ปุ่มและตัวควบคุมไม่ได้เป็นส่วนหนึ่งของรายงาน
    filter: (el) =>
      !(el instanceof HTMLElement) || el.getAttribute(HIDE_IN_CAPTURE) === null,
  });
  return { dataUrl, width: node.scrollWidth, height: node.scrollHeight };
}

/** ชวนเบราว์เซอร์ให้เซฟไฟล์ — ไม่มี API อื่นที่ทำได้โดยไม่ต้องให้คนคลิกซ้ำ. */
export function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * ชื่อไฟล์ที่เรียงตัวเองได้ในโฟลเดอร์.
 *
 * วันที่นำหน้าเสมอ เพราะคนเปิดโฟลเดอร์นี้กำลังหารายงานของวันใดวันหนึ่ง ไม่ได้หา
 * "รายงานของสาขาไหน" — และชื่อสาขาที่ขึ้นก่อนจะทำให้วันที่กระจายอยู่คนละกอง
 */
export function reportFileName(day: string, scope: string, ext: string) {
  const safe = scope.replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${day}-${safe}.${ext}`;
}
