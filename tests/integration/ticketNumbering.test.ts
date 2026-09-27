import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { adminClient, assertNoError } from '../rls/_helpers';

/*
  เลขใบงานออกโดยฐานข้อมูล (migration 0076).

  The number used to be worked out in the app: read every JT-XX-… id of the
  branch, take the largest, add one. The read was unpaged, and PostgREST returns
  at most 1,000 rows — so once a branch passed 1,000 tickets the "largest" came
  from an arbitrary 1,000 of them, the next number usually already existed, and
  creating a ticket failed with a duplicate key. Chiang Mai was on course to hit
  that around January 2027. Two people pressing บันทึก at the same moment also
  collided, because both read the same maximum.

  The database now assigns the number in a BEFORE INSERT trigger, under a
  per-branch lock, from every row — the way PO numbers have been since 0036.
*/
const admin = adminClient();
const SHOP = 'zq';
const PREFIX = 'JT-ZQ-';
const EXISTING = 1100;

function ticket(id: string) {
  const now = new Date().toISOString();
  return {
    id,
    shop_id: SHOP,
    customer_name: 'ทดสอบเลขใบงาน',
    status: 'จองแล้ว',
    drop_off_date: now,
    pickup_date: now,
  };
}

async function cleanup() {
  await admin.from('tickets').delete().eq('shop_id', SHOP);
  await admin.from('shops').delete().eq('id', SHOP);
}

beforeAll(async () => {
  await cleanup();
  assertNoError(
    'shop',
    (await admin.from('shops').insert({ id: SHOP, name: 'ทดสอบเลขใบงาน' })).error,
  );
  // More than one PostgREST page of existing tickets, numbered 1..1100.
  const rows = Array.from({ length: EXISTING }, (_, i) =>
    ticket(`${PREFIX}${String(i + 1).padStart(5, '0')}`),
  );
  for (let i = 0; i < rows.length; i += 500) {
    assertNoError('seed', (await admin.from('tickets').insert(rows.slice(i, i + 500))).error);
  }
}, 60_000);

afterAll(cleanup);

async function create() {
  const { data, error } = await admin.from('tickets').insert(ticket('')).select('id').single();
  assertNoError('create', error);
  return data!.id as string;
}

describe('ticket numbering', () => {
  it('continues from the real maximum past 1,000 tickets', async () => {
    expect(await create()).toBe(`${PREFIX}01101`);
  });

  it('gives simultaneous creates distinct, consecutive numbers', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => create()));
    expect(new Set(ids).size).toBe(6);
    expect([...ids].sort()).toEqual(
      [1102, 1103, 1104, 1105, 1106, 1107].map((n) => `${PREFIX}0${n}`),
    );
  });

  it('keeps an id that is given explicitly (imports, seeds, repair scripts)', async () => {
    const { data, error } = await admin
      .from('tickets')
      .insert(ticket(`${PREFIX}90000`))
      .select('id')
      .single();
    assertNoError('explicit', error);
    expect(data!.id).toBe(`${PREFIX}90000`);
  });

  it('ignores ids that are not a plain number after the prefix', async () => {
    assertNoError('odd id', (await admin.from('tickets').insert(ticket(`${PREFIX}T0066`))).error);
    expect(await create()).toBe(`${PREFIX}90001`);
  });
});
