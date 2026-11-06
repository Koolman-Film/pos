import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  ค่าธรรมเนียมการโอน (0087).

  เงินจากเครื่องรูดบัตรเข้าธนาคารโดนหักทุกครั้ง วิธีเดิมคือบันทึกการโอนเต็มจำนวน
  แล้วไปเปิดหน้าค่าใช้จ่ายบันทึกค่าธรรมเนียมอีกรายการ (ร้านแจ้ง 6 พ.ย. 2569)

  ไฟล์นี้ปักด่านฝั่ง action ไว้ ส่วนการเขียนสองแถวในทรานแซกชันเดียวเป็นงานของ
  `save_money_transfer` ใน SQL
*/

const rpc = vi.hoisted(() => vi.fn(async () => ({ error: null })));
/** บัญชีที่สาขานี้เป็นเจ้าของ — ใช้ตอบด่าน "แหล่งเงินอยู่ในสาขานี้ไหม". */
const owned = vi.hoisted(() => ({ ids: [1, 2, 3] as number[] }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  getSessionContext: async () => ({
    userId: 'u-money',
    name: 'บัญชี',
    accessibleShopIds: ['cm'],
    canDo: () => true,
    hasNav: () => true,
  }),
}));

vi.mock('@/lib/supabase/server', () => {
  const api = {
    select: () => api,
    eq: () => api,
    in: (_col: string, ids: number[]) => {
      api.__ids = ids;
      return api;
    },
    __ids: [] as number[],
    then: (resolve: (v: { data: { id: number }[]; error: null }) => void) =>
      resolve({
        data: api.__ids.filter((id) => owned.ids.includes(id)).map((id) => ({ id })),
        error: null,
      }),
  };
  return { createClient: async () => ({ from: () => api, rpc }) };
});

import { saveMoneyTransfer } from '@/app/(app)/money/actions';

const base = {
  shop: 'cm',
  fromAccountId: 1,
  toAccountId: 2,
  amount: 10000,
  movedAt: '2026-11-06',
  note: '',
};

beforeEach(() => {
  rpc.mockClear();
  owned.ids = [1, 2, 3];
});

describe('บันทึกการโอน พร้อมค่าธรรมเนียม', () => {
  it('ส่งค่าธรรมเนียมและบัญชีที่หักไปด้วย', async () => {
    const res = await saveMoneyTransfer({ ...base, fee: 30 });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'save_money_transfer',
      expect.objectContaining({ p_amount: 10000, p_fee: 30, p_fee_account_id: 2 }),
    );
  });

  it('ไม่ระบุบัญชีที่หัก ก็ใช้บัญชีปลายทาง', async () => {
    // ปกติธนาคารปลายทางเป็นคนหัก จึงเป็นค่าตั้งต้นที่ถูกในกรณีส่วนใหญ่
    await saveMoneyTransfer({ ...base, fee: 30, feeAccountId: null });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_fee_account_id: 2 });
  });

  it('เลือกหักจากต้นทางได้ สำหรับ acquirer ที่หักก่อนโอน', async () => {
    await saveMoneyTransfer({ ...base, fee: 30, feeAccountId: 1 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_fee_account_id: 1 });
  });

  it('ไม่มีค่าธรรมเนียม ก็ไม่ส่งบัญชีที่หักไป', async () => {
    await saveMoneyTransfer(base);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_fee: 0, p_fee_account_id: null });
  });

  it('ค่าธรรมเนียมกินการโอนทั้งก้อนไม่ได้', async () => {
    // เท่ากับหรือมากกว่ายอดที่โอน แปลว่ากรอกสลับช่อง ไม่ใช่เหตุการณ์จริง
    const res = await saveMoneyTransfer({ ...base, fee: 10000 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/น้อยกว่าจำนวนเงินที่โอน/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ค่าธรรมเนียมติดลบไม่ได้', async () => {
    const res = await saveMoneyTransfer({ ...base, fee: -5 });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('โอนออกนอกระบบแล้วมีค่าธรรมเนียม ต้องบอกว่าหักจากบัญชีไหน', async () => {
    // ไม่มีปลายทางให้หักอัตโนมัติ และการเดาเอาเองจะลงบัญชีผิดเงียบ ๆ
    const res = await saveMoneyTransfer({
      ...base,
      toAccountId: null,
      fromAccountId: null,
      fee: 30,
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('บัญชีที่หักค่าธรรมเนียมต้องอยู่ในสาขาเดียวกัน', async () => {
    owned.ids = [1, 2];
    const res = await saveMoneyTransfer({ ...base, fee: 30, feeAccountId: 9 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ไม่ได้อยู่ในสาขานี้/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('บัญชีปลายทางที่เป็นตัวหักค่าธรรมเนียมด้วย ต้องไม่ถูกนับซ้ำจนตกด่าน', async () => {
    /*
      ค่าตั้งต้นของบัญชีที่หัก คือบัญชีปลายทาง — id เดียวกันจึงอยู่ในลิสต์สอง
      ครั้ง ถ้าไม่ตัดซ้ำ จำนวนแถวที่เป็นเจ้าของจะไม่มีวันเท่ากับความยาวลิสต์
      แล้วการโอนที่ถูกต้องทุกใบจะถูกปฏิเสธว่าไม่ได้อยู่ในสาขานี้
    */
    const res = await saveMoneyTransfer({ ...base, fee: 30, feeAccountId: 2 });
    expect(res.ok).toBe(true);
  });
});
