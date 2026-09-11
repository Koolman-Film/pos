import { describe, it, expect, vi } from 'vitest';

import { fetchAllRows } from '@/lib/supabase/fetchAll';

/**
 * อ่านทุกแถว ไม่ใช่แค่พันแถวแรก.
 *
 * PostgREST caps every response at `max_rows` (1000) and says nothing when it
 * does — `error` is null and the rows look like the whole table. The shop found
 * it the hard way: the ขายส่ง product picker offered Finnix North products that
 * branch does not carry, because its query had no `order by` and PostgREST is
 * free to return any thousand rows when none is given.
 *
 * These pin the two properties that matter: everything comes back, and a
 * failure is loud rather than a short list.
 */
const page = (rows: number[]) => ({ data: rows.map((n) => ({ n })), error: null });

describe('fetchAllRows', () => {
  it('ตามเก็บทุกหน้า จนกว่าหน้าสุดท้ายจะไม่เต็ม', async () => {
    const build = vi.fn((from: number, to: number) => {
      // 2,300 rows: two full pages and a short one.
      const all = Array.from({ length: 2300 }, (_, i) => i);
      return Promise.resolve(page(all.slice(from, to + 1)));
    });

    const rows = await fetchAllRows(build);
    expect(rows).toHaveLength(2300);
    expect(rows[0]).toEqual({ n: 0 });
    expect(rows[2299]).toEqual({ n: 2299 });
    // Three requests, and the ranges must not overlap or skip.
    expect(build.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('หยุดทันทีเมื่อหน้าแรกไม่เต็ม', async () => {
    const build = vi.fn(() => Promise.resolve(page([1, 2, 3])));
    expect(await fetchAllRows(build)).toHaveLength(3);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('ตารางว่างคืนรายการว่าง ไม่ใช่วนไม่จบ', async () => {
    const build = vi.fn(() => Promise.resolve({ data: null, error: null }));
    expect(await fetchAllRows(build)).toEqual([]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('โยน error ไม่คืนรายการที่อ่านมาได้ครึ่งเดียว', async () => {
    // A caller that silently used half the rows is the exact failure this
    // function exists to remove, so a mid-page error must not look like an end.
    const build = vi.fn((from: number) =>
      Promise.resolve(
        from === 0
          ? page(Array.from({ length: 1000 }, (_, i) => i))
          : { data: null, error: { message: 'connection lost' } },
      ),
    );
    await expect(fetchAllRows(build, 'stock')).rejects.toThrow('stock: connection lost');
  });
});
