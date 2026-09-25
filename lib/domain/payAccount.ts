/**
 * บัญชีรับชำระ — the money account a document tells the customer to pay into
 * (migration 0062): the wholesale ใบแจ้งหนี้ and the Book งาน ใบเสนอราคา.
 *
 * Chosen from the branch's own แหล่งเงิน (การจัดการเงิน/บัญชี), so what the
 * paper says and where the money is then expected to land are the same record.
 */

export const BRANCH_OWNER = 'สาขา';
export const FINNIX_OWNER = 'Finnix';
export type AccountOwner = typeof BRANCH_OWNER | typeof FINNIX_OWNER;

export type PayAccount = {
  id: number;
  shop: string;
  name: string;
  /** money_accounts.kind — bank / cash / edc / petty / credit. */
  kind: string;
  accountNo: string;
  /**
   * เงินในบัญชีนี้เป็นของใคร (migration 0069).
   *
   * NOT what decides revenue — the goods sold decide that. This says where the
   * cash is, so รายได้ Finnix that landed in a branch account can be told apart
   * from รายได้ Finnix that went straight where it belongs.
   */
  owner?: AccountOwner;
  /** ชื่ออื่นที่หมายถึงบัญชีนี้ — how an old payment's wording still finds it. */
  matchNames?: string[];
  /**
   * ตั้งแต่เมื่อไหร่ที่ระบบรู้ว่าเงินในบัญชีนี้เป็นของใคร (migration 0070).
   *
   * Before this moment nobody had been asked the question, so a job taken
   * earlier was recorded under rules that did not include it and is not
   * judged by it.
   */
  ownerSetAt?: string;
};

/**
 * บัญชีที่รับเงินก้อนนี้ไว้ — resolved the way the balances resolve it.
 *
 * A payment stores the แหล่งเงิน as free text, so it is matched against each
 * account's own name and its `match_names`, and the FIRST account in the
 * branch that claims the label wins. That is exactly the rule
 * `buildMoneySources` uses; a second rule here would let this screen and the
 * money register disagree about where the same baht went.
 */
export function accountForLabel(
  accounts: PayAccount[],
  shop: string,
  label: string,
): PayAccount | null {
  const wanted = (label ?? '').trim();
  if (!wanted) return null;
  return (
    accounts.find((a) => a.shop === shop && [a.name, ...(a.matchNames ?? [])].includes(wanted)) ??
    null
  );
}

/** ใครเป็นเจ้าของเงินที่เข้าบัญชีนี้ — สาขา unless the shop said otherwise. */
export const ownerOf = (a: Pick<PayAccount, 'owner'> | null | undefined): AccountOwner =>
  a?.owner === FINNIX_OWNER ? FINNIX_OWNER : BRANCH_OWNER;

/**
 * ประเภทที่ลูกค้าจ่ายเข้าไม่ได้ และเหตุผล.
 *
 * เงินสดย่อย is the counter's float — money goes OUT of it to buy things, and
 * nobody pays a bill into it. บัตรเครดิตของร้าน is the shop's own card for
 * paying suppliers; a customer's money cannot land on it either.
 *
 * Everything else can take a customer's money and so appears in every
 * รับเงิน picker. The reason is here rather than inline in the filter because
 * การจัดการเงิน/บัญชี prints it beside the account: an account quietly missing
 * from the ใบงาน dropdown with nothing on screen to explain it cost the shop a
 * morning (ร้านแจ้ง 24 ก.ย. 2569).
 */
export const NON_PAYABLE_REASON: Record<string, string> = {
  petty: 'เงินสดย่อยเป็นเงินทอน/เงินสำรองของหน้าร้าน ลูกค้าจ่ายเข้าไม่ได้',
  credit: 'บัตรเครดิตของร้านไว้จ่ายออก ไม่ใช่บัญชีรับเงินจากลูกค้า',
};

/** Why a customer cannot be sent to this account, or null when they can. */
export function nonPayableReason(a: Pick<PayAccount, 'kind'>): string | null {
  return NON_PAYABLE_REASON[a.kind] ?? null;
}

/**
 * The accounts a customer can actually be sent to.
 *
 * เครื่องรูดบัตร counts: the customer's money genuinely lands there before it
 * settles into the bank, which is what the shop's own EDC balance shows.
 */
export function payableAccounts(accounts: PayAccount[], shop: string): PayAccount[] {
  return accounts.filter((a) => a.shop === shop && !nonPayableReason(a));
}

/** How the account reads on paper: its name, then its number when it has one. */
export function payAccountLine(a: Pick<PayAccount, 'name' | 'accountNo'>): string {
  const no = a.accountNo.trim();
  return no ? `${a.name} · เลขที่บัญชี ${no}` : a.name;
}

/**
 * วิธีชำระที่ตั้งให้แถวรับเงินใหม่ — the branch's counter cash when it has one,
 * since that is how most payments at the counter arrive; otherwise its first
 * payable account; otherwise nothing, and the row asks for one.
 *
 * It used to be the literal "เงินสด", which is not the name of any account —
 * the money only reached a balance because someone had listed that word under
 * an account's match names.
 */
export function defaultPayMethod(accounts: PayAccount[], shop: string): string {
  const payable = payableAccounts(accounts, shop);
  return (payable.find((a) => a.kind === 'cash') ?? payable[0])?.name ?? '';
}

/**
 * A method saved before 0064, or on an account since renamed or closed. It
 * stays selectable so the record reads as it was, marked so nobody picks it
 * for new money thinking it is one of the branch's accounts.
 */
export const LEGACY_METHOD_SUFFIX = ' (ชื่อเดิม)';
