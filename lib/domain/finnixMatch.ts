import { itemNetPrice } from '@/lib/domain/tickets';
import { accountForLabel, ownerOf, FINNIX_OWNER, type PayAccount } from '@/lib/domain/payAccount';

/**
 * จับคู่รายได้ Finnix กับแหล่งเงินที่รับเงินไว้จริง (ร้านขอ 25 ก.ย. 2569).
 *
 * Two facts about one job, recorded in two places:
 *
 *   what was SOLD    — each ticket line says รายได้สาขา or รายได้ Finnix (0068)
 *   where it LANDED  — each payment names a แหล่งเงิน, and an account says
 *                      whose money it holds (0069)
 *
 * They are supposed to agree, and when they do not it is because somebody put
 * the money in the wrong account — which nobody could see before, because the
 * system had no way to ask the second question.
 *
 * WHICH ONE IS THE REVENUE: the goods (ร้านเลือก 25 ก.ย. 2569). ยอดขายของสาขา
 * is what the branch sold; a customer paying into the wrong account is a
 * cash-handling mistake, not a sale changing hands. So nothing here feeds the
 * sales figures — this only reports the gap, and the gap is a job for somebody:
 * that much of Finnix's money is sitting in the branch's account, or the other
 * way round.
 *
 * ยังจ่ายไม่ครบ ไม่ใช่ความผิดพลาด. Until the customer has paid in full the two
 * sides cannot match, and saying so would be noise on every deposit. The gap is
 * only meaningful once the money is all in — which `settled` reports, and the
 * screen uses to decide whether to say anything at all.
 *
 * ใบงานเดิมไม่ถูกนำมาจับคู่ (ร้านขอ 25 ก.ย. 2569, migration 0070). A job opened
 * before the shop marked its Finnix accounts was recorded under rules that did
 * not include this one, and its money was reconciled by hand at the time.
 * Judging it now would put a red box on work nobody is going to redo —
 * `inScope` is false for those, and the screen stays quiet.
 */

export type MatchItem = {
  soldPrice: number | string;
  discountType?: 'percent' | 'amount' | null;
  discountValue?: number | string;
  revenueKind?: string;
};

export type MatchPayment = {
  amount: number | string;
  /** The แหล่งเงิน as recorded on the row — free text, matched to an account. */
  method: string;
};

export type FinnixMatch = {
  /** ที่ขายจริง, from the lines. */
  soldOwn: number;
  soldFinnix: number;
  /** ที่รับเงินเข้ามา, by the account each payment names. */
  paidOwn: number;
  paidFinnix: number;
  /** Money whose account nobody recognises — counted, never guessed at. */
  paidUnknown: number;
  /** The customer has paid the whole job. */
  settled: boolean;
  /** The ticket is new enough for this question to be a fair one to ask. */
  inScope: boolean;
  /**
   * เงินของ Finnix ที่อยู่ผิดที่ — positive when Finnix's money is sitting in a
   * branch account and has to go back, negative when the branch's money went
   * into the Finnix account. Zero when the two sides agree.
   */
  owedToFinnix: number;
};

const satang = (n: number) => Math.round(n * 100) / 100;

const money = (i: MatchItem) =>
  itemNetPrice({
    soldPrice: Number(i.soldPrice || 0),
    discountType: i.discountType ?? undefined,
    discountValue:
      i.discountValue != null && i.discountValue !== '' ? Number(i.discountValue) : undefined,
  });

export function matchFinnixMoney({
  items,
  payments,
  accounts,
  shop,
  ticketCreatedAt,
}: {
  items: MatchItem[];
  payments: MatchPayment[];
  /** The branch's แหล่งเงิน, each carrying whose money it holds. */
  accounts: PayAccount[];
  shop: string;
  /** `tickets.created_at`. Absent on an unsaved draft, which is as new as it gets. */
  ticketCreatedAt?: string;
}): FinnixMatch {
  /*
    The branch started answering "whose money is this account's?" on the day
    its first account was stamped. A ticket opened before that predates the
    question, so it is left alone.
  */
  const knownFrom = accounts
    .filter((a) => a.shop === shop && a.ownerSetAt)
    .map((a) => a.ownerSetAt!)
    .sort()[0];
  const inScope = !ticketCreatedAt || !knownFrom || ticketCreatedAt >= knownFrom;
  const priced = items.filter((i) => Number(i.soldPrice || 0) > 0);
  const soldFinnix = satang(
    priced.filter((i) => i.revenueKind === 'รับแทน').reduce((n, i) => n + money(i), 0),
  );
  const soldOwn = satang(
    priced.filter((i) => i.revenueKind !== 'รับแทน').reduce((n, i) => n + money(i), 0),
  );

  let paidOwn = 0;
  let paidFinnix = 0;
  let paidUnknown = 0;
  for (const p of payments) {
    const amount = Number(p.amount || 0);
    if (!amount) continue;
    const account = accountForLabel(accounts, shop, p.method);
    // An unrecognised label is NOT assumed to be the branch's: that is how a
    // mistake becomes a number nobody questions.
    if (!account) paidUnknown += amount;
    else if (ownerOf(account) === FINNIX_OWNER) paidFinnix += amount;
    else paidOwn += amount;
  }

  const paidTotal = satang(paidOwn + paidFinnix + paidUnknown);
  return {
    soldOwn,
    soldFinnix,
    paidOwn: satang(paidOwn),
    paidFinnix: satang(paidFinnix),
    paidUnknown: satang(paidUnknown),
    settled: paidTotal >= satang(soldOwn + soldFinnix) && paidTotal > 0,
    inScope,
    owedToFinnix: satang(soldFinnix - paidFinnix),
  };
}
