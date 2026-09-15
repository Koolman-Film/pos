import { describe, it, expect } from 'vitest';

import { amountTerms, matchesSearch } from '@/lib/domain/search';

/** The one set of rules every list's search box follows. */

const job = [
  'JT-CM-00214',
  'คุณ เอ',
  '081-234-5678',
  '250 กก',
  'Toyota',
  'Vios',
  ['ฟิล์มกรองแสง', '3M CRM 60%'],
  ['ช่างเอก', 'ช่างบอย'],
  amountTerms(9600),
];

describe('matchesSearch', () => {
  it('matches everything when nothing is typed', () => {
    expect(matchesSearch('   ', job)).toBe(true);
  });

  it('finds a job by its document number, whole or in part', () => {
    expect(matchesSearch('JT-CM-00214', job)).toBe(true);
    expect(matchesSearch('00214', job)).toBe(true);
    expect(matchesSearch('jt-cm', job)).toBe(true);
  });

  it('finds a phone number however it is typed', () => {
    expect(matchesSearch('0812345678', job)).toBe(true);
    expect(matchesSearch('081 234 5678', job)).toBe(true);
    expect(matchesSearch('5678', job)).toBe(true);
  });

  it('finds a plate with or without its space', () => {
    expect(matchesSearch('250กก', job)).toBe(true);
    expect(matchesSearch('250 กก', job)).toBe(true);
    expect(matchesSearch('250', job)).toBe(true);
  });

  it('requires every word, in any field and any order', () => {
    expect(matchesSearch('vios 250', job)).toBe(true);
    expect(matchesSearch('ช่างบอย toyota', job)).toBe(true);
    expect(matchesSearch('vios honda', job)).toBe(false);
  });

  it('ignores case', () => {
    expect(matchesSearch('TOYOTA', job)).toBe(true);
  });

  it('finds an amount as typed or as shown', () => {
    expect(matchesSearch('9600', job)).toBe(true);
    expect(matchesSearch('9,600', job)).toBe(true);
  });

  it('does not stitch two fields together into a match', () => {
    // "Toyota" + "Vios" must not read as "toyotavios".
    expect(matchesSearch('toyotavios', job)).toBe(false);
  });

  it('skips empty fields without matching on them', () => {
    expect(matchesSearch('undefined', ['คุณ บี', null, undefined, ''])).toBe(false);
  });
});
