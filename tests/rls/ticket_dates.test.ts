// tests/rls/ticket_dates.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { adminClient, assertNoError } from './_helpers';

/**
 * วันที่ส่งงานต้องอยู่หลังวันที่รับงาน (0085) — ตรวจเฉพาะใบใหม่และตอนแก้วันที่ (0086).
 *
 * The trigger sits below RLS, so the service-role client is enough: nobody can
 * write a new inverted range through the API.
 *
 * What this file cannot set up is a row that is ALREADY inverted — by design no
 * API path creates one. That case (an old inverted ticket saved with its dates
 * unchanged must pass) was proven against a local database with the trigger
 * bypassed; see the PR for 0086.
 */

const admin = adminClient();
const TICKET = 'JT-CM-T0086';
const at = (iso: string) => new Date(`${iso}+07:00`).toISOString();

const base = { shop_id: 'cm', customer_name: 'ทดสอบวันที่', status: 'จองแล้ว' };

const stored = async () => {
  const { data } = await admin
    .from('tickets')
    .select('customer_name, drop_off_date, pickup_date')
    .eq('id', TICKET)
    .maybeSingle();
  return data;
};

const putValid = async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  const { error } = await admin.from('tickets').insert({
    ...base,
    id: TICKET,
    drop_off_date: at('2026-10-17T10:00'),
    pickup_date: at('2026-10-17T16:00'),
  });
  assertNoError('insert valid ticket', error);
};

beforeAll(putValid);
afterAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
});

describe('กติกาวันที่ของใบงาน', () => {
  it('ใบใหม่ที่ส่งก่อนรับ ถูกปฏิเสธ', async () => {
    await admin.from('tickets').delete().eq('id', TICKET);
    const { error } = await admin.from('tickets').insert({
      ...base,
      id: TICKET,
      drop_off_date: at('2026-10-17T10:00'),
      pickup_date: at('2026-10-16T10:00'),
    });
    expect(error).not.toBeNull();
    expect(await stored()).toBeNull();
    await putValid();
  });

  it('ใบใหม่ที่เวลาส่งเท่ากับเวลารับเป๊ะ ถูกปฏิเสธ', async () => {
    await admin.from('tickets').delete().eq('id', TICKET);
    const { error } = await admin.from('tickets').insert({
      ...base,
      id: TICKET,
      drop_off_date: at('2026-10-17T10:00'),
      pickup_date: at('2026-10-17T10:00'),
    });
    expect(error).not.toBeNull();
    expect(await stored()).toBeNull();
    await putValid();
  });

  it('แก้วันที่ให้กลับหัว ถูกปฏิเสธ และของเดิมอยู่ครบ', async () => {
    const { error } = await admin
      .from('tickets')
      .update({ pickup_date: at('2026-10-17T09:00') })
      .eq('id', TICKET);
    expect(error).not.toBeNull();
    expect(new Date((await stored())!.pickup_date!).toISOString()).toBe(at('2026-10-17T16:00'));
  });

  it('บันทึกแบบที่หน้าจอทำ — ส่งวันที่เดิมไปด้วย — ผ่าน', async () => {
    // หน้าจอส่งทั้งสองช่องทุกครั้ง: trigger `update of` ทำงานแม้ค่าไม่เปลี่ยน
    const { error } = await admin
      .from('tickets')
      .update({
        customer_name: 'แก้ชื่อลูกค้า',
        drop_off_date: at('2026-10-17T10:00'),
        pickup_date: at('2026-10-17T16:00'),
      })
      .eq('id', TICKET);
    expect(error).toBeNull();
    expect((await stored())?.customer_name).toBe('แก้ชื่อลูกค้า');
  });
});
