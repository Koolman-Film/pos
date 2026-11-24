import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/stock',
  useSearchParams: () => new URLSearchParams(''),
}));

import { StockModule, type StockItem } from '@/components/stock/StockModule';

/**
 * ช่องเลือกสินค้าของ รับเข้า / ปรับสต็อก / เบิกใช้ พิมพ์ค้นหาได้ (ร้านขอ 17 พ.ย. 2569).
 *
 * ร้านมีสินค้าหลายร้อยตัว และชื่อขึ้นต้นเหมือนกันเป็นพรวน — "Alpha Finnix
 * กล้องบันทึกหน้า-หลัง F1", "… F1 4K", "… F2", "… F2 2K" เรียงติดกัน ดรอปดาวน์
 * ธรรมดาตอบได้แค่ "เลื่อนหาเอา" และการปรับสต็อกผิดตัว กลายเป็นของขาดอีกตัวที่
 * ไม่มีใครรู้ว่าหายไปตอนไหน
 */
const product = (id: number, name: string, shop: string): StockItem =>
  ({
    id,
    sku: `SKU-${id}`,
    name,
    shortName: name,
    category: 'กล้อง',
    shop,
    qty: 3,
    minQty: 1,
    cost: 1000,
    sellPrice: 2000,
  }) as unknown as StockItem;

const stock: StockItem[] = [
  product(1, 'Alpha Finnix กล้องบันทึกหน้า-หลัง F1', 'cm'),
  product(2, 'Alpha Finnix กล้องบันทึกหน้า-หลัง F1 4K', 'lp'),
  product(3, 'Alpha Finnix กล้องบันทึกหน้า-หลัง F2 2K', 'cm'),
  product(4, 'ฟิล์ม 3M CRM 60%', 'lp'),
];

const shops = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'lp', name: 'FINNIX FILM ลำพูน' },
];

/*
  ขอบเขตต้องเป็นกล่องที่กางอยู่ ไม่ใช่ทั้งหน้า — <option> ของ <select> ปกติที่
  อยู่บนการ์ดอื่นของหน้าเดียวกัน ก็นับเป็น role="option" เหมือนกัน
*/
const shownOptions = () =>
  within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');

const open = async (panel: string) => {
  const user = userEvent.setup();
  render(
    <StockModule stock={stock} accessibleShops={shops} canDo={() => true} canSeeStockPrices />,
  );
  await user.click(screen.getByRole('button', { name: new RegExp(panel) }));
  return user;
};

describe('เลือกสินค้าด้วยการพิมพ์', () => {
  it('ปรับสต็อก — พิมพ์แล้วเหลือเฉพาะที่ตรง', async () => {
    const user = await open('ปรับสต็อก');
    const box = screen.getByLabelText('สินค้าที่ต้องการปรับสต็อก');
    await user.type(box, 'F2');

    const shown = shownOptions();
    expect(shown.some((t) => t.includes('F2 2K'))).toBe(true);
    expect(shown.some((t) => t.includes('ฟิล์ม 3M CRM 60%'))).toBe(false);
  });

  it('ปรับสต็อก — เลือกแล้วช่อง “ในระบบ” ตามไปด้วย', async () => {
    /*
      ตัวเลขที่อยู่ข้าง ๆ ต้องเป็นของสินค้าที่เพิ่งเลือก ไม่ใช่ของตัวก่อนหน้า
      — ถ้ามันไม่ตาม คนจะกรอก "นับได้จริง" เทียบกับตัวเลขของสินค้าคนละตัว
    */
    const user = await open('ปรับสต็อก');
    await user.type(screen.getByLabelText('สินค้าที่ต้องการปรับสต็อก'), 'CRM 60');
    await user.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: /ฟิล์ม 3M CRM 60%/ }),
    );

    expect(screen.getByLabelText('สินค้าที่ต้องการปรับสต็อก')).toHaveValue('ฟิล์ม 3M CRM 60%');
  });

  it('ค้นด้วยชื่อสาขาได้ เพราะสินค้าชื่อเดียวกันมีอยู่ทุกสาขา', async () => {
    const user = await open('ปรับสต็อก');
    await user.type(screen.getByLabelText('สินค้าที่ต้องการปรับสต็อก'), 'ลำพูน');

    const shown = shownOptions();
    expect(shown).toHaveLength(2);
    expect(shown.every((t) => t.includes('ลำพูน'))).toBe(true);
  });

  it('เบิกใช้ภายใน ก็พิมพ์ค้นหาได้เหมือนกัน', async () => {
    // รายการเดียวกัน ปัญหาเดียวกัน — แก้ที่เดียวแล้วปล่อยอีกที่ไว้ ไม่ใช่คำตอบ
    const user = await open('เบิกใช้ภายใน');
    await user.type(screen.getByLabelText('สินค้าที่ต้องการเบิก'), 'F1 4K');

    expect(shownOptions()).toHaveLength(1);
  });

  it('รับสินค้าเข้า — ช่องเลือกของที่มีอยู่แล้ว ก็พิมพ์ค้นหาได้', async () => {
    const user = await open('เพิ่มสินค้า');
    await user.type(screen.getByLabelText('สินค้าของรายการที่ 1'), 'CRM');

    expect(shownOptions()).toHaveLength(1);
  });

  it('พิมพ์แล้วไม่เจอ บอกว่าไม่เจอ ไม่ใช่กล่องเปล่า', async () => {
    const user = await open('ปรับสต็อก');
    await user.type(screen.getByLabelText('สินค้าที่ต้องการปรับสต็อก'), 'ไม่มีของชิ้นนี้');

    expect(screen.getByText('ไม่พบรายการที่ค้นหา')).toBeInTheDocument();
  });
});
