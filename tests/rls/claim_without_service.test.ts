// tests/rls/claim_without_service.test.ts
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

import type { Database, Json } from '@/lib/types/database';

/**
 * เคลมประกันโดยไม่ต้องเป็นรอบเซอร์วิส (migration 0067).
 *
 * A claim is not always part of a service. A เคลมประกัน visit records who did
 * the work and when, exactly as 0059 requires, but it is not one of the visits
 * the customer bought — so it is numbered in its own sequence and never takes
 * one of theirs.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const EMAIL = 'claim0067@test.local';
const TICKET = 'JT-CM-T0067';
const PLATE = 'ทดสอบ 0067';

let user: PosClient;
let policyId: number;

const visitsOf = async (kind: string) => {
  const { data } = await admin
    .from('service_visits')
    .select('visit_no, kind')
    .eq('ticket_id', TICKET)
    .eq('kind', kind)
    .order('visit_no');
  return (data ?? []).map((v) => v.visit_no);
};

const saveVisit = (visit: Record<string, unknown>, claim: Record<string, unknown> | null) =>
  user.rpc('save_service_visit', {
    p_id: null,
    p_ticket_id: TICKET,
    p_visit: { plate: PLATE, receivedAt: '2026-09-24', technicians: ['ช่างเอ'], ...visit } as Json,
    p_points: [] as Json,
    p_claim: claim as Json,
  });

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
        role_id: 'admin',
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
        customer_name: 'ทดสอบเคลม',
        plate: PLATE,
        status: 'ส่งมอบแล้ว',
        drop_off_date: '2026-09-01T09:00:00+07:00',
        pickup_date: '2026-09-01T17:00:00+07:00',
      })
    ).error,
  );
  const { data, error } = await admin
    .from('insurance_policies')
    .insert({
      ticket_id: TICKET,
      plate: PLATE,
      plan_name: 'ประกันฟิล์มกันรอย 1 ปี',
      big_pieces: 2,
      small_pieces: 20,
      starts_at: '2026-09-01',
      ends_at: '2027-09-01',
    })
    .select('id')
    .single();
  assertNoError('insert policy', error);
  policyId = data!.id;
});

afterAll(async () => {
  await admin.from('tickets').delete().eq('id', TICKET);
  await deleteAuthUserByEmail(admin, EMAIL);
});

describe('งานเคลมประกัน — ไม่กินสิทธิ์เซอร์วิส', () => {
  it('นับเลขครั้งที่แยกกันคนละชนิด บนใบงานเดียวกัน', async () => {
    // Two services and two claims on one ticket: เซอร์วิสครั้งที่ 1-2 and
    // งานเคลมครั้งที่ 1-2, not four services.
    for (const _ of [1, 2]) {
      assertNoError('service visit', (await saveVisit({ kind: 'เซอร์วิส' }, null)).error);
    }
    for (const small of [1, 2]) {
      const { error } = await saveVisit(
        { kind: 'เคลมประกัน' },
        { policyId, bigUsed: 0, smallUsed: small, detail: 'กันชนหน้า' },
      );
      assertNoError('claim visit', error);
    }
    expect(await visitsOf('เซอร์วิส')).toEqual([1, 2]);
    expect(await visitsOf('เคลมประกัน')).toEqual([1, 2]);
  });

  it('เคลมได้แม้ใบงานไม่เคยมีการเซอร์วิสเลย', async () => {
    // The whole point: ประกัน sold without a Service package still has a way
    // to record the claim.
    const { data } = await admin
      .from('insurance_claims')
      .select('id, big_used, small_used, service_visit_id')
      .eq('policy_id', policyId)
      .order('id');
    expect((data ?? []).length).toBe(2);
    // Still tied to a visit, as 0059 requires — no anonymous, dateless claims.
    expect((data ?? []).every((c) => c.service_visit_id != null)).toBe(true);
  });

  it('ปฏิเสธงานเคลมที่ไม่ได้ระบุประกัน', async () => {
    const { error } = await saveVisit({ kind: 'เคลมประกัน' }, null);
    expect(error?.message ?? '').toContain('งานเคลมประกันต้องระบุประกันที่ใช้เคลม');
  });

  it('ปฏิเสธชนิดที่ไม่รู้จัก', async () => {
    const { error } = await saveVisit({ kind: 'อะไรก็ไม่รู้' }, null);
    expect(error?.message ?? '').toContain('ชนิดการเข้ารับบริการไม่ถูกต้อง');
  });

  it('เซอร์วิสธรรมดายังเคลมได้เหมือนเดิม และยังนับเป็นสิทธิ์', async () => {
    // 0059's case is untouched: the car comes in for its service, something is
    // wrong, the cover pays — one visit, one claim, and it counts.
    const { error } = await saveVisit(
      { kind: 'เซอร์วิส' },
      { policyId, bigUsed: 1, smallUsed: 0, detail: 'ฝากระโปรง' },
    );
    assertNoError('service visit with claim', error);
    expect(await visitsOf('เซอร์วิส')).toEqual([1, 2, 3]);
  });

  it('แก้ไขงานเคลมแล้วไม่กลายเป็นเซอร์วิส', async () => {
    const { data: rows } = await admin
      .from('service_visits')
      .select('id')
      .eq('ticket_id', TICKET)
      .eq('kind', 'เคลมประกัน')
      .order('visit_no')
      .limit(1);
    const id = rows![0].id;
    const { error } = await user.rpc('save_service_visit', {
      p_id: id,
      p_ticket_id: TICKET,
      p_visit: { kind: 'เซอร์วิส', plate: PLATE, receivedAt: '2026-09-24' } as Json,
      p_points: [] as Json,
      p_claim: { policyId, bigUsed: 0, smallUsed: 1, detail: 'แก้ไข' } as Json,
    });
    assertNoError('edit claim visit', error);
    const { data } = await admin.from('service_visits').select('kind').eq('id', id).single();
    // The numbering behind it would be wrong if this could change.
    expect(data?.kind).toBe('เคลมประกัน');
  });
});
