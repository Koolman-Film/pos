// tests/rls/service_visit_claims.test.ts
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
 * เคลมประกันผ่านการเซอร์วิส (migration 0059).
 *
 * `save_service_visit` is where the cover is checked, so these go through it as
 * a signed-in user — the path the Server Action takes — rather than through the
 * service role, which the claim trigger lets past on purpose.
 */

const admin = adminClient();
const PASSWORD = 'test-password-123';
const EMAIL = 'claims0059@test.local';
const TICKET = 'JT-CM-T0059';
const OTHER_TICKET = 'JT-CM-T0059B';
const PLATE = 'ทดสอบ 0059';

let user: PosClient;
let policyId: number;

async function cleanup() {
  await admin.from('tickets').delete().in('id', [TICKET, OTHER_TICKET]);
}

beforeAll(async () => {
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

  await cleanup();
  for (const [id, plate] of [
    [TICKET, PLATE],
    [OTHER_TICKET, 'คันอื่น 1'],
  ]) {
    assertNoError(
      `insert ticket ${id}`,
      (
        await admin.from('tickets').insert({
          id,
          shop_id: 'cm',
          customer_name: 'ทดสอบเคลม',
          plate,
          status: 'ส่งมอบแล้ว',
          drop_off_date: '2026-08-01T09:00:00+07:00',
          pickup_date: '2026-08-01T17:00:00+07:00',
        })
      ).error,
    );
  }
  const { data, error } = await admin
    .from('insurance_policies')
    .insert({
      ticket_id: TICKET,
      plate: PLATE,
      plan_name: 'ประกันทดสอบ',
      price: 2500,
      big_pieces: 2,
      small_pieces: 5,
      sold_at: '2026-08-01',
      starts_at: '2026-08-01',
      ends_at: '2027-08-01',
    })
    .select('id')
    .single();
  assertNoError('insert policy', error);
  policyId = data!.id;
});

afterAll(async () => {
  await cleanup();
  await deleteAuthUserByEmail(admin, EMAIL);
});

const visit = (receivedAt: string, plate = PLATE) =>
  ({ plate, receivedAt, technicians: ['ช่างเอ', 'ช่างบอย'] }) as unknown as Json;

async function saveVisit(
  ticketId: string,
  receivedAt: string,
  claim: Record<string, unknown> | null,
  id: number | null = null,
  plate = PLATE,
) {
  return user.rpc('save_service_visit', {
    p_id: id as number,
    p_ticket_id: ticketId,
    p_visit: visit(receivedAt, plate),
    p_points: [] as unknown as Json,
    p_claim: claim as unknown as Json,
  });
}

const claimsOf = async (visitId: number) =>
  (await admin.from('insurance_claims').select('*').eq('service_visit_id', visitId)).data ?? [];

describe('save_service_visit — เคลมประกัน', () => {
  it('stores the claim with the visit, on the visit’s own day and team', async () => {
    const { data: visitId, error } = await saveVisit(TICKET, '2026-09-10', {
      policyId,
      bigUsed: 1,
      smallUsed: 2,
      detail: 'กันชนหน้า',
    });
    expect(error).toBeNull();
    const [claim] = await claimsOf(visitId as number);
    expect(claim).toMatchObject({
      policy_id: policyId,
      big_used: 1,
      small_used: 2,
      detail: 'กันชนหน้า',
      claimed_at: '2026-09-10',
      received_at: '2026-09-10',
      technician: 'ช่างเอ, ช่างบอย',
    });
  });

  it('refuses more pieces than the policy has left', async () => {
    const { error } = await saveVisit(TICKET, '2026-09-11', { policyId, bigUsed: 2, smallUsed: 0 });
    expect(error?.message).toContain('เคลมเกินความคุ้มครองที่เหลือ (เหลือ 1 ชิ้นใหญ่, 3 ชิ้นเล็ก)');
  });

  it('refuses a visit day outside the cover', async () => {
    const { error } = await saveVisit(TICKET, '2027-09-01', { policyId, bigUsed: 1, smallUsed: 0 });
    expect(error?.message).toContain('ประกันหมดอายุก่อนวันที่รับรถ');
  });

  it('refuses a claim with no pieces', async () => {
    const { error } = await saveVisit(TICKET, '2026-09-12', { policyId, bigUsed: 0, smallUsed: 0 });
    expect(error?.message).toContain('ระบุจำนวนชิ้นที่เคลมอย่างน้อย 1 ชิ้น');
  });

  it('refuses another car’s policy', async () => {
    const { error } = await saveVisit(
      OTHER_TICKET,
      '2026-09-12',
      { policyId, bigUsed: 1, smallUsed: 0 },
      null,
      'คันอื่น 1',
    );
    expect(error?.message).toContain('ประกันที่เลือกไม่ใช่ของรถคันนี้');
  });

  it('gives the pieces back when the visit stops using the cover', async () => {
    const { data: visitId } = await saveVisit(TICKET, '2026-09-13', {
      policyId,
      bigUsed: 0,
      smallUsed: 1,
    });
    expect(await claimsOf(visitId as number)).toHaveLength(1);
    const { error } = await saveVisit(TICKET, '2026-09-13', null, visitId as number);
    expect(error).toBeNull();
    expect(await claimsOf(visitId as number)).toHaveLength(0);
  });

  it('keeps a visit’s claim when the policy itself is edited', async () => {
    const before = await admin
      .from('insurance_claims')
      .select('id', { count: 'exact', head: true })
      .eq('policy_id', policyId);
    const { error } = await user.rpc('save_insurance_policy', {
      p_id: policyId,
      p_ticket_id: TICKET,
      p_policy: {
        plate: PLATE,
        planName: 'ประกันทดสอบ (แก้)',
        price: 2500,
        bigPieces: 2,
        smallPieces: 5,
        soldAt: '2026-08-01',
        startsAt: '2026-08-01',
        endsAt: '2027-08-01',
      } as unknown as Json,
      p_claims: [] as unknown as Json,
    });
    expect(error).toBeNull();
    const after = await admin
      .from('insurance_claims')
      .select('id', { count: 'exact', head: true })
      .eq('policy_id', policyId);
    expect(after.count).toBe(before.count);
    expect(after.count).toBeGreaterThan(0);
  });

  it('will not take a claim written on its own', async () => {
    const { error } = await user
      .from('insurance_claims')
      .insert({ policy_id: policyId, big_used: 1 });
    expect(error?.message).toContain('บันทึกการเคลมประกันได้จากการเซอร์วิสเท่านั้น');
  });
});
