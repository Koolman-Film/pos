import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/stock',
  useSearchParams: () => new URLSearchParams(''),
}));

import {
  ReceiveStockPanel,
  type ReceiveLineCall,
  type ReceiveResult,
} from '@/components/stock/ReceiveStockPanel';
import type { StockItem } from '@/components/stock/StockModule';

/** สัญญาเดียวกับที่แผงเรียกจริง — mock ที่ผูกกับมันจึงพังทันทีถ้าสัญญาเปลี่ยน. */
type ReceiveFn = (input: {
  supplier?: string;
  docNo?: string;
  reason?: string;
  lines: ReceiveLineCall[];
}) => Promise<ReceiveResult>;

/**
 * รับสินค้าเข้าสต็อก — หนึ่งใบส่งของ หลายรายการ (ร้านขอ 24 พ.ย. 2569).
 *
 * ของเดิมรับได้ทีละตัว คนจึงต้องกรอกชื่อผู้ขายกับเลขที่ใบส่งของซ้ำทุกรอบ
 * พิมพ์ผิดรอบเดียว ล็อตนั้นก็หลุดจากใบของมันไปเงียบ ๆ แล้วตอนไล่ย้อนว่าของ
 * ล็อตนี้มาจากใบไหน ก็หาไม่เจอ
 */
const product = (id: number, name: string, shop: string): StockItem =>
  ({
    id,
    sku: `SKU-${id}`,
    name,
    shortName: name,
    category: 'ฟิล์มกรองแสง',
    shop,
    qty: 10,
    minQty: 2,
    cost: 800,
    sellPrice: 1600,
  }) as unknown as StockItem;

const stock = [
  product(1, 'ฟิล์ม 3M CRM 60%', 'cm'),
  product(2, 'ฟิล์ม FINNIX CT 40%', 'cm'),
];
const shops = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'lp', name: 'FINNIX FILM ลำพูน' },
];

const renderPanel = (
  over: {
    receiveAction?: ReturnType<typeof vi.fn<ReceiveFn>>;
    onDone?: ReturnType<typeof vi.fn<() => void>>;
    suppliers?: string[];
    canSeePrices?: boolean;
  } = {},
) => {
  const receiveAction =
    over.receiveAction ?? vi.fn<ReceiveFn>(async () => ({ ok: true, received: 1 }));
  const onDone = over.onDone ?? vi.fn<() => void>();
  render(
    <ReceiveStockPanel
      stock={stock}
      categories={['ฟิล์มกรองแสง', 'เครื่องเสียง']}
      setCategories={vi.fn()}
      shops={shops}
      suppliers={over.suppliers ?? ['3M', 'FINNIX']}
      canSeePrices={over.canSeePrices ?? true}
      receiveAction={receiveAction}
      onDone={onDone}
    />,
  );
  return { user: userEvent.setup(), receiveAction, onDone };
};

const save = () => screen.getByRole('button', { name: /^บันทึกรับสินค้า/ });

describe('รับสินค้าเข้าสต็อก — หนึ่งใบ หลายรายการ', () => {
  it('ผู้ขายกับเลขที่ใบอยู่หัวฟอร์ม กรอกครั้งเดียวใช้กับทุกรายการ', async () => {
    /*
      สองอย่างนี้เป็นของใบ ไม่ใช่ของบรรทัด ถ้าปล่อยให้แต่ละบรรทัดถือเอง มันจะ
      เพี้ยนกันเองได้ แล้วใบส่งของใบเดียวจะกลายเป็นหลายใบในสายตาของประวัติสต็อก
    */
    const { user, receiveAction } = renderPanel();
    await user.type(screen.getByLabelText('ผู้ขาย'), '3M');
    await user.type(screen.getByLabelText('เลขที่ใบส่งของ'), 'INV-4520');
    await user.click(screen.getByRole('button', { name: /เพิ่มสินค้าอีกรายการ/ }));
    await user.click(save());

    expect(receiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ supplier: '3M', docNo: 'INV-4520' }),
    );
    expect(receiveAction.mock.calls[0][0].lines).toHaveLength(2);
  });

  it('ของเดิมกับของใหม่ ปนกันได้ในใบเดียว', async () => {
    /*
      ใบส่งของใบเดียวมีทั้งฟิล์มที่สั่งประจำ และสินค้าตัวใหม่ที่เพิ่งลอง การ
      บังคับให้แยกเป็นสองรอบ แปลว่าใบเดียวถูกบันทึกเป็นสองใบ
    */
    const { user, receiveAction } = renderPanel();
    await user.click(screen.getByRole('button', { name: /เพิ่มสินค้าอีกรายการ/ }));
    await user.click(
      within(screen.getByText('รายการที่ 2').parentElement as HTMLElement).getByRole('button', {
        name: 'ขึ้นทะเบียนสินค้าใหม่',
      }),
    );
    await user.type(screen.getByLabelText('ชื่อสินค้าใหม่ของรายการที่ 2'), 'ลำโพงใหม่');
    await user.click(save());

    const lines = receiveAction.mock.calls[0][0].lines;
    expect(lines[0].mode).toBe('existing');
    expect(lines[1]).toMatchObject({ mode: 'new', newName: 'ลำโพงใหม่' });
  });

  it('บรรทัดที่ยังไม่ได้กรอกอะไร ถูกข้ามเงียบ ๆ ไม่ใช่ error', async () => {
    // คนกดเพิ่มบรรทัดเผื่อไว้แล้วไม่ได้ใช้ เป็นเรื่องปกติ ไม่ใช่ความผิดพลาด
    const { user, receiveAction } = renderPanel();
    await user.click(screen.getByRole('button', { name: /เพิ่มสินค้าอีกรายการ/ }));
    await user.click(
      within(screen.getByText('รายการที่ 2').parentElement as HTMLElement).getByRole('button', {
        name: 'ขึ้นทะเบียนสินค้าใหม่',
      }),
    );
    await user.click(save());

    expect(receiveAction.mock.calls[0][0].lines).toHaveLength(1);
  });

  it('ปุ่มบันทึกบอกว่ากำลังจะบันทึกกี่รายการ', async () => {
    const { user } = renderPanel();
    expect(save()).toHaveTextContent('1 รายการ');
    await user.click(screen.getByRole('button', { name: /เพิ่มสินค้าอีกรายการ/ }));
    expect(save()).toHaveTextContent('2 รายการ');
  });

  it('ลบรายการที่ไม่เอาออกได้ แต่บรรทัดสุดท้ายลบไม่ได้', async () => {
    // ฟอร์มที่ไม่มีบรรทัดเลย ไม่ได้ช่วยอะไร และต้องกดเพิ่มกลับมาอยู่ดี
    const { user } = renderPanel();
    expect(screen.queryByRole('button', { name: 'ลบรายการที่ 1' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /เพิ่มสินค้าอีกรายการ/ }));
    await user.click(screen.getByRole('button', { name: 'ลบรายการที่ 2' }));

    expect(screen.queryByText('รายการที่ 2')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ลบรายการที่ 1' })).not.toBeInTheDocument();
  });

  it('ผู้ขายที่เคยกรอก เลือกซ้ำได้ และพิมพ์ชื่อใหม่ก็ยังได้', async () => {
    /*
      ผู้ขายรายใหม่เกิดขึ้นได้ตลอด ช่องที่เลือกได้อย่างเดียวจะบังคับให้คนไป
      ขึ้นทะเบียนผู้ขายก่อน ทั้งที่ของมาถึงหน้าร้านแล้ว
    */
    const { user, receiveAction } = renderPanel({ suppliers: ['3M', 'FINNIX'] });
    const box = screen.getByLabelText('ผู้ขาย');
    const listId = box.getAttribute('list')!;
    const options = Array.from(
      document.getElementById(listId)!.querySelectorAll('option'),
    ).map((o) => o.value);
    expect(options).toEqual(['3M', 'FINNIX']);

    await user.type(box, 'ร้านใหม่ที่ไม่เคยซื้อ');
    await user.click(save());
    expect(receiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ supplier: 'ร้านใหม่ที่ไม่เคยซื้อ' }),
    );
  });

  it('คนที่ไม่เห็นราคา ก็ยังรับของเข้าได้ แค่ไม่มีช่องราคา', async () => {
    // ของมาถึงคือข้อเท็จจริง ส่วนราคาให้คนที่เห็นราคามากรอกทีหลัง
    renderPanel({ canSeePrices: false });
    expect(screen.queryByLabelText('ราคาต่อหน่วยของรายการที่ 1')).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it('บันทึกไม่สำเร็จ บอกว่าเข้าไปแล้วกี่รายการ และไม่ปิดฟอร์มทิ้ง', async () => {
    /*
      การรับของแต่ละบรรทัดเป็นคนละคำสั่ง ถ้าพังกลางทางของที่เข้าไปแล้วจะอยู่ต่อ
      ปิดฟอร์มแล้วบอกว่า "ไม่สำเร็จ" เฉย ๆ จะทำให้คนกรอกใหม่ทั้งใบ แล้วของสอง
      รายการแรกก็เข้าไปซ้ำ
    */
    const receiveAction = vi.fn<ReceiveFn>(async () => ({
      ok: false,
      received: 2,
      error: 'รับเข้าแล้ว 2 รายการ แล้วติดที่รายการที่ 3: boom',
    }));
    const onDone = vi.fn<() => void>();
    const { user } = renderPanel({ receiveAction, onDone });
    await user.click(save());

    expect(screen.getByRole('alert')).toHaveTextContent('รับเข้าแล้ว 2 รายการ');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('สำเร็จแล้วปิดแผงให้เอง', async () => {
    const { user, onDone } = renderPanel();
    await user.click(save());
    expect(onDone).toHaveBeenCalled();
  });
});
