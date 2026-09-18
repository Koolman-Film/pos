import { describe, it, expect } from 'vitest';

import { groupDocLines } from '@/components/tickets/docLines';

/** เอกสารการเงิน: หนึ่งแถวต่อหนึ่งชนิดสินค้า พร้อมยอดรวมของชนิดนั้น. */

const film = { category: 'ฟิล์มกรองแสง', product: 'ฟิล์ม FINNIX CT 40%', detail: 'บานหน้า', amount: 1300 };
const film2 = {
  category: 'ฟิล์มกรองแสง',
  product: 'ฟิล์ม 3M CRM 60%',
  detail: 'คู่หน้า, คู่หลัง',
  amount: 2900,
};
const wrap = { category: 'ฟิล์มกันรอย', product: 'TPU กันรอยเกรดพรีเมียม', detail: 'เต็มคัน', amount: 2200 };

describe('groupDocLines', () => {
  it('adds up one ชนิดสินค้า into a single row', () => {
    const [films, wraps] = groupDocLines([film, film2, wrap]);
    expect(films).toEqual({
      category: 'ฟิล์มกรองแสง',
      amount: 4200,
      products: [
        { product: 'ฟิล์ม FINNIX CT 40%', detail: 'บานหน้า' },
        { product: 'ฟิล์ม 3M CRM 60%', detail: 'คู่หน้า, คู่หลัง' },
      ],
    });
    expect(wraps).toMatchObject({ category: 'ฟิล์มกันรอย', amount: 2200 });
  });

  it('keeps the order the ticket listed the categories in', () => {
    expect(groupDocLines([wrap, film]).map((g) => g.category)).toEqual([
      'ฟิล์มกันรอย',
      'ฟิล์มกรองแสง',
    ]);
  });

  it('adds to the same total as the lines it grouped', () => {
    const groups = groupDocLines([film, film2, wrap]);
    expect(groups.reduce((n, g) => n + g.amount, 0)).toBe(1300 + 2900 + 2200);
  });

  it('lists a product once per set of positions', () => {
    const groups = groupDocLines([film, { ...film }, { ...film, detail: 'บานหลัง' }]);
    expect(groups[0].products).toEqual([
      { product: 'ฟิล์ม FINNIX CT 40%', detail: 'บานหน้า' },
      { product: 'ฟิล์ม FINNIX CT 40%', detail: 'บานหลัง' },
    ]);
    expect(groups[0].amount).toBe(3900);
  });

  it('still counts a line with no product name', () => {
    const groups = groupDocLines([{ category: 'งานบริการ', product: '', detail: '', amount: 500 }]);
    expect(groups).toEqual([{ category: 'งานบริการ', products: [], amount: 500 }]);
  });
});
