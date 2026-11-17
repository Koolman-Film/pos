import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/stock',
  useSearchParams: () => new URLSearchParams(''),
}));

import { StockModule, type StockItem, type StockMovement } from '@/components/stock/StockModule';
import { parseLedgerFilter } from '@/components/stock/ledgerFilter';

/**
 * ตัวกรองของประวัติสต็อก (ร้านขอ 17 พ.ย. 2569).
 *
 * หน้านี้เคยมีตัวกรองเดียว คือประเภทการเคลื่อนไหว และมันกรองอยู่บนแถวที่โหลด
 * มาแล้วเท่านั้น คำถามของคนที่มาตรวจสอบ — "ฟิล์มตัวนี้ที่ลำพูน เดือนที่แล้ว
 * หายไปไหน" — จึงตอบด้วยการเลื่อนหาเอาทีละหน้า
 *
 * สิ่งที่ปักไว้ที่นี่คือ: ค่าที่เลือกไปอยู่ใน URL ไม่ใช่ใน state ของหน้าจอ
 * เพราะ URL คือที่ที่หน้าเซิร์ฟเวอร์อ่านเพื่อถามฐานข้อมูล ถ้าตัวกรองเก็บไว้
 * เองในหน้าจอ มันจะกรองได้แค่กองที่หน้าจอบังเอิญถืออยู่
 */
const stock: StockItem[] = [
  {
    id: 1,
    sku: 'SKU-FLM-3M60',
    name: 'ฟิล์ม 3M CRM 60%',
    shortName: '3M60',
    category: 'ฟิล์มกรองแสง',
    shop: 'cm',
    qty: 200,
    minQty: 10,
    cost: 850,
    sellPrice: 1700,
  } as unknown as StockItem,
  {
    id: 2,
    sku: 'SKU-TPU-PR',
    name: 'TPU กันรอยเกรดพรีเมียม',
    shortName: 'TPU-PR',
    category: 'ฟิล์มกันรอย',
    shop: 'lp',
    qty: 22,
    minQty: 2,
    cost: 900,
    sellPrice: 1800,
  } as unknown as StockItem,
];

const movement = (over: Partial<StockMovement> = {}): StockMovement => ({
  id: 1,
  itemName: 'ฟิล์ม 3M CRM 60%',
  shop: 'cm',
  kind: 'ใบงาน',
  documentId: 'JT-CM-00901',
  change: -12.5,
  qtyBefore: 200,
  qtyAfter: 187.5,
  costTotal: 1200,
  note: '',
  movedAt: '2026-11-16T03:00:00Z',
  movedBy: 'แอดมินระบบ',
  ...over,
});

const shops = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'lp', name: 'FINNIX FILM ลำพูน' },
];

const renderLedger = (
  movements: StockMovement[],
  params: Record<string, string> = {},
  extra: { ledgerCapped?: boolean } = {},
) => {
  render(
    <StockModule
      stock={stock}
      canSeeStockPrices
      accessibleShops={shops}
      productCategories={['ฟิล์มกรองแสง', 'ฟิล์มกันรอย', 'เครื่องเสียง']}
      movements={movements}
      ledgerFilter={parseLedgerFilter(params)}
      {...extra}
    />,
  );
  return userEvent.setup();
};

/** การ์ดประวัติสต็อก — หาเจอจากตัวกรองของมันเอง. */
const card = () => screen.getByLabelText('กรองประวัติสต็อกตามสาขา').closest('.card') as HTMLElement;

const openLedger = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'ประวัติสต็อก' }));

beforeEach(() => push.mockClear());

describe('ประวัติสต็อก — ตัวกรอง', () => {
  it('ลิงก์ที่มีตัวกรองติดมา เปิดมาที่ประวัติสต็อกเลย', () => {
    // ตัวกรองอยู่ใน URL เพื่อให้ส่งให้คนอื่นดูได้ ลิงก์ที่เปิดมาแล้วเจอหน้าอื่น
    // คือลิงก์ที่ไม่ได้ทำสิ่งที่มันสัญญาไว้
    renderLedger([movement()], { lshop: 'cm' });
    expect(within(card()).getByText('ประวัติการเคลื่อนไหวสต็อก')).toBeInTheDocument();
  });

  it('ติ๊กสาขา แล้วรหัสสาขาไปอยู่ใน URL ไม่ใช่ชื่อสาขา', async () => {
    /*
      ชื่อสาขาแก้ได้ตลอดจากหน้าจัดการ ลิงก์ที่เก็บชื่อไว้จะกรองไม่เจออะไรเลย
      วันที่ร้านเปลี่ยนชื่อสาขา
    */
    const user = renderLedger([movement()]);
    await openLedger(user);
    await user.click(screen.getByLabelText('กรองประวัติสต็อกตามสาขา'));
    await user.click(screen.getByLabelText('FINNIX FILM ลำพูน'));

    expect(push).toHaveBeenCalledWith('/stock?lshop=lp', { scroll: false });
  });

  it('เลือกหลายค่าได้ในตัวกรองเดียว', async () => {
    const user = renderLedger([movement()], { lkind: 'ปรับสต็อก' });
    await user.click(screen.getByLabelText('กรองประวัติสต็อกตามประเภทการเคลื่อนไหว'));
    await user.click(screen.getByLabelText('รับเข้า'));

    expect(push).toHaveBeenCalledWith(
      '/stock?lkind=%E0%B8%9B%E0%B8%A3%E0%B8%B1%E0%B8%9A%E0%B8%AA%E0%B8%95%E0%B9%87%E0%B8%AD%E0%B8%81%7E%E0%B8%A3%E0%B8%B1%E0%B8%9A%E0%B9%80%E0%B8%82%E0%B9%89%E0%B8%B2',
      {
        scroll: false,
      },
    );
  });

  it('ประเภทที่เลือกได้ มีครบ แม้ตารางจะเหลือประเภทเดียว', async () => {
    /*
      ถ้าอ่านตัวเลือกจากแถวที่เห็นอยู่ พอกรองเหลือประเภทเดียวแล้ว จะไม่มีทาง
      เปลี่ยนไปดูประเภทอื่นได้เลยโดยไม่ล้างตัวกรองก่อน
    */
    const user = renderLedger([movement({ kind: 'ปรับสต็อก' })], { lkind: 'ปรับสต็อก' });
    await user.click(screen.getByLabelText('กรองประวัติสต็อกตามประเภทการเคลื่อนไหว'));

    for (const kind of ['ใบงาน', 'ขายส่ง', 'เบิกใช้', 'รับเข้า', 'โอนออก', 'โอนเข้า']) {
      expect(screen.getByLabelText(kind)).toBeInTheDocument();
    }
  });

  it('ล้างตัวกรองทั้งหมด ลบทุกพารามิเตอร์ของสมุดนี้ ไม่ใช่แค่ที่เห็น', async () => {
    const user = renderLedger([movement()], {
      lshop: 'cm',
      lcat: 'ฟิล์มกรองแสง',
      lfrom: '2026-11-01',
    });
    await user.click(screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }));

    expect(push).toHaveBeenCalledWith('/stock?', { scroll: false });
  });

  it('ยังไม่ได้กรอง ก็ไม่มีปุ่มล้างให้กดเล่น', async () => {
    const user = renderLedger([movement()]);
    await openLedger(user);
    expect(screen.queryByRole('button', { name: 'ล้างตัวกรองทั้งหมด' })).not.toBeInTheDocument();
  });
});

describe('ประวัติสต็อก — ตารางบอกความจริงเรื่องขอบเขต', () => {
  it('กองล่าสุดที่ถูกตัด บอกว่ายังมีของเก่ากว่านี้', async () => {
    /*
      สมุดบัญชีไม่มีวันเล็กลง หน้าที่เปิดมาเฉย ๆ จึงอ่านแค่ของล่าสุด — ถ้าไม่
      บอก คนจะอ่านว่าเท่านี้คือทั้งหมดที่เคยเกิดขึ้น
    */
    await openLedger(renderLedger([movement()], {}, { ledgerCapped: true }));
    expect(
      within(card()).getByText(/เลือกช่วงเวลาหรือสินค้า เพื่อค้นย้อนหลังทั้งหมด/),
    ).toBeInTheDocument();
  });

  it('กรองแล้ว บอกว่าค้นจากทั้งสมุด', () => {
    renderLedger([movement()], { lshop: 'cm' });
    expect(within(card()).getByText(/ค้นจากทั้งสมุด/)).toBeInTheDocument();
  });

  it('ไม่เจออะไร บอกว่าเป็นเพราะตัวกรอง ไม่ใช่เพราะไม่มีประวัติ', () => {
    renderLedger([], { lshop: 'cm' });
    expect(within(card()).getByText('ไม่มีรายการที่ตรงกับตัวกรองนี้')).toBeInTheDocument();
  });

  it('ยังไม่ได้กรองและไม่มีอะไรเลย ก็พูดอีกอย่าง', async () => {
    const user = renderLedger([]);
    await openLedger(user);
    expect(screen.getByText('ยังไม่มีประวัติสต็อก')).toBeInTheDocument();
  });

  it('หลายสาขาปนกัน แถวต้องบอกว่าของตัวเองมาจากสาขาไหน', async () => {
    await openLedger(renderLedger([movement(), movement({ id: 2, shop: 'lp' })]));
    const head = within(card())
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(head).toContain('สาขา');
    expect(within(card()).getByText('FINNIX FILM ลำพูน')).toBeInTheDocument();
  });

  it('สาขาเดียว ไม่ต้องมีคอลัมน์ที่ทุกแถวเขียนเหมือนกัน', () => {
    renderLedger([movement(), movement({ id: 2 })], { lshop: 'cm' });
    const head = within(card())
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(head).not.toContain('สาขา');
  });
});
