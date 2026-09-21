/**
 * บัญชีรับชำระ — the money account a document tells the customer to pay into
 * (migration 0062): the wholesale ใบแจ้งหนี้ and the Book งาน ใบเสนอราคา.
 *
 * Chosen from the branch's own แหล่งเงิน (การจัดการเงิน/บัญชี), so what the
 * paper says and where the money is then expected to land are the same record.
 */

export type PayAccount = {
  id: number;
  shop: string;
  name: string;
  /** money_accounts.kind — bank / cash / petty / credit. */
  kind: string;
  accountNo: string;
};

/**
 * The accounts a customer can actually be sent to.
 *
 * Not เงินสดย่อย — that is the counter's float, nobody pays into it — and not
 * บัตรเครดิตบริษัท, which is the shop's own card for paying bills. What is left
 * is where a customer's money can go: the bank accounts, and เงินสดหน้าร้าน for
 * a customer who will pay at the counter.
 */
export function payableAccounts(accounts: PayAccount[], shop: string): PayAccount[] {
  return accounts.filter((a) => a.shop === shop && a.kind !== 'petty' && a.kind !== 'credit');
}

/** How the account reads on paper: its name, then its number when it has one. */
export function payAccountLine(a: Pick<PayAccount, 'name' | 'accountNo'>): string {
  const no = a.accountNo.trim();
  return no ? `${a.name} · เลขที่บัญชี ${no}` : a.name;
}
