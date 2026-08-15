import { describe, it, expect } from 'vitest';

import { deriveFilmType, findProductStock } from '@/components/tickets/serviceForm';

/**
 * ประเภทฟิล์ม / ความหนา / รหัสสี are one spec that lives on the PRODUCT. Getting
 * from a ticket line to that product is the whole join, and the line does not
 * hold the product name cleanly — which is what these pin down.
 */
describe('serviceForm', () => {
  it('reads ประเภทฟิล์ม off the product name', () => {
    expect(deriveFilmType('TPU กันรอยเกรดพรีเมียม')).toBe('TPU');
    expect(deriveFilmType('PET ใส')).toBe('PET');
    expect(deriveFilmType('ลำโพงคู่ JBL Stage')).toBe('');
  });

  describe('findProductStock', () => {
    const stock = [
      { name: 'TPU กันรอย' },
      { name: 'TPU กันรอยเกรดพรีเมียม' },
      { name: 'ลำโพงคู่ JBL Stage' },
    ];

    it('matches the product name exactly when the line carries it', () => {
      expect(findProductStock(stock, 'TPU กันรอย')?.name).toBe('TPU กันรอย');
    });

    it('finds the product inside a position-prefixed line', () => {
      // A ฟิล์มกันรอย line reads "เต็มคัน: <product>", so an exact match finds
      // nothing on exactly the lines that need the film spec.
      expect(findProductStock(stock, 'เต็มคัน: TPU กันรอยเกรดพรีเมียม')?.name).toBe(
        'TPU กันรอยเกรดพรีเมียม',
      );
    });

    it('prefers the longest product name that fits', () => {
      // "TPU กันรอย" is a substring of the premium one; the shorter must not win
      // or the sheet prints another film's ความหนา.
      expect(findProductStock(stock, 'ครึ่งคัน: TPU กันรอยเกรดพรีเมียม')?.name).toBe(
        'TPU กันรอยเกรดพรีเมียม',
      );
    });

    it('returns nothing rather than guessing', () => {
      expect(findProductStock(stock, '')).toBeNull();
      expect(findProductStock(stock, 'ฟิล์มที่ไม่มีในสต็อก')).toBeNull();
    });
  });
});
