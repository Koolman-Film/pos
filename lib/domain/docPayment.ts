/**
 * สรุปการชำระเงินของเอกสารหนึ่งใบ (ใบงาน หรือ PO) — for the รายได้ report
 * (ร้านขอ 22 ก.ย. 2569: "ยังขาดข้อมูลการชำระเงิน").
 *
 * The report is one row per product line, but money is paid against the whole
 * document, so the summary is a property of the document. The methods and the
 * status read the same on every line; the amounts go on the document's first
 * line only (see `PaymentSummary.paid`), or summing the column in Excel would
 * count a ticket's payment once per product on it.
 */
export type PaymentSummary = {
  /** Every method money came in by, in the order first used: "เงินสด, โอน กสิกร". */
  methods: string;
  /** ชำระครบ / ค้างชำระ / ยังไม่ชำระ. */
  status: string;
  paid: number;
  due: number;
};

export const PAY_STATUS = {
  full: 'ชำระครบ',
  partial: 'ค้างชำระ',
  none: 'ยังไม่ชำระ',
} as const;

export function summarizePayments(
  total: number,
  payments: { amount: number; method: string }[],
): PaymentSummary {
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const methods = [
    ...new Set(
      payments
        .filter((p) => Number(p.amount || 0) !== 0)
        .map((p) => (p.method || '').trim())
        .filter(Boolean),
    ),
  ].join(', ');
  const due = Math.max(0, Math.round((total - paid) * 100) / 100);
  const status = paid <= 0 ? PAY_STATUS.none : due > 0 ? PAY_STATUS.partial : PAY_STATUS.full;
  return { methods, status, paid, due };
}
