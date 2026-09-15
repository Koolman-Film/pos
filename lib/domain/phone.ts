/**
 * เบอร์โทร — how a phone number is typed, stored and compared.
 *
 * The shop's rule (ร้านขอ 15 ก.ย. 2569): no dashes, and a customer with more
 * than one number has them separated by commas. Numbers had been typed every
 * way — 081-234-5678, 081 234 5678, 0812345678 — so the same person could sit
 * in the registry twice without anybody noticing, and a new customer could be
 * added under a number that already belonged to someone.
 *
 * Numbers saved before the rule keep their dashes until somebody edits them,
 * so every comparison here goes by the digits and never by the text.
 */

/** A whole number is at least this long: 9 digits for a landline, 10 for a mobile. */
const MIN_DIGITS = 9;

/**
 * What a phone field accepts while typing: digits and commas, nothing else.
 *
 * Dashes, spaces and brackets simply do not go in — pasting "081-234-5678"
 * leaves "0812345678". Repeated and leading commas are dropped; a trailing one
 * stays, because it is how the next number is started.
 *
 * `;` `/` `*` and `#` also start the next number. The phone keypad a mobile
 * browser opens for a tel field has no comma on some phones, but it has `*`
 * and `#`.
 */
export function sanitizePhoneTyping(raw: string): string {
  return raw
    .replace(/[;/*#]/g, ',')
    .replace(/[^\d,]/g, '')
    .replace(/,{2,}/g, ',')
    .replace(/^,/, '');
}

/**
 * Every number in a phone field, digits only.
 *
 * Reads the old free-typed forms too — "081-234-5678 / 089-123-4567" — so a
 * number stored before the rule is still recognised as the same number.
 */
export function phoneList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,/;|]|\s{2,}/)
    .map((p) => p.replace(/\D/g, ''))
    .filter(Boolean);
}

/** The stored form: digits only, several numbers as "0812345678, 0898765432". */
export function cleanPhones(raw: string | null | undefined): string {
  return [...new Set(phoneList(raw))].join(', ');
}

/** Two phone fields hold the same numbers, however each was typed. */
export function samePhones(a: string | null | undefined, b: string | null | undefined): boolean {
  const as = new Set(phoneList(a));
  const bs = new Set(phoneList(b));
  return as.size === bs.size && [...as].every((p) => bs.has(p));
}

/**
 * The customers who already have one of these numbers.
 *
 * Only whole numbers count, so the list does not fill up with every customer
 * whose number starts "08" while the first digits are being typed. `exceptId`
 * leaves out the customer being edited, who of course has their own number.
 */
export function findPhoneOwners<T extends { id: number; phone: string }>(
  phone: string,
  customers: T[],
  exceptId?: number,
): T[] {
  const wanted = new Set(phoneList(phone).filter((p) => p.length >= MIN_DIGITS));
  if (wanted.size === 0) return [];
  return customers.filter(
    (c) => c.id !== exceptId && phoneList(c.phone).some((p) => wanted.has(p)),
  );
}
