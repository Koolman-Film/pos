/**
 * อ่านทุกแถว ไม่ใช่แค่พันแถวแรก.
 *
 * PostgREST caps every response at `max_rows` (1000 here, see
 * `supabase/config.toml`). The cap is silent: the request succeeds, `error` is
 * null, and you get a thousand rows that look like the whole table. Nothing in
 * the response says it was cut.
 *
 * That is fine for a list somebody scrolls. It is not fine for the reads this
 * system builds figures out of — ยอดขาย, ค้างรับ, เงินอยู่ที่ไหนบ้าง are sums over
 * every ticket, PO and expense, and a sum over an arbitrary thousand of them is
 * simply a wrong number that looks right.
 *
 * It bit the shop first in the ขายส่ง product picker: the stock table had passed
 * a thousand rows, the picker's query had no `order by`, and PostgREST is free
 * to return any thousand rows when none is given — so the branch's shelf in the
 * PO screen and the branch's shelf in สต็อกสินค้า were two different lists of
 * products. Both were "correct" responses to their queries.
 *
 * So: page through with `range()` until a short page comes back. Ordering is
 * still the caller's job — `range()` without `order by` can repeat or skip rows
 * between pages, because there is no stable sequence to page along. Every caller
 * here orders by something unique enough to be stable.
 */

/** What a Supabase query resolves to, narrowed to what this needs. */
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** The server's own cap. Asking for more per page gets silently trimmed to it. */
const PAGE = 1000;

/**
 * `build(from, to)` must return the query with `.range(from, to)` applied —
 * everything else (columns, filters, ORDER BY) belongs to the caller.
 *
 * Throws on error rather than returning a partial list: a caller that silently
 * used half the rows is the exact failure this function exists to remove.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label = 'query',
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
    /*
      A hard stop so a bug here cannot turn into an endless loop against the
      production database. 100 pages is 100,000 rows — far past anything this
      shop holds, and if it is ever reached the answer is a real query with a
      WHERE clause, not another page.
    */
    if (rows.length >= PAGE * 100) {
      throw new Error(`${label}: เกิน ${PAGE * 100} แถว — ต้องกรองให้แคบลงก่อน`);
    }
  }
}
