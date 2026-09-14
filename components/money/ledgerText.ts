import type { LedgerEntry } from '@/components/dashboard/moneyFlow';

/**
 * What a ledger line IS, in words — shared by the screen and the Excel export so
 * the two never describe the same baht differently.
 */
export function ledgerEntryTitle(
  e: LedgerEntry,
  nameOf: (id: number | null | undefined) => string,
): string {
  switch (e.kind) {
    case 'receipt':
      if (e.ref?.kind === 'ticket') return 'รับชำระใบงาน';
      if (e.ref?.kind === 'order') return 'รับชำระขายส่ง';
      return 'รับเงิน';
    case 'expense':
      return 'ค่าใช้จ่าย';
    case 'transfer-in':
      return `โอนเข้า จาก ${nameOf(e.counterpartId)}`;
    case 'transfer-out':
      return `โอนออก ไป ${nameOf(e.counterpartId)}`;
  }
}

/** Customer, plate, category, cheque — whatever says whose money this was. */
export function ledgerEntryDetail(e: LedgerEntry): string {
  return [e.ref?.title, e.ref?.detail, e.note]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' · ');
}
