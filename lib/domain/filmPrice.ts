/**
 * ราคาฟิล์ม/กันรอย แยกตามสาขา (migration 0029).
 *
 * One combination of ชนิดสินค้า × สินค้า × ตำแหน่งติดตั้ง × ประเภทรถ can carry
 * two prices: a ราคากลาง every branch falls back to (`shop` empty) and a price
 * that belongs to one branch only. Both live in the same table, so every read
 * has to say which one it wants — this is that decision, in one place, so the
 * pricing panel and the ticket cannot disagree about it.
 */

export type FilmPriceKey = {
  category: string;
  product: string;
  position: string;
  carType: string;
};

export type FilmPriceLike = FilmPriceKey & { price: number; shop?: string | null };

function sameKey(row: FilmPriceKey, key: FilmPriceKey): boolean {
  return (
    row.category === key.category &&
    row.product === key.product &&
    row.position === key.position &&
    row.carType === key.carType
  );
}

/**
 * The row for exactly this scope — a branch row for a branch, the ราคากลาง row
 * for `''`. No fallback: the pricing panel must be able to show an empty cell
 * for a branch that has not overridden the ราคากลาง, or an admin would edit a
 * price that looked set and find they had created one.
 */
export function findFilmPrice<T extends FilmPriceLike>(
  rows: readonly T[],
  key: FilmPriceKey,
  shop: string,
): T | null {
  return rows.find((r) => sameKey(r, key) && (r.shop || '') === (shop || '')) ?? null;
}

/**
 * What this branch actually charges: its own price if it has set one, otherwise
 * the ราคากลาง. This is what a ticket quotes.
 */
export function resolveFilmPrice<T extends FilmPriceLike>(
  rows: readonly T[],
  key: FilmPriceKey,
  shop: string,
): T | null {
  return findFilmPrice(rows, key, shop) ?? findFilmPrice(rows, key, '');
}
