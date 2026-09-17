/**
 * เคลมประกันได้ไหม — the cover as the service visit form sees it.
 *
 * The same three rules `save_service_visit` enforces (migration 0059), asked
 * before saving so the form can say why a policy cannot be used instead of
 * letting the database refuse it:
 *   - the visit day is inside the cover period;
 *   - the policy has pieces left, not counting this visit's own earlier claim;
 *   - the pieces asked for fit in what is left, and there is at least one.
 *
 * Dates are `YYYY-MM-DD` strings, compared as strings — the policy's dates are
 * calendar days, not instants.
 */

type Claimed = { bigUsed: number; smallUsed: number; serviceVisitId?: number | null };
type Cover = {
  bigPieces: number;
  smallPieces: number;
  startsAt: string;
  endsAt: string;
  claims: Claimed[];
};

export type CoverLeft = { big: number; small: number };

export type CoverCheck = {
  ok: boolean;
  /** Why it cannot be used; empty when it can. */
  reason: string;
  left: CoverLeft;
};

/** What is left, leaving out the claim already made at `exceptVisitId`. */
export function coverLeft(p: Cover, exceptVisitId?: number): CoverLeft {
  const counted = p.claims.filter(
    (c) => exceptVisitId === undefined || c.serviceVisitId !== exceptVisitId,
  );
  const usedBig = counted.reduce((n, c) => n + Number(c.bigUsed || 0), 0);
  const usedSmall = counted.reduce((n, c) => n + Number(c.smallUsed || 0), 0);
  return {
    big: Math.max(Number(p.bigPieces || 0) - usedBig, 0),
    small: Math.max(Number(p.smallPieces || 0) - usedSmall, 0),
  };
}

export function checkCover(p: Cover, day: string, exceptVisitId?: number): CoverCheck {
  const left = coverLeft(p, exceptVisitId);
  if (p.startsAt && day < p.startsAt) {
    return { ok: false, reason: 'ประกันยังไม่เริ่มคุ้มครอง', left };
  }
  if (p.endsAt && day > p.endsAt) {
    return { ok: false, reason: 'ประกันหมดอายุแล้ว', left };
  }
  if (left.big <= 0 && left.small <= 0) {
    return { ok: false, reason: 'ใช้ความคุ้มครองครบแล้ว', left };
  }
  return { ok: true, reason: '', left };
}

/** The message to show before saving, or null when the claim can go through. */
export function claimProblem(check: CoverCheck, bigUsed: number, smallUsed: number): string | null {
  if (!check.ok) return check.reason;
  const big = Math.max(Number(bigUsed || 0), 0);
  const small = Math.max(Number(smallUsed || 0), 0);
  if (big + small === 0) return 'ระบุจำนวนชิ้นที่เคลมอย่างน้อย 1 ชิ้น';
  if (big > check.left.big || small > check.left.small) {
    return `เคลมเกินความคุ้มครองที่เหลือ (เหลือ ${check.left.big} ชิ้นใหญ่, ${check.left.small} ชิ้นเล็ก)`;
  }
  return null;
}
