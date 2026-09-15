import { describe, it, expect } from 'vitest';

import {
  cleanPhones,
  findPhoneOwners,
  phoneList,
  samePhones,
  sanitizePhoneTyping,
} from '@/lib/domain/phone';

/** เบอร์โทร: ไม่ใส่ขีด หลายเบอร์คั่นด้วย , และเบอร์ซ้ำต้องเห็นได้. */

describe('sanitizePhoneTyping', () => {
  it('keeps digits and commas only', () => {
    expect(sanitizePhoneTyping('081-234-5678')).toBe('0812345678');
    expect(sanitizePhoneTyping('(081) 234 5678')).toBe('0812345678');
  });

  it('lets a second number be started with a comma', () => {
    expect(sanitizePhoneTyping('0812345678,')).toBe('0812345678,');
    expect(sanitizePhoneTyping('0812345678, 089-876-5432')).toBe('0812345678,0898765432');
  });

  it('starts the next number from a keypad without a comma', () => {
    expect(sanitizePhoneTyping('0812345678*089')).toBe('0812345678,089');
    expect(sanitizePhoneTyping('0812345678#089')).toBe('0812345678,089');
  });

  it('drops doubled and leading commas', () => {
    expect(sanitizePhoneTyping(',0812345678,,089')).toBe('0812345678,089');
  });
});

describe('phoneList / cleanPhones', () => {
  it('reads numbers typed before the rule', () => {
    expect(phoneList('081-234-5678 / 089-876-5432')).toEqual(['0812345678', '0898765432']);
  });

  it('stores several numbers comma-separated, digits only, once each', () => {
    expect(cleanPhones('081-234-5678,0898765432,0812345678,')).toBe('0812345678, 0898765432');
  });

  it('stores nothing for an empty field', () => {
    expect(cleanPhones('  ')).toBe('');
    expect(cleanPhones(null)).toBe('');
  });
});

describe('samePhones', () => {
  it('matches the same numbers however they were typed, in any order', () => {
    expect(samePhones('081-234-5678', '0812345678')).toBe(true);
    expect(samePhones('0898765432, 0812345678', '081-234-5678 / 089-876-5432')).toBe(true);
    expect(samePhones('0812345678', '0812345678, 0898765432')).toBe(false);
  });
});

describe('findPhoneOwners', () => {
  const customers = [
    { id: 1, name: 'คุณ เอ', phone: '081-234-5678' },
    { id: 2, name: 'คุณ บี', phone: '0891112222, 053123456' },
    { id: 3, name: 'คุณ ซี', phone: '' },
  ];

  it('finds a customer who already has the number, even stored with dashes', () => {
    expect(findPhoneOwners('0812345678', customers).map((c) => c.name)).toEqual(['คุณ เอ']);
  });

  it('checks every number typed', () => {
    expect(findPhoneOwners('0800000000,053123456', customers).map((c) => c.name)).toEqual([
      'คุณ บี',
    ]);
  });

  it('says nothing while a number is still being typed', () => {
    expect(findPhoneOwners('08', customers)).toEqual([]);
    expect(findPhoneOwners('', customers)).toEqual([]);
  });

  it('leaves out the customer being edited', () => {
    expect(findPhoneOwners('0812345678', customers, 1)).toEqual([]);
  });
});
