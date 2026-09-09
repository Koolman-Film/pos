/**
 * เปรียบเทียบรายสาขา — every branch on one screen, side by side.
 *
 * The dashboard could only ever answer one of two questions: "how is this
 * branch doing" or "how is the business doing". Management asked the third one
 * — "how are the branches doing against each other" — and the only way to get
 * it was to pick each branch from the filter in turn and write the numbers down
 * on paper.
 *
 * Every figure here is the SAME arithmetic the cards above it use, evaluated
 * once per branch instead of once for the current filter. That matters more
 * than it sounds: a comparison table that computed ยอดขาย its own way would
 * eventually disagree with the ยอดขาย card on the same screen, and then neither
 * number could be trusted.
 */

export type BranchRow = {
  shop: string;
  name: string;
  /** ยอดขาย in the period — delivered work plus ประกัน sold, เงินรอคืน excluded. */
  revenue: number;
  /** ค่าใช้จ่าย the branch paid for ITSELF in the period. */
  expenses: number;
  /** revenue − expenses. Not a margin: cost of goods is not in `expenses`. */
  profit: number;
  /** How many jobs the branch took in, in the period. */
  jobs: number;
  /** ยอดค้างรับ as of now, not period-scoped — same as the card above. */
  receivable: number;
  /**
   * ยอดค้างจ่าย as of now — bills accepted and not yet paid.
   *
   * Beside ค้างรับ rather than inside ค่าใช้จ่าย: an unpaid bill has not left
   * the branch yet, so counting it as spending would understate คงเหลือ by
   * money still in the bank. It is a debt to settle, and the card has to say
   * so out loud — a branch can look the most profitable of the five and be
   * carrying the largest unpaid pile at the same time.
   */
  payable: number;
  /**
   * ค้างรับ − ค้างจ่าย. What the branch is owed net of what it owes.
   *
   * Derived rather than eyeballed from the two columns beside it, because that
   * subtraction is the follow-up question every time: a branch owed 40,900 and
   * owing 108,400 is not a branch with money coming, and the sign is the thing
   * you act on.
   */
  netDue: number;
  /** เงินรอคืน Finnix: collected here, owed to another shop (migration 0031). */
  heldForFinnix: number;
};

export type BranchComparison = {
  rows: BranchRow[];
  total: Omit<BranchRow, 'shop' | 'name'>;
};

type Shop = { id: string; name: string };

/**
 * The per-branch inputs, each already reduced to a number by the caller.
 *
 * Deliberately not "here are all the tickets, work it out": the page owns the
 * definitions of ยอดขาย and ค่าใช้จ่าย (which policies count, which expenses are
 * จ่ายแทน, how a ticket total handles discounts) and re-implementing any of
 * them here is how two figures on one screen start to disagree.
 */
export type BranchFigures = (shop: string) => Omit<BranchRow, 'shop' | 'name' | 'netDue'>;

export function buildBranchComparison(shops: Shop[], figures: BranchFigures): BranchComparison {
  const rows = shops
    .map((s) => {
      const f = figures(s.id);
      return { shop: s.id, name: s.name, ...f, netDue: f.receivable - f.payable };
    })
    // Highest ยอดขาย first: the question being asked is who is ahead, and a
    // table in the shops' own sort order makes that a reading exercise.
    .sort((a, b) => b.revenue - a.revenue);

  const sum = (pick: (r: BranchRow) => number) => rows.reduce((n, r) => n + pick(r), 0);

  return {
    rows,
    total: {
      revenue: sum((r) => r.revenue),
      expenses: sum((r) => r.expenses),
      profit: sum((r) => r.profit),
      jobs: sum((r) => r.jobs),
      receivable: sum((r) => r.receivable),
      payable: sum((r) => r.payable),
      netDue: sum((r) => r.netDue),
      heldForFinnix: sum((r) => r.heldForFinnix),
    },
  };
}
