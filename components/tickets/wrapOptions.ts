/**
 * The "Option / รายการแถม" row on the paper ฟิล์มกันรอย form.
 *
 * A fixed list, like QC_CHECKLIST_SECTIONS in PrintJobSheet: these are the six
 * boxes the shop's printed sheet has always carried, not a value list a branch
 * invents entries in. Keeping it in code means the ticked boxes on screen and
 * the boxes on the sheet cannot drift apart.
 *
 * The order is the paper form's own reading order — three columns, two rows —
 * so the printed sheet and the form on screen lay out identically.
 */
export const WRAP_OPTIONS: string[] = [
  'แถม หน้าจอ',
  'แถม กาบประตู',
  'แกะ โลโก้',
  'แถม ภายใน',
  'แกะ มือจับประตู',
  'แกะ ตัวอักษร',
];

/** The category these options belong to. */
export const WRAP_CATEGORY = 'ฟิล์มกันรอย';
