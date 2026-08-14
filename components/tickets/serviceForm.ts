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

/**
 * What a part can be marked as. The paper form leaves a blank cell, so a mark is
 * whatever the technician writes; these are the three answers that actually get
 * written, and an empty string keeps "ยังไม่ตรวจ" distinct from "ปกติ".
 */
export const SERVICE_CHECK_RESULTS = ['ปกติ', 'แก้ไขแล้ว', 'ผิดปกติ'] as const;

/** จุดพิเศษลูกค้าต้องการแก้ไข — the form has exactly ten numbered rows. */
export const SERVICE_POINT_ROWS = 10;
