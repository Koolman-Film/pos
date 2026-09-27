import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/*
  Every migration after 0000 sets `search_path = pos` for itself.

  Beyond being the house style, something depends on it: `supabase db reset`
  sends seed.sql as one batch, and the CLI version CI pins (2.109.1) resolves
  the batch's table names before seed.sql's own `set search_path` runs — against
  the path the LAST migration left on the connection. 0075 was the first
  migration without the line, and CI's reset failed on it with `relation
  "ticket_payments" does not exist` while every local run passed.
*/
const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

describe('migration conventions', () => {
  it.each(files.filter((f) => !f.startsWith('0000_')))('%s sets search_path to pos', (f) => {
    const sql = readFileSync(join(dir, f), 'utf8');
    expect(sql).toMatch(/^set search_path = pos\b/m);
  });

  it('never gives two migrations the same number', () => {
    const numbers = files.map((f) => f.slice(0, 4));
    expect(numbers.filter((n, i) => numbers.indexOf(n) !== i)).toEqual([]);
  });
});
