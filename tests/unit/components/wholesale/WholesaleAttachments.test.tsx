import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const upload = vi.hoisted(() => vi.fn());
const discard = vi.hoisted(() => vi.fn());

vi.mock('@/lib/storage/attachments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/attachments')>(
    '@/lib/storage/attachments',
  );
  return { ...actual, uploadAttachments: upload, discardAttachments: discard };
});

import { WholesaleDetail } from '@/components/wholesale/WholesaleDetail';
import type { WsOrder } from '@/components/wholesale/types';

/**
 * หลักฐานที่แนบไว้ใน PO ต้องเปิดดูได้ และต้องมีไฟล์อยู่จริง (ร้านเจอ 26 ต.ค. 2569).
 *
 * สองอาการคนละชั้นกัน แต่มาจากความเข้าใจผิดอันเดียว — คิดว่า "แนบไฟล์" คือการ
 * จำชื่อไฟล์ไว้:
 *
 *   รอบส่งของ  อัปโหลดจริง แต่พิมพ์ชื่อไฟล์ทิ้งไว้เฉย ๆ bucket เป็นแบบส่วนตัว
 *              คนที่กลับมาตรวจย้อนหลังจึงเปิดไม่ได้สักทาง
 *   การรับเงิน ไม่ได้อัปโหลดเลย เก็บแค่ `file.name` ลง state และ
 *              `order_payments` ก็ไม่มีคอลัมน์ให้เก็บ (จนถึง 0086) ชิปเขียวขึ้น
 *              ครบทุกครั้ง แล้วหายไปพร้อมการรีเฟรช
 *
 * อาการที่สองอันตรายกว่า เพราะมันดูเหมือนสำเร็จ
 */

const ACCOUNTS = [
  { id: 11, shop: 'cm', name: 'กสิกร ออมทรัพย์', kind: 'bank', accountNo: '236-1-38053-6' },
];

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const base = {
  id: 'WS-CM-0091',
  shop: 'cm',
  status: 'จัดส่งแล้ว',
  items: [{ name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10, requestedPrice: 1000, uid: 'u1' }],
  returns: [],
  adjustments: [],
  payments: [],
} as unknown as WsOrder;

const withRound = {
  ...base,
  deliveredAt: '2026-10-26',
  deliveryNote: 'พี่เอาไปส่ง',
  deliveryAttachments: [`cm/WS-CM-0091/${UUID}-messageImage_1793007306859.jpg`],
  deliveries: [
    {
      uid: 'd1',
      date: '2026-10-26',
      note: 'พี่เอาไปส่ง',
      attachments: [`cm/WS-CM-0091/${UUID}-messageImage_1793007306859.jpg`],
      items: [{ itemUid: 'u1', name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10 }],
    },
  ],
} as unknown as WsOrder;

beforeEach(() => {
  upload.mockReset();
  discard.mockReset();
});

describe('WholesaleDetail — หลักฐานที่แนบไว้ ต้องเปิดดูได้', () => {
  it('ชื่อไฟล์ของรอบส่งของ กดแล้วเปิดดูผ่านลิงก์ที่เซ็นมา', async () => {
    const user = userEvent.setup();
    const attachmentUrlAction = vi.fn(async () => ({ url: 'https://signed.example/slip.jpg' }));

    render(
      <WholesaleDetail
        order={withRound}
        canDo={() => true}
        attachmentUrlAction={attachmentUrlAction}
      />,
    );

    const round = screen.getByText(/รอบที่ 1/).closest('div')!;
    await user.click(within(round).getByTitle('ดู messageImage_1793007306859.jpg'));

    // ขอทีละไฟล์ตอนกด — ลิงก์มีอายุหนึ่งนาที การขอล่วงหน้าทั้งหน้าคือการขอทิ้ง
    expect(attachmentUrlAction).toHaveBeenCalledWith(
      `cm/WS-CM-0091/${UUID}-messageImage_1793007306859.jpg`,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('messageImage_1793007306859.jpg')).toHaveAttribute(
      'src',
      'https://signed.example/slip.jpg',
    );
  });

  it('ชื่อไฟล์ยังอ่านออกแม้เปิดไม่ได้ แต่ไม่หลอกให้กด', () => {
    // ไม่มีทางขอลิงก์ = ปุ่มที่กดแล้วเงียบ ซึ่งแย่กว่าข้อความเฉย ๆ
    render(<WholesaleDetail order={withRound} canDo={() => true} />);
    const round = screen.getByText(/รอบที่ 1/).closest('div')!;
    expect(within(round).getByText('messageImage_1793007306859.jpg')).toBeInTheDocument();
    expect(within(round).getByTitle('messageImage_1793007306859.jpg')).toBeDisabled();
  });
});

describe('WholesaleDetail — หลักฐานการชำระเงิน ต้องมีไฟล์อยู่จริง', () => {
  const openPaymentRow = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<WholesaleDetail order={base} payAccounts={ACCOUNTS} canDo={() => true} />);
    await user.click(screen.getByRole('button', { name: /เพิ่มรายการรับเงิน/ }));
  };

  it('อัปโหลดขึ้น bucket ของขายส่ง แล้วถือ path ไว้ ไม่ใช่ชื่อไฟล์', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue([
      {
        path: `cm/WS-CM-0091/${UUID}-slip.jpg`,
        fileName: 'สลิป.jpg',
        mimeType: 'image/jpeg',
        size: 10,
      },
    ]);
    await openPaymentRow(user);

    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(picker, new File(['x'], 'สลิป.jpg', { type: 'image/jpeg' }));

    /*
      bucket ต้องเป็นของขายส่ง ไม่ใช่ของใบงาน — storage RLS ของสองถังนี้ถาม
      สิทธิ์คนละโมดูล (0055) ยิงผิดถังคือยิงไม่ผ่านด่าน
    */
    expect(upload).toHaveBeenCalledWith('wholesale-attachments', 'cm/WS-CM-0091', [
      expect.any(File),
    ]);
    // ชิปตั้งชื่อจาก path ที่ storage ตอบกลับมา ไม่ใช่จาก `file.name` ที่เลือก
    expect(await screen.findByText('slip.jpg')).toBeInTheDocument();
  });

  it('บันทึก PO แล้วส่ง path ไปกับการรับเงิน ไม่ใช่ชื่อไฟล์', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue([
      {
        path: `cm/WS-CM-0091/${UUID}-slip.jpg`,
        fileName: 'สลิป.jpg',
        mimeType: 'image/jpeg',
        size: 10,
      },
    ]);
    const onSaveOrder = vi.fn();
    render(
      <WholesaleDetail
        order={base}
        payAccounts={ACCOUNTS}
        canDo={() => true}
        onSaveOrder={onSaveOrder}
      />,
    );
    await user.click(screen.getByRole('button', { name: /เพิ่มรายการรับเงิน/ }));
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['x'], 'สลิป.jpg', { type: 'image/jpeg' }),
    );
    await user.click(screen.getByRole('button', { name: 'บันทึก PO' }));

    expect(onSaveOrder).toHaveBeenCalledTimes(1);
    const sent = onSaveOrder.mock.calls[0][0] as WsOrder;
    expect(sent.payments[0].attachments).toEqual([`cm/WS-CM-0091/${UUID}-slip.jpg`]);
  });
});
