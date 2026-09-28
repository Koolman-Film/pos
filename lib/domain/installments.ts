/**
 * งวดชำระของ PO ขายส่ง (migration 0078).
 *
 * การรับเงินหลายครั้งทำได้อยู่แล้ว สิ่งที่ไม่เคยมีคือข้อตกลงว่าจะแบ่งจ่ายกี่งวด
 * งวดละเท่าไหร่ ครบกำหนดวันไหน (ร้านแจ้ง 28 ก.ย. 2569) — และเมื่อไม่มี ระบบก็
 * พูดประโยคที่สำคัญที่สุดไม่ได้: งวดที่ 1 เลยกำหนดแล้ว ส่วนงวดที่ 2 ยังไม่ถึง
 *
 * เงินก้อนไหนเข้างวดไหน คนกรอกเลือกเอง (ร้านเลือก 28 ก.ย. 2569) แต่ของจริงมี
 * ช่องว่างเสมอ: เงินที่รับมาแล้วแต่ลืมจิ้มงวด ถ้าปล่อยให้ค้างอยู่เฉย ๆ ระบบจะ
 * ทวงงวดที่เก็บเงินไปแล้ว ซึ่งเป็นความผิดที่ลูกค้าเป็นคนรับกรรม — เงินที่ไม่ได้
 * ระบุงวดจึงไหลลงงวดที่เก่าที่สุดที่ยังค้างก่อน และส่วนที่เกินความจุของงวดที่
 * ถูกจิ้มไว้ก็ไหลต่อไปงวดถัดไป ไม่ใช่หายไปเฉย ๆ
 */

import { isReceived } from './orders';

export type Installment = {
  /** คีย์ที่การรับเงินชี้มา. */
  uid: string;
  /** งวดที่ — ลำดับที่ลูกค้าเห็นบนใบแจ้งหนี้. */
  seq?: number;
  /** กำหนดชำระของงวดนี้, `YYYY-MM-DD`. */
  dueAt: string;
  amount: number;
  note?: string;
};

export type InstallmentPayment = {
  amount: number;
  /** เฉพาะเงินที่รับจริงถึงจะนับ — เช็คที่แค่แจ้งไว้ยังไม่ใช่เงิน (0048). */
  status?: string;
  /** งวดที่คนกรอกเลือกไว้. ว่าง = ยังไม่ได้ระบุ. */
  installmentUid?: string;
};

export type InstallmentStatus = Installment & {
  /** เงินที่ลงงวดนี้แล้ว. */
  paid: number;
  /** ยังขาดอีกเท่าไหร่. */
  outstanding: number;
};

/** น้อยกว่าครึ่งสตางค์ถือว่าจ่ายครบ — เป็นเรื่องของ floating point ไม่ใช่หนี้. */
const OWES = 0.005;

const satang = (n: number) => Math.round(n * 100) / 100;

/** เรียงตามกำหนดชำระ แล้วค่อยลำดับงวด — สองงวดวันเดียวกันยังเรียงตามที่ตกลงไว้. */
export function sortedSchedule(installments: Installment[]): Installment[] {
  return [...installments].sort(
    (a, b) => a.dueAt.localeCompare(b.dueAt) || (a.seq ?? 0) - (b.seq ?? 0),
  );
}

/**
 * แต่ละงวดรับเงินไปแล้วเท่าไหร่ และยังค้างเท่าไหร่.
 *
 * ลำดับการลงเงิน: งวดที่ถูกจิ้มไว้ก่อน จนเต็มความจุของงวดนั้น ส่วนที่เหลือ —
 * ทั้งเงินที่ล้นและเงินที่ไม่ได้ระบุงวด — ไหลลงงวดที่เก่าที่สุดที่ยังค้าง
 */
export function scheduleStatus(
  installments: Installment[],
  payments: InstallmentPayment[],
): InstallmentStatus[] {
  const order = sortedSchedule(installments);
  const paid = new Map<string, number>(order.map((i) => [i.uid, 0]));
  const capacity = (uid: string) =>
    Math.max(0, (order.find((i) => i.uid === uid)?.amount ?? 0) - (paid.get(uid) ?? 0));

  let spill = 0;
  for (const p of payments) {
    if (!isReceived(p)) continue;
    const amount = Number(p.amount) || 0;
    if (amount <= 0) continue;
    const uid = p.installmentUid ?? '';
    if (uid && paid.has(uid)) {
      const take = Math.min(amount, capacity(uid));
      paid.set(uid, (paid.get(uid) ?? 0) + take);
      spill += amount - take;
    } else {
      spill += amount;
    }
  }

  for (const inst of order) {
    if (spill <= 0) break;
    const take = Math.min(spill, capacity(inst.uid));
    if (take <= 0) continue;
    paid.set(inst.uid, (paid.get(inst.uid) ?? 0) + take);
    spill -= take;
  }

  return order.map((inst) => {
    const already = satang(paid.get(inst.uid) ?? 0);
    return {
      ...inst,
      paid: already,
      outstanding: satang(Math.max(0, (Number(inst.amount) || 0) - already)),
    };
  });
}

/** งวดที่เลยกำหนดแล้วและยังเก็บไม่ครบ. */
export function overdueInstallments(
  installments: Installment[],
  payments: InstallmentPayment[],
  today: string,
): InstallmentStatus[] {
  return scheduleStatus(installments, payments).filter(
    (i) => i.dueAt < today && i.outstanding > OWES,
  );
}

/** งวดที่จะถึงกำหนดภายใน `days` วัน และยังเก็บไม่ครบ. */
export function dueSoonInstallments(
  installments: Installment[],
  payments: InstallmentPayment[],
  today: string,
  horizon: string,
): InstallmentStatus[] {
  return scheduleStatus(installments, payments).filter(
    (i) => i.dueAt >= today && i.dueAt <= horizon && i.outstanding > OWES,
  );
}

/** ยอดรวมของตารางงวด — ใช้เทียบกับยอด PO เพื่อเตือนว่าตกลงกันไม่ครบ. */
export function scheduleTotal(installments: Installment[]): number {
  return satang(installments.reduce((sum, i) => sum + (Number(i.amount) || 0), 0));
}
