import { shopDayKey } from '@/lib/domain/format';

/**
 * วันรับงาน/ส่งงานของแต่ละบรรทัด — กฎกลางที่ฟอร์มกับใบพิมพ์ใช้ร่วมกัน
 * (migration 0089, ร้านแจ้ง 7 พ.ย. 2569).
 *
 * ใบงานหนึ่งใบมีวันรับกับวันส่งคู่เดียว ซึ่งถูกตอนที่รถเข้ามาทำทุกอย่างรอบเดียว
 * แต่ของจริงมีกรณีที่ลูกค้ากลับมาซื้อเพิ่มทีหลัง แล้วรายการนั้นถูกเพิ่มลงในใบ
 * งานใบเดิม — ของสองชิ้นในใบเดียวกันจึงส่งมอบกันคนละวันได้
 *
 * ว่าง = ใช้วันของใบงาน ไม่ใช่ "ไม่มีวัน" งานที่ทำรอบเดียวซึ่งเป็นงานส่วนใหญ่
 * จึงไม่ต้องกรอกอะไรเพิ่ม และใบงานเก่าทุกใบอ่านได้เหมือนเดิมทุกประการ
 */

/** เท่าที่กฎนี้ต้องรู้จากหนึ่งบรรทัด. */
export type DatedItem = {
  receivedAt?: string;
  deliveredAt?: string;
};

/** วันของทั้งใบงาน ที่บรรทัดยืมไปใช้เมื่อไม่ได้กำหนดเอง. */
export type JobDates = {
  dropOff: Date | string | null | undefined;
  pickup: Date | string | null | undefined;
};

export type ItemDates = {
  /** `YYYY-MM-DD` — ว่างได้ ถ้าใบงานเองก็ยังไม่มีวัน. */
  received: string;
  delivered: string;
  /** บรรทัดนี้กำหนดวันของตัวเองไว้ไหม — ตัวที่บอกว่าควรขึ้นป้ายกำกับหรือเปล่า. */
  own: boolean;
};

const asDay = (v: Date | string | null | undefined): string => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  // The shop's day, not the process's: the server renders in UTC and the
  // browser in Bangkok, so local getters disagree for 17:00–24:00 UTC and the
  // page fails to hydrate.
  return Number.isNaN(d.getTime()) ? '' : shopDayKey(d);
};

/**
 * วันที่ใช้จริงของบรรทัดนี้.
 *
 * กำหนดเองข้างเดียวก็ได้ — ของที่สั่งพร้อมงานแรกแต่มาส่งทีหลัง มีวันรับเป็น
 * วันเดียวกับใบงานและมีวันส่งเป็นของตัวเอง การบังคับให้กรอกคู่จะทำให้คนต้อง
 * พิมพ์วันที่รู้อยู่แล้วซ้ำ หรือไม่ก็ปล่อยว่างทั้งคู่แล้วข้อมูลก็ผิด
 */
export function itemDates(item: DatedItem, job: JobDates): ItemDates {
  const own = !!(item.receivedAt || item.deliveredAt);
  return {
    received: item.receivedAt || asDay(job.dropOff),
    delivered: item.deliveredAt || asDay(job.pickup),
    own,
  };
}

/**
 * จัดบรรทัดเป็นกลุ่มตามวันส่งงาน เรียงตามวัน — ใช้โดยใบงานขายที่แยกตามวัน.
 *
 * แยกด้วย "วันส่งงาน" เพราะใบขายพูดถึงการส่งมอบ ไม่ใช่วันที่ตกลงกัน ของที่
 * ลูกค้ารับไปแล้วสองรอบคือสองใบในสายตาของคนที่ถือเอกสาร
 *
 * บรรทัดที่ไม่มีวันเลย (ใบงานที่ยังไม่ได้นัด) รวมกันเป็นกลุ่มคีย์ว่าง และอยู่
 * ท้ายสุด: มันไม่ได้อ้างว่าส่งวันไหน
 */
export function groupItemsByDeliveryDay<T extends DatedItem>(
  items: T[],
  job: JobDates,
): { day: string; received: string; items: T[] }[] {
  const byDay = new Map<string, { received: string; items: T[] }>();
  for (const it of items) {
    const d = itemDates(it, job);
    const bucket = byDay.get(d.delivered) ?? { received: d.received, items: [] };
    /*
      วันรับงานของกลุ่ม = วันแรกสุดในกลุ่ม.

      สองบรรทัดที่ส่งวันเดียวกันแต่รับคนละวัน หัวกลุ่มต้องบอกวันที่รถเข้ามา
      ครั้งแรก ไม่ใช่วันของบรรทัดที่บังเอิญถูกอ่านทีหลัง
    */
    if (d.received && (!bucket.received || d.received < bucket.received)) {
      bucket.received = d.received;
    }
    bucket.items.push(it);
    byDay.set(d.delivered, bucket);
  }
  return [...byDay.entries()]
    .map(([day, g]) => ({ day, received: g.received, items: g.items }))
    .sort((a, b) => (a.day || '9999-12-31').localeCompare(b.day || '9999-12-31'));
}
