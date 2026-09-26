// tests/rls/ticket_finnix_doc.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import {
  type PosClient,
  adminClient,
  assertNoError,
  createAuthUser,
  deleteAuthUserByEmail,
  supabaseAnonKey,
  supabaseUrl,
} from './_helpers';

import type { Database } from '@/lib/types/database';

/**
 * เลขที่เอกสาร PEAK แก้ได้แม้ใบงานปิดแล้ว แต่แก้ได้แค่นั้น (migration 0072).
 *
 * The number arrives from the accounts days after the car has gone and the
 * ticket has locked itself, so the lock has to let it through — and let
 * through nothing else. The caller is a `sales` user, someone WITHOUT
 * `list.unlock`, because an admin can already edit anything.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const EMAIL = 'peakdoc@test.local';
const TICKET = 'JT-CM-T0072';

let user: PosClient;

const stored = async () => {
  const { data } = await admin
    .from('tickets')
    .select('finnix_doc_no, customer_name, status, locked')
    .eq('id', TICKET)
    .single();
  return data;
};

const reset = () =>
  admin
    .from('tickets')
    .update({ locked: true, finnix_doc_no: '', customer_name: 'ทดสอบ PEAK' })
    .eq('id', TICKET);

beforeAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  await deleteAuthUserByEmail(admin, EMAIL);
  const u = await createAuthUser(admin, EMAIL, PASSWORD);
  assertNoError(
    'insert app_users',
    (
      await admin.from('app_users').insert({
        id: u.id,
        email: EMAIL,
        name: EMAIL,
        role_id: 'sales',
        active: true,
        sees_all_shops: true,
      })
    ).error,
  );
  user = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assertNoError(
    'sign in',
    (await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })).error,
  );
  assertNoError(
    'insert ticket',
    (
      await admin.from('tickets').insert({
        id: TICKET,
        shop_id: 'cm',
        customer_name: 'ทดสอบ PEAK',
        plate: 'ทดสอบ 0072',
        status: 'ส่งมอบแล้ว',
        drop_off_date: '2026-09-01T09:00:00+07:00',
        pickup_date: '2026-09-01T17:00:00+07:00',
        locked: true,
      })
    ).error,
  );
});

afterAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  await deleteAuthUserByEmail(admin, EMAIL);
});

describe('เลขที่เอกสาร PEAK บนใบงานที่ล็อกแล้ว', () => {
  it('กรอกเลขเอกสารได้ แม้ใบงานปิดและล็อกไปแล้ว', async () => {
    await reset();
    const { error } = await user.rpc('save_ticket_finnix_doc', {
      p_ticket_id: TICKET,
      p_doc_no: 'IV6809-0042',
    });
    expect(error).toBeNull();
    expect(await stored()).toMatchObject({ finnix_doc_no: 'IV6809-0042', locked: true });
  });

  it('ตัดช่องว่างหัวท้ายให้ — เลขที่มีช่องว่างติดมาไม่ใช่คนละเลข', async () => {
    await reset();
    await user.rpc('save_ticket_finnix_doc', { p_ticket_id: TICKET, p_doc_no: '  IV-1  ' });
    expect((await stored())?.finnix_doc_no).toBe('IV-1');
  });

  it('แก้เลขที่กรอกผิดได้ และลบออกได้', async () => {
    await reset();
    await user.rpc('save_ticket_finnix_doc', { p_ticket_id: TICKET, p_doc_no: 'IV-1' });
    await user.rpc('save_ticket_finnix_doc', { p_ticket_id: TICKET, p_doc_no: '' });
    expect((await stored())?.finnix_doc_no).toBe('');
  });

  it('ด่านล็อกยังกันทุกอย่างที่เหลือเหมือนเดิม', async () => {
    await reset();
    for (const patch of [
      { customer_name: 'ไม่ควรผ่าน' },
      { status: 'จองแล้ว' },
      { locked: false },
    ]) {
      const { error } = await user.from('tickets').update(patch).eq('id', TICKET);
      expect(error?.message ?? '').toContain('ปิดงานแล้ว');
    }
    expect(await stored()).toMatchObject({
      customer_name: 'ทดสอบ PEAK',
      status: 'ส่งมอบแล้ว',
      locked: true,
    });
  });
});
