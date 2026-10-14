import { itemNetPrice } from './tickets';

/**
 * ส่วนแบ่งรายได้ Finnix ของแต่ละรายการสินค้า (migration 0084).
 *
 * 0031 วางธง รายได้/รับแทน ไว้ที่ใบงาน 0068 ย้ายลงมาที่รายการ และ 0084 เปลี่ยน
 * จากธงเป็นจำนวนเงิน เพราะบรรทัดเดียวก็แบ่งกันได้ — ลำโพง 4,500 ที่ 1,500 เป็น
 * ของ Finnix (ร้านขอ 14 ต.ค. 2569)
 *
 * กติกาอยู่ที่เดียว เพราะถูกถามจากสี่ที่ที่ไม่เคยเห็นกัน: ฟอร์มใบงาน · รายงาน
 * รายได้ · การแบ่งเงินที่รับมาบนแดชบอร์ด · และยอดค้างคืน Finnix ถ้าสี่ที่นี้
 * ตอบไม่ตรงกัน ไม่มีตัวเลขไหนในหน้าจอที่เชื่อได้เลย
 */

export type ItemShare = {
  soldPrice: number | string;
  discountType?: 'percent' | 'amount' | null;
  discountValue?: number | string | null;
  /** บาทที่เป็นของ Finnix — undefined บนข้อมูลที่โหลดจากรุ่นก่อน 0084 */
  finnixAmount?: number | string;
  /** ธงเดิม ใช้เป็นคำตอบสำรองเมื่อยังไม่มีตัวเลข */
  revenueKind?: string;
};

function net(i: ItemShare): number {
  return itemNetPrice({
    soldPrice: Number(i.soldPrice || 0),
    discountType: i.discountType ?? undefined,
    discountValue:
      i.discountValue != null && i.discountValue !== '' ? Number(i.discountValue) : undefined,
  });
}

/**
 * ยอดสุทธิของบรรทัด — ราคาขายหักส่วนลดของบรรทัดนั้น.
 *
 * เปิดออกมาด้วย เพราะทุกที่ที่ถามเรื่องส่วนแบ่งก็ต้องรู้ "ทั้งหมดเท่าไหร่" ใน
 * บรรทัดเดียวกัน และการให้แต่ละที่คิดเองคือการเปิดโอกาสให้คิดคนละแบบ
 */
export function itemTotal(i: ItemShare): number {
  return net(i);
}

/**
 * บาทของบรรทัดนี้ที่เป็นของ Finnix.
 *
 * หนีบไว้ที่ [0, ยอดสุทธิ] เสมอ — ยอด Finnix ที่มากกว่าที่ขายได้ไม่ใช่ข้อมูล
 * มันคือการพิมพ์ผิด และถ้าปล่อยผ่าน รายได้สาขาจะกลายเป็นติดลบ (ฐานข้อมูลก็
 * หนีบไว้เหมือนกัน แต่หน้าจอต้องแสดงผลก่อนที่จะมีการบันทึก)
 *
 * ข้อมูลที่โหลดมาก่อน 0084 ไม่มีตัวเลข จึงอ่านจากธงเดิม: รับแทน = ทั้งบรรทัด
 */
export function finnixShare(i: ItemShare): number {
  const total = net(i);
  if (i.finnixAmount == null || i.finnixAmount === '') {
    return i.revenueKind === 'รับแทน' ? total : 0;
  }
  return Math.min(Math.max(Number(i.finnixAmount) || 0, 0), total);
}

/** บาทของบรรทัดนี้ที่เป็นของสาขา — ส่วนที่เหลือจากของ Finnix. */
export function branchShare(i: ItemShare): number {
  return net(i) - finnixShare(i);
}

/** บรรทัดนี้แบ่งกันอยู่ไหม — ไม่ใช่ของสาขาทั้งหมด และไม่ใช่ของ Finnix ทั้งหมด. */
export function isSplit(i: ItemShare): boolean {
  const f = finnixShare(i);
  return f > 0.005 && f < net(i) - 0.005;
}

/** รวมส่วนของ Finnix ทั้งใบงาน. */
export function ticketFinnixTotal(items: readonly ItemShare[]): number {
  return round2(items.reduce((s, i) => s + finnixShare(i), 0));
}

/**
 * ยอดที่ยังต้องคืน Finnix = ขายเป็นของ Finnix − เงินที่เข้าบัญชีของ Finnix แล้ว.
 *
 * "รายได้ finnix 5,000 · เข้าบัญชีที่ผูกกับ finnix แล้ว 2,000 · เหลือคืน 3,000"
 * (ร้านอธิบาย 14 ต.ค. 2569)
 *
 * ไม่มีช่องให้กรอกว่าเงินก้อนไหนเป็นของใคร เพราะลูกค้าจ่ายเป็นก้อนเดียวโดยไม่
 * ได้ระบุว่าจ่ายค่าอะไร — สิ่งที่ตอบได้จริงคือเทียบสองยอดนี้ ส่วนเงินที่เข้า
 * บัญชี Finnix รู้ได้จากเจ้าของบัญชีที่รับเงิน (0069) ไม่ต้องถามใครซ้ำ
 *
 * ติดลบได้ และไม่ถูกปัดเป็นศูนย์: เข้าบัญชี Finnix มากกว่าที่ขายเป็นของเขา
 * แปลว่ามีอะไรผิด และการซ่อนไว้ไม่ได้ทำให้มันถูกขึ้น
 */
export function finnixDue(soldForFinnix: number, paidIntoFinnix: number): number {
  return round2(soldForFinnix - paidIntoFinnix);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
