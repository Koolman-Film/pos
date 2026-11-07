import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/storage/attachments', () => ({
  uploadAttachments: vi.fn(async () => []),
  discardAttachments: vi.fn(async () => {}),
  fileNameFromPath: (p: string) => p.split('/').pop() ?? p,
}));

import { WholesaleDetail } from '@/components/wholesale/WholesaleDetail';
import type { WsOrder } from '@/components/wholesale/types';

/**
 * สามเรื่องที่ร้านแจ้งพร้อมกัน 7 พ.ย. 2569 บนหน้า PO.
 */
const SHOPS = [
  { id: 'cm', name: 'FINNIX FILM เชียงใหม่' },
  { id: 'py', name: 'FINNIX FILM พะเยา' },
  { id: 'north', name: 'Finnix North' },
];

/** โหน่ง กับ เคน ขึ้นทะเบียนไว้ใต้ north เท่านั้น — เหมือนของจริง */
const SALES = [
  { id: 1, shop: 'north', name: 'โหน่ง', phone: '089-431-2278', userId: null },
  { id: 2, shop: 'north', name: 'เคน', phone: '086-514-9903', userId: null },
  { id: 3, shop: 'cm', name: 'หหหห', phone: '', userId: null },
];

const po = (over: Partial<WsOrder> = {}): WsOrder =>
  ({
    id: 'WS-PY-0012',
    shop: 'py',
    status: 'ค้างชำระ',
    customerId: 1,
    salesBy: '',
    items: [
      { name: 'ฟิล์ม FINNIX CT (ม้วน)', qty: 10, listPrice: 1500, requestedPrice: 1500, uid: 'u1' },
    ],
    returns: [],
    adjustments: [],
    payments: [],
    deliveries: [],
    ...over,
  }) as unknown as WsOrder;

const renderPO = (order: WsOrder, extra: Record<string, unknown> = {}) => {
  render(
    <WholesaleDetail
      order={order}
      canDo={() => true}
      shops={SHOPS}
      salesPeople={SALES}
      {...extra}
    />,
  );
  return userEvent.setup();
};

/**
 * เซลล์คนเดียวกัน ขายได้ทุกสาขา (ร้านยืนยัน 7 พ.ย. 2569).
 *
 * โหน่ง กับ เคน ขึ้นทะเบียนไว้ใต้ Finnix North สาขาพะเยาจึงไม่มีใครให้เลือกเลย
 * ทั้งที่เป็นคนเดียวกันที่วิ่งขายทุกสาขา แอดมินที่เปิด PO ให้พะเยาต้องเลือก
 * "ยังไม่ระบุ" หรือสร้างชื่อซ้ำขึ้นมาใหม่ ซึ่งจะแตกยอดของคนคนเดียวออกเป็นสองชื่อ
 */
describe('WholesaleDetail — เลือกพนักงานขายข้ามสาขาได้', () => {
  const names = () =>
    within(screen.getByLabelText('พนักงานขายของ PO นี้'))
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');

  it('สาขาที่ยังไม่มีเซลล์ขึ้นทะเบียน ก็เลือกเซลล์ที่มีอยู่แล้วได้', () => {
    renderPO(po());
    expect(names().some((n) => n.startsWith('โหน่ง'))).toBe(true);
    expect(names().some((n) => n.startsWith('เคน'))).toBe(true);
  });

  it('เบอร์โทรติดมาด้วย เอกสารจะได้มีเบอร์ให้ลูกค้าโทรกลับ', () => {
    // เลือกได้แต่เอกสารไม่ขึ้นเบอร์ คือครึ่งเดียวของสิ่งที่ขอ
    renderPO(po());
    expect(names().find((n) => n.startsWith('โหน่ง'))).toContain('089-431-2278');
  });

  it('เซลล์ของสาขานี้มาก่อน', () => {
    renderPO(po({ shop: 'cm', id: 'WS-CM-0001' } as Partial<WsOrder>));
    // ตัวแรกคือ "ยังไม่ระบุ" จากนั้นจึงเป็นของสาขานี้
    expect(names()[1]).toContain('หหหห');
  });

  it('ชื่อซ้ำกันสองสาขา ขึ้นครั้งเดียว', () => {
    /*
      `orders.sales_by` เก็บชื่อ ไม่ใช่ id — ชื่อเดียวกันคือคนเดียวกันตามที่ร้าน
      ใช้งานจริง สองบรรทัดชื่อเดียวกันคือช่องเลือกที่ตอบไม่ได้ว่าต่างกันตรงไหน
    */
    renderPO(po(), {
      salesPeople: [...SALES, { id: 9, shop: 'py', name: 'โหน่ง', phone: '', userId: null }],
    });
    expect(names().filter((n) => n.startsWith('โหน่ง'))).toHaveLength(1);
  });
});

/**
 * แบ่งส่ง — ต้องมีที่กรอกรอบถัดไป ตรงที่คนมองหา (ร้านแจ้ง 7 พ.ย. 2569).
 *
 * ทางเดิมมีอยู่แล้ว (กด "ใบส่งของ") แต่ไม่มีใครหาเจอ เพราะคนที่เห็น
 * "ส่งแล้ว 8/10 · ค้างอีก 2" กำลังมองหาที่กรอกรอบถัดไป ไม่ได้มองหาปุ่มพิมพ์เอกสาร
 */
describe('WholesaleDetail — บันทึกการจัดส่งรอบถัดไป', () => {
  const partlySent = po({
    id: 'WS-CM-0088',
    shop: 'cm',
    deliveries: [
      {
        uid: 'd1',
        date: '2026-09-04',
        note: '',
        attachments: [],
        items: [{ itemUid: 'u1', name: 'ฟิล์ม FINNIX CT (ม้วน)', qty: 8 }],
      },
    ],
  } as unknown as Partial<WsOrder>);

  const onSaveDelivery = vi.fn(async () => ({ ok: true }));

  it('ยังค้างส่ง ก็มีปุ่มบันทึกรอบถัดไป พร้อมบอกว่าค้างเท่าไหร่', () => {
    renderPO(partlySent, { onSaveDelivery });
    expect(screen.getByRole('button', { name: /บันทึกการจัดส่งรอบถัดไป/ })).toHaveTextContent(
      'ยังค้างส่ง 2 ชิ้น',
    );
  });

  it('กดแล้วเปิดกล่องกรอก พร้อมตั้งจำนวนที่ยังค้างไว้ให้', async () => {
    const user = renderPO(partlySent, { onSaveDelivery });
    await user.click(screen.getByRole('button', { name: /บันทึกการจัดส่งรอบถัดไป/ }));
    expect(screen.getByText('จำนวนที่ส่งรอบนี้')).toBeInTheDocument();
    expect(screen.getByLabelText(/ฟิล์ม FINNIX CT/)).toHaveValue(2);
  });

  it('ส่งครบแล้ว ก็ไม่ต้องมีปุ่ม', () => {
    const done = po({
      id: 'WS-CM-0089',
      shop: 'cm',
      deliveries: [
        {
          uid: 'd1',
          date: '2026-09-04',
          note: '',
          attachments: [],
          items: [{ itemUid: 'u1', name: 'ฟิล์ม FINNIX CT (ม้วน)', qty: 10 }],
        },
      ],
    } as unknown as Partial<WsOrder>);
    renderPO(done, { onSaveDelivery });
    expect(
      screen.queryByRole('button', { name: /บันทึกการจัดส่งรอบถัดไป/ }),
    ).not.toBeInTheDocument();
  });
});

describe('WholesaleDetail — ป้ายช่องราคา', () => {
  it('อ่านว่า ราคาขายมาตรฐาน และ ราคาขายที่เสนอ', () => {
    // ร้านขอคำที่ตรงกับที่ใช้คุยกันจริง 7 พ.ย. 2569
    renderPO(po());
    expect(screen.getByText('ราคาขายมาตรฐาน')).toBeInTheDocument();
    expect(screen.getByText('ราคาขายที่เสนอ')).toBeInTheDocument();
  });
});

/**
 * คืนสินค้าไม่เต็มหน่วย (ร้านถาม 7 พ.ย. 2569).
 *
 * ฟิล์มขายเป็นม้วน แต่ของที่คืนกลับมาวัดเป็นตารางฟุต และม้วนละไม่เท่ากัน —
 * 500 บ้าง 250 บ้าง คืนมา 300 ตร.ฟ. จากม้วนละ 500 จึงเป็น 0.6 ม้วน
 *
 * ฐานข้อมูลเก็บจำนวนเป็น numeric มาตั้งแต่ต้น และการคิดเงินก็คูณตรง ๆ อยู่แล้ว
 * สิ่งที่ปิดทางไว้คือช่องกรอกที่บอกว่าเดินทีละ 1
 */
describe('WholesaleDetail — คืนสินค้าไม่เต็มหน่วย', () => {
  const withReturn = po({
    id: 'WS-CM-0088',
    shop: 'cm',
    items: [
      { name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 2, listPrice: 1200, requestedPrice: 1200, uid: 'u1' },
    ],
    returns: [
      {
        item: 'ฟิล์ม 3M CRM (ม้วน)',
        itemUid: 'u1',
        qty: 0.6,
        reason: 'ของชำรุด',
        date: '2026-11-07',
      },
    ],
  } as unknown as Partial<WsOrder>);

  it('ช่องจำนวนรับทศนิยมได้ ไม่ใช่เดินทีละหน่วย', () => {
    renderPO(withReturn);
    const qty = screen.getByLabelText('จำนวนที่คืนรายการที่ 1');
    expect(qty).toHaveAttribute('step', 'any');
    expect(qty).toHaveValue(0.6);
  });

  it('คิดเงินคืนตามสัดส่วน และบอกวิธีคิดไว้ที่แถวนั้น', () => {
    // คนกรอกหาร 300 ÷ 500 ในหัว บรรทัดนี้คือที่ที่เขาตรวจคำตอบตัวเองได้ทันที
    renderPO(withReturn);
    expect(screen.getByText(/คืนเงิน/)).toHaveTextContent('0.60 × 1,200.00 = 720.00');
  });

  it('ยอดสุทธิหักตามสัดส่วนที่คืน ไม่ใช่หักทั้งม้วน', () => {
    renderPO(withReturn);
    // 2 × 1,200 = 2,400 ลบของคืน 720 = 1,680 (ยอดเดียวกันขึ้นทั้งบนจอและบนกระดาษ)
    // ยอดเดียวกันขึ้นทั้งบนจอและบนกระดาษ จึงนับว่ามีอย่างน้อยหนึ่งที่
    expect(screen.getAllByText('1,680.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-720.00').length).toBeGreaterThan(0);
  });

  it('บอกวิธีคืนไม่เต็มหน่วย ตรงที่คนกำลังจะกรอก', () => {
    // ความรู้ว่าม้วนละกี่ตารางฟุตไม่มีอยู่ในระบบ มีแต่ในหัวคนที่รับของคืน
    renderPO(withReturn);
    expect(screen.getByText(/คืนไม่เต็มหน่วย/)).toHaveTextContent('300 ÷ 500');
  });
});
