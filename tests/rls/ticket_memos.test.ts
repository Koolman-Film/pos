// tests/rls/ticket_memos.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
 * MEMO ของใบงาน (migration 0082).
 *
 * ช่องนี้ถูกสร้างมาตอบคำถามเดียว: "ใครพิมพ์ข้อมูลของใบงานนี้ไว้บ้าง" คำตอบนั้น
 * จะเชื่อถือได้ก็ต่อเมื่อชื่อคนเขียนและเวลามาจากฐานข้อมูล ไม่ใช่จาก payload
 * และเมื่อข้อความที่คนอื่นอ่านไปแล้วถูกแก้ทีหลังไม่ได้ ทั้งสองอย่างนั้นคือสิ่งที่
 * ไฟล์นี้พิสูจน์ ไม่ใช่หน้าจอ
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const A_EMAIL = 'memo-a@test.local';
const B_EMAIL = 'memo-b@test.local';
const ADMIN_EMAIL = 'memo-admin@test.local';
const OTHER_EMAIL = 'memo-other-shop@test.local';
const TICKET = 'JT-TEST-MEMO';

let asA: PosClient;
let asB: PosClient;
let asAdmin: PosClient;
let asOtherShop: PosClient;
let aId = '';

const signIn = async (
  email: string,
  roleId: string,
  seesAllShops = true,
): Promise<{ client: PosClient; id: string }> => {
  await deleteAuthUserByEmail(admin, email);
  const u = await createAuthUser(admin, email, PASSWORD);
  assertNoError(
    `insert app_users ${email}`,
    (
      await admin.from('app_users').insert({
        id: u.id,
        email,
        name: email,
        role_id: roleId,
        active: true,
        sees_all_shops: seesAllShops,
      })
    ).error,
  );
  const client = createClient<Database, 'pos'>(supabaseUrl(), supabaseAnonKey(), {
    db: { schema: 'pos' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assertNoError(
    `sign in ${email}`,
    (await client.auth.signInWithPassword({ email, password: PASSWORD })).error,
  );
  return { client, id: u.id };
};

const rows = async () => {
  const { data } = await admin
    .from('ticket_memos')
    .select('id, body, author, author_name, created_at')
    .eq('ticket_id', TICKET)
    .order('id');
  return data ?? [];
};

beforeAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  const a = await signIn(A_EMAIL, 'sales');
  asA = a.client;
  aId = a.id;
  asB = (await signIn(B_EMAIL, 'sales')).client;
  asAdmin = (await signIn(ADMIN_EMAIL, 'admin')).client;
  // เห็นเฉพาะสาขาอื่น — ใบงานทดสอบอยู่ที่ cm
  asOtherShop = (await signIn(OTHER_EMAIL, 'sales', false)).client;
  assertNoError(
    'grant other shop access',
    (
      await admin
        .from('user_shop_access')
        .insert({ user_id: (await userId(OTHER_EMAIL)) ?? '', shop_id: 'lp' })
    ).error,
  );
});

async function userId(email: string): Promise<string | null> {
  const { data } = await admin.from('app_users').select('id').eq('email', email).maybeSingle();
  return data?.id ?? null;
}

afterAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  for (const email of [A_EMAIL, B_EMAIL, ADMIN_EMAIL, OTHER_EMAIL]) {
    await deleteAuthUserByEmail(admin, email);
  }
});

beforeEach(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  assertNoError(
    'insert ticket',
    (
      await admin.from('tickets').insert({
        id: TICKET,
        shop_id: 'cm',
        customer_name: 'ทดสอบ MEMO',
        plate: 'ทดสอบ 0082',
        status: 'จองแล้ว',
        drop_off_date: '2026-10-05T09:00:00+07:00',
        pickup_date: '2026-10-05T17:00:00+07:00',
      })
    ).error,
  );
});

describe('ticket_memos — ใครพิมพ์ ต้องเป็นคำตอบที่ปลอมไม่ได้', () => {
  it('ฐานข้อมูลประทับชื่อและเวลาเอง ไม่ใช่รับจาก payload', async () => {
    assertNoError(
      'insert memo',
      (await asA.from('ticket_memos').insert({ ticket_id: TICKET, body: 'ลูกค้าขอเลื่อน' })).error,
    );
    const [m] = await rows();
    expect(m.author).toBe(aId);
    expect(m.author_name).toBe(A_EMAIL); // ชื่อใน app_users ของผู้ใช้ทดสอบ
    expect(new Date(m.created_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('ส่งชื่อคนอื่นมา ก็ยังถูกเขียนทับด้วยคนที่ล็อกอินจริง', async () => {
    /*
      นี่คือเหตุผลที่ trigger เขียนทับเสมอ แทนที่จะเติมเมื่อค่าว่าง — ถ้าเติม
      เมื่อว่าง การแอบอ้างก็ยังผ่าน และช่องนี้ก็เลิกตอบคำถามที่มันถูกสร้างมาตอบ
    */
    const forged = {
      ticket_id: TICKET,
      body: 'ข้อความนี้ไม่ใช่ของหัวหน้า',
      author_name: 'หัวหน้าสาขา',
      author: '00000000-0000-4000-8000-0000000000ff',
      created_at: '2000-01-01T00:00:00Z',
    } as unknown as { ticket_id: string; body: string };
    assertNoError('insert forged memo', (await asA.from('ticket_memos').insert(forged)).error);
    const [m] = await rows();
    expect(m.author_name).toBe(A_EMAIL);
    expect(m.author).toBe(aId);
    expect(new Date(m.created_at).getFullYear()).toBeGreaterThan(2020);
  });

  it('ข้อความว่างถูกปฏิเสธ และช่องว่างหัวท้ายถูกตัดทิ้ง', async () => {
    const blank = await asA.from('ticket_memos').insert({ ticket_id: TICKET, body: '   \n  ' });
    expect(blank.error).not.toBeNull();

    assertNoError(
      'insert padded',
      (await asA.from('ticket_memos').insert({ ticket_id: TICKET, body: '  รอของ  ' })).error,
    );
    expect((await rows())[0].body).toBe('รอของ');
  });

  it('แก้ข้อความไม่ได้เลย แม้แต่ของตัวเอง', async () => {
    /*
      ข้อความที่คนอื่นอ่านไปแล้วถูกแก้เงียบ ๆ ทีหลัง ทำให้ทั้งเส้นเชื่อถือไม่ได้
      พิมพ์ผิดก็ลบแล้วพิมพ์ใหม่ ซึ่งคนอื่นเห็นว่าเกิดอะไรขึ้น
    */
    assertNoError(
      'insert memo',
      (await asA.from('ticket_memos').insert({ ticket_id: TICKET, body: 'ของเดิม' })).error,
    );
    const id = (await rows())[0].id;
    const { error } = await asA
      .from('ticket_memos')
      .update({ body: 'ของใหม่' } as never)
      .eq('id', id);
    expect(error).not.toBeNull();
    expect((await rows())[0].body).toBe('ของเดิม');
  });
});

describe('ticket_memos — ใครลบได้', () => {
  const seed = async () => {
    assertNoError(
      'seed A',
      (await asA.from('ticket_memos').insert({ ticket_id: TICKET, body: 'ของ A' })).error,
    );
    assertNoError(
      'seed B',
      (await asB.from('ticket_memos').insert({ ticket_id: TICKET, body: 'ของ B' })).error,
    );
    const all = await rows();
    return { aMemo: all[0].id, bMemo: all[1].id };
  };

  it('ลบของตัวเองได้', async () => {
    const { aMemo } = await seed();
    const { data } = await asA.from('ticket_memos').delete().eq('id', aMemo).select('id');
    expect(data).toHaveLength(1);
    expect((await rows()).map((m) => m.body)).toEqual(['ของ B']);
  });

  it('ลบของคนอื่นไม่ได้ — ไม่ error แต่ไม่มีแถวหายไป', async () => {
    const { bMemo } = await seed();
    const { data, error } = await asA.from('ticket_memos').delete().eq('id', bMemo).select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    expect(await rows()).toHaveLength(2);
  });

  it('แอดมินลบของใครก็ได้', async () => {
    const { bMemo } = await seed();
    const { data } = await asAdmin.from('ticket_memos').delete().eq('id', bMemo).select('id');
    expect(data).toHaveLength(1);
  });
});

describe('ticket_memos — ขอบสาขา', () => {
  it('คนที่ไม่เห็นใบงาน ก็ไม่เห็นและเขียน MEMO ของใบนั้นไม่ได้', async () => {
    assertNoError(
      'seed',
      (await asA.from('ticket_memos').insert({ ticket_id: TICKET, body: 'ภายในสาขา cm' })).error,
    );
    const { data } = await asOtherShop.from('ticket_memos').select('id').eq('ticket_id', TICKET);
    expect(data ?? []).toHaveLength(0);

    const { error } = await asOtherShop
      .from('ticket_memos')
      .insert({ ticket_id: TICKET, body: 'แอบเขียนข้ามสาขา' });
    expect(error).not.toBeNull();
  });
});

describe('ticket_memos — ใบงานที่ล็อกแล้ว', () => {
  it('ยังเขียน MEMO ได้', async () => {
    /*
      ด่านล็อก (0017) กันไม่ให้ตัวเลขของใบงานที่ปิดไปแล้วขยับ MEMO ไม่ใช่ตัวเลข
      และคำถามเรื่องงานที่ปิดไปแล้วก็ยังโทรเข้ามาอยู่ดี
    */
    assertNoError(
      'lock ticket',
      (await admin.from('tickets').update({ locked: true }).eq('id', TICKET)).error,
    );
    assertNoError(
      'memo on locked ticket',
      (await asA.from('ticket_memos').insert({ ticket_id: TICKET, body: 'ลูกค้าโทรกลับมาถาม' }))
        .error,
    );
    expect(await rows()).toHaveLength(1);
  });
});

describe('ticket_memos — ลบใบงานแล้ว', () => {
  it('ข้อความหายไปกับใบงาน', async () => {
    assertNoError(
      'seed',
      (await asA.from('ticket_memos').insert({ ticket_id: TICKET, body: 'จะหายไปกับใบงาน' })).error,
    );
    await admin.from('tickets').delete().eq('id', TICKET);
    expect(await rows()).toHaveLength(0);
  });
});
