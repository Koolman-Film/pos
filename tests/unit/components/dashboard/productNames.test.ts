import { describe, it, expect } from 'vitest';

import { productLabels } from '@/components/dashboard/productNames';

/**
 * การ์ดนัดหมายบนแดชบอร์ด — สินค้าที่ขายจริง ถ้ายังไม่มีให้ใช้สินค้าที่สนใจ
 * (ร้านขอ 18 ก.ย. 2569).
 */

describe('productLabels', () => {
  it('names what was sold, once the sale is made', () => {
    expect(productLabels([{ sold: 'ฟิล์ม 3M CRM 60%', interested: 'ฟิล์ม 3M CRM 40%' }])).toEqual([
      'ฟิล์ม 3M CRM 60%',
    ]);
  });

  it('falls back to สินค้าที่สนใจ while nothing has been sold, and marks it', () => {
    expect(productLabels([{ sold: '', interested: 'ฟิล์ม 3M CRM 60%' }])).toEqual([
      'ฟิล์ม 3M CRM 60% (สนใจ)',
    ]);
  });

  it('reads the old สินค้าที่จอง column the same way', () => {
    expect(productLabels([{ booked: 'ลำโพง JBL' }])).toEqual(['ลำโพง JBL (สนใจ)']);
  });

  it('prefers สินค้าที่สนใจ over the older booked column', () => {
    expect(productLabels([{ interested: 'ฟิล์มกันรอย TPU', booked: 'ของเก่า' }])).toEqual([
      'ฟิล์มกันรอย TPU (สนใจ)',
    ]);
  });

  it('says nothing for a line with no product at all', () => {
    expect(productLabels([{ sold: '', interested: '', booked: '' }, {}])).toEqual([]);
  });

  it('lists each product once, in the order the lines are in', () => {
    expect(
      productLabels([
        { sold: 'ฟิล์ม 3M CRM 60%' },
        { interested: 'ลำโพง JBL' },
        { sold: 'ฟิล์ม 3M CRM 60%' },
      ]),
    ).toEqual(['ฟิล์ม 3M CRM 60%', 'ลำโพง JBL (สนใจ)']);
  });
});
