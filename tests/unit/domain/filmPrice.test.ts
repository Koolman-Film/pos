import { describe, it, expect } from 'vitest';
import { findFilmPrice, resolveFilmPrice, type FilmPriceLike } from '@/lib/domain/filmPrice';

const KEY = {
  category: 'ฟิล์มกรองแสง',
  product: 'Hi-Kool 40%',
  position: 'บานหน้า',
  carType: 'เก๋ง',
};

const rows: FilmPriceLike[] = [
  { ...KEY, price: 2500, shop: null },
  { ...KEY, price: 2800, shop: 'lampang' },
  { ...KEY, position: 'บานหลัง', price: 1900, shop: null },
  { ...KEY, product: 'Hi-Kool 60%', price: 3200, shop: 'lampang' },
];

describe('findFilmPrice', () => {
  it("returns the ราคากลาง row for the '' scope", () => {
    expect(findFilmPrice(rows, KEY, '')?.price).toBe(2500);
  });

  it('returns the branch row for that branch', () => {
    expect(findFilmPrice(rows, KEY, 'lampang')?.price).toBe(2800);
  });

  it('does NOT fall back — a branch with no override reads as unset', () => {
    // This is what lets the pricing panel show an empty cell rather than making
    // the admin edit a price they think is already the branch's.
    expect(findFilmPrice(rows, KEY, 'chiangmai')).toBeNull();
  });

  it('never crosses to another position, product or car type', () => {
    expect(findFilmPrice(rows, { ...KEY, carType: 'กระบะ' }, '')).toBeNull();
    expect(findFilmPrice(rows, { ...KEY, position: 'รอบคัน' }, '')).toBeNull();
  });
});

describe('resolveFilmPrice', () => {
  it("quotes the branch's own price when it has one", () => {
    expect(resolveFilmPrice(rows, KEY, 'lampang')?.price).toBe(2800);
  });

  it('falls back to the ราคากลาง for a branch that has not set one', () => {
    expect(resolveFilmPrice(rows, KEY, 'chiangmai')?.price).toBe(2500);
  });

  it('is null when neither exists, so the caller keeps its own fallback', () => {
    expect(resolveFilmPrice(rows, { ...KEY, product: 'ไม่มีในตาราง' }, 'lampang')).toBeNull();
  });

  it('reads a legacy row with no shop field as the ราคากลาง', () => {
    // Every row predating migration 0029 arrives without a shop.
    const legacy: FilmPriceLike[] = [{ ...KEY, price: 2100 }];
    expect(resolveFilmPrice(legacy, KEY, 'lampang')?.price).toBe(2100);
  });

  it("one branch's price does not leak into another", () => {
    const onlyLampang: FilmPriceLike[] = [{ ...KEY, price: 2800, shop: 'lampang' }];
    expect(resolveFilmPrice(onlyLampang, KEY, 'chiangmai')).toBeNull();
  });
});
