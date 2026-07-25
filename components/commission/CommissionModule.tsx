'use client';

import { useState, useTransition } from 'react';

import { fmt } from '@/lib/domain/format';
import { currentMonthValue, daysAgoValue, todayValue } from '@/lib/domain/now';
import { PeriodShopFilter, type Shop } from '@/components/ui/PeriodShopFilter';
import { StatusPill } from '@/components/ui/StatusPill';

/**
 * Ported from reference/v0.4/finnix-film.html:3463-3527 (the Commission module).
 *
 * SCOPE — this module is rule *configuration only*, exactly as the prototype is.
 * The prototype computes no payouts anywhere (there is no `calcCommission`/payout
 * function in the source), so the port adds none. It reads existing rules and, for
 * a caller with `commission.addRule`, creates new ones. Nothing here calculates an
 * amount owed to anyone.
 *
 * Divergences from the prototype, all forced by the port's architecture:
 *   - The prototype held `rules`/`setRules` in client state and mutated it directly.
 *     Here `rules` arrive as props from the Server Component page (the source of
 *     truth is `commission_rules` + `commission_rule_teams`), and adding a rule calls
 *     the `addRuleAction` Server Action; the page re-renders via `revalidatePath`.
 *   - The gate: the plan's test passes `canDo` as a function, but a Server Component
 *     cannot hand a closure to a Client Component (only serializable props cross the
 *     boundary — see the Sidebar precedent). So the page passes the pre-evaluated
 *     `canAddRule` boolean instead; `canDo` remains accepted for the test. The
 *     effective gate is `canAddRule ?? canDo?.('commission.addRule') ?? false`.
 */

/** A commission rule flattened for display. `shop` is a shop id, or 'all' for shop-wide. */
export type CommissionRuleView = {
  id: number;
  category: string;
  name: string;
  type: string;
  value: number;
  shop: string;
  team: string[];
  active: boolean;
};

/** Payload handed to the add-rule Server Action. `shop` is already resolved to a concrete id. */
export type NewCommissionRuleInput = {
  category: string;
  name: string;
  type: string;
  value: number;
  shop: string;
  team: string[];
};

export function CommissionModule({
  rules,
  canDo,
  canAddRule,
  addRuleAction,
  accessibleShops = [],
  canSeeAllShops = true,
}: {
  rules: CommissionRuleView[];
  canDo?: (capabilityKey: string) => boolean;
  canAddRule?: boolean;
  addRuleAction?: (input: NewCommissionRuleInput) => Promise<void>;
  accessibleShops?: Shop[];
  canSeeAllShops?: boolean;
}) {
  const canAdd = canAddRule ?? canDo?.('commission.addRule') ?? false;

  const [showAdd, setShowAdd] = useState(false);
  const [shopFilter, setShopFilter] = useState(
    canSeeAllShops ? 'all' : accessibleShops[0]?.id || 'all',
  );
  const [period, setPeriod] = useState('today');
  const [periodValue, setPeriodValue] = useState(() => currentMonthValue());
  const [rangeStart, setRangeStart] = useState(() => daysAgoValue(6));
  const [rangeEnd, setRangeEnd] = useState(() => todayValue());
  const [nr, setNr] = useState<{
    category: string;
    name: string;
    type: string;
    value: number | string;
    team: string;
  }>({ category: 'ค่าคอมพนักงาน', name: '', type: 'percent_of_sale', value: 0, team: '' });
  const [isPending, startTransition] = useTransition();

  const filteredRules =
    shopFilter === 'all' ? rules : rules.filter((r) => r.shop === 'all' || r.shop === shopFilter);
  const categories = [...new Set(filteredRules.map((r) => r.category))];

  function addRule() {
    if (!addRuleAction) return;
    const shop = shopFilter === 'all' ? accessibleShops[0]?.id || 'cm' : shopFilter;
    const input: NewCommissionRuleInput = {
      category: nr.category,
      name: nr.name,
      type: nr.type,
      value: Number(nr.value),
      shop,
      team: nr.team
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    startTransition(async () => {
      await addRuleAction(input);
      setShowAdd(false);
      setNr({ category: 'ค่าคอมพนักงาน', name: '', type: 'percent_of_sale', value: 0, team: '' });
    });
  }

  return (
    <div className="fade-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold">ค่าคอมมิชชั่น</h1>
        {canAdd && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className={`text-sm px-4 py-2 rounded-xl font-semibold flex items-center gap-2 ${
              showAdd ? 'btn-primary' : 'btn-outline'
            }`}
          >
            <i className="fa-solid fa-plus"></i>เพิ่มกฎใหม่
          </button>
        )}
      </div>
      <PeriodShopFilter
        shopFilter={shopFilter}
        setShopFilter={setShopFilter}
        period={period}
        setPeriod={setPeriod}
        periodValue={periodValue}
        setPeriodValue={setPeriodValue}
        rangeStart={rangeStart}
        setRangeStart={setRangeStart}
        rangeEnd={rangeEnd}
        setRangeEnd={setRangeEnd}
        allowAllShops={canSeeAllShops}
        shopOptions={accessibleShops}
      />
      {showAdd && (
        <div className="card p-5 mb-4 fade-page">
          <p className="text-sm font-semibold mb-3">สร้างกฎค่าคอมใหม่</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                หมวด
              </label>
              <select
                value={nr.category}
                onChange={(e) => setNr({ ...nr, category: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              >
                <option>ค่าคอมพนักงาน</option>
                <option>ค่าคอมช่องทางจอง</option>
                <option>อื่นๆ</option>
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ชื่อกฎ
              </label>
              <input
                value={nr.name}
                onChange={(e) => setNr({ ...nr, name: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ประเภทการคิด
              </label>
              <select
                value={nr.type}
                onChange={(e) => setNr({ ...nr, type: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              >
                <option value="percent_of_sale">% จากยอดขาย</option>
                <option value="fixed_per_job">จำนวนเงินคงที่ต่องาน</option>
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ค่า
              </label>
              <input
                type="number"
                value={nr.value}
                onChange={(e) => setNr({ ...nr, value: e.target.value })}
                className="field w-full text-sm px-3 py-2"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                ทีมที่แบ่งเท่าๆ กัน (คั่นด้วยจุลภาค)
              </label>
              <input
                value={nr.team}
                onChange={(e) => setNr({ ...nr, team: e.target.value })}
                placeholder="เช่น กมล, สราวุธ"
                className="field w-full text-sm px-3 py-2"
              />
            </div>
          </div>
          <button
            onClick={addRule}
            disabled={isPending}
            className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold"
          >
            บันทึกกฎ
          </button>
        </div>
      )}
      {categories.map((cat) => (
        <div key={cat} className="mb-5">
          <p
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: 'var(--ink-faint)' }}
          >
            {cat}
          </p>
          <div className="flex flex-col gap-2.5">
            {filteredRules
              .filter((r) => r.category === cat)
              .map((r) => (
                <div key={r.id} className="card p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{r.name}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>
                      {r.type === 'percent_of_sale'
                        ? `${r.value}% ของยอดขาย`
                        : `${fmt(r.value)} บาท/งาน`}{' '}
                      · หาร {r.team.length} คนเท่าๆ กัน
                    </p>
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {r.team.map((m) => (
                        <span
                          key={m}
                          className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <StatusPill
                    label={r.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
                    colorMap={{
                      ใช้งานอยู่: { bg: '#E6EFDC', text: '#4C7A3E', dot: '#6BA24F' },
                      ปิดใช้งาน: { bg: '#F1EDE7', text: '#6B5F55', dot: '#B5AAA1' },
                    }}
                  />
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
