/**
 * The fixed lists on the shop's paper ใบเซอร์วิส ลูกค้าหน้าร้าน.
 *
 * Kept in code, like QC_CHECKLIST_SECTIONS and WRAP_OPTIONS: these are the boxes
 * the printed form has always carried, not a value list a branch invents entries
 * in. One definition so the screen a technician ticks and the sheet that comes
 * out of the printer cannot drift apart.
 */

/** ภายในรถ — in the order the paper form lists them. */
export const SERVICE_INTERIOR_PARTS = [
  'หน้าจอ 1',
  'หน้าจอ 2',
  'หน้าปัดรถ',
  'กาบประตู หน้า-ซ้าย',
  'กาบประตู หลัง-ซ้าย',
  'กาบประตู หน้า-ขวา',
  'กาบประตู หลัง-ขวา',
  'Piano Black',
  'ที่เก็บของด้านหลัง',
] as const;

/** ภายนอกรถ. */
export const SERVICE_EXTERIOR_PARTS = ['นิรภัยหน้า', 'Sunroof', 'สปอยเลอร์หลัง'] as const;

/** ประเภทฟิล์ม. */
export const SERVICE_FILM_TYPES = ['TPU', 'PET'] as const;

/** ความหนา. The form prints these five as column headings. */
export const SERVICE_FILM_THICKNESS = ['165', '195', '195ด้าน', '215', '255'] as const;

/** จุดพิเศษลูกค้าต้องการแก้ไข — the form has exactly ten numbered rows. */
export const SERVICE_POINT_ROWS = 10;

/**
 * ประเภทฟิล์ม read off the ฟิล์มกันรอย product the ticket sold.
 *
 * The product name is the only place the ticket records this — "TPU
 * กันรอยเกรดพรีเมียม" is a TPU job — so the service sheet derives it rather than
 * asking again. ความหนา and รหัสสี come off the same product's stock record
 * (`stock.film_thickness` / `stock.film_colour_code`): one spec, entered once
 * when the product is set up, inherited by every ticket and every visit.
 */
export function deriveFilmType(productName: string): string {
  const name = (productName || '').toUpperCase();
  for (const type of SERVICE_FILM_TYPES) if (name.includes(type)) return type;
  return '';
}

/**
 * The stock row behind an item's `sold` label.
 *
 * `sold` is not always the product name: a ฟิล์มกันรอย line reads
 * "เต็มคัน: TPU กันรอยเกรดพรีเมียม" — position first, product after. An exact
 * match therefore finds nothing on exactly the lines that need the film spec, so
 * fall back to the longest product name contained in the label (longest, so
 * "TPU กันรอย" never wins over "TPU กันรอยเกรดพรีเมียม").
 */
export function findProductStock<T extends { name: string }>(
  stock: readonly T[],
  sold: string,
): T | null {
  if (!sold) return null;
  const exact = stock.find((s) => s.name === sold);
  if (exact) return exact;
  let best: T | null = null;
  for (const s of stock) {
    if (!s.name || !sold.includes(s.name)) continue;
    if (!best || s.name.length > best.name.length) best = s;
  }
  return best;
}
