import { describe, it, expect } from 'vitest';

import { findProductStock } from '@/components/tickets/serviceForm';

/**
 * The ใบเซอร์วิส prints the ชื่อสินค้า of the film that was fitted. Getting from a
 * ticket line to that product is the whole join, and the line does not hold the
 * product name cleanly — which is what these pin down.
 */
describe('serviceForm', () => {
  describe('findProductStock', () => {
    const stock = [
      { name: 'TPU กันรอย' },
      { name: 'TPU กันรอยเกรดพรีเมียม 195' },
      { name: 'ลำโพงคู่ JBL Stage' },
    ];

    it('matches the product name exactly when the line carries it', () => {
      expect(findProductStock(stock, 'TPU กันรอย')?.name).toBe('TPU กันรอย');
    });

    it('finds the product inside a position-prefixed line', () => {
      // A ฟิล์มกันรอย line reads "เต็มคัน: <product>", so an exact match finds
      // nothing on exactly the lines the ใบเซอร์วิส is about.
      expect(findProductStock(stock, 'เต็มคัน: TPU กันรอยเกรดพรีเมียม 195')?.name).toBe(
        'TPU กันรอยเกรดพรีเมียม 195',
      );
    });

    it('prefers the longest product name that fits', () => {
      // "TPU กันรอย" is a substring of the premium one; the shorter must not win
      // or the sheet names the wrong film.
      expect(findProductStock(stock, 'ครึ่งคัน: TPU กันรอยเกรดพรีเมียม 195')?.name).toBe(
        'TPU กันรอยเกรดพรีเมียม 195',
      );
    });

    it('returns nothing rather than guessing', () => {
      expect(findProductStock(stock, '')).toBeNull();
      expect(findProductStock(stock, 'ฟิล์มที่ไม่มีในสต็อก')).toBeNull();
    });
  });
});
