'use client';

export type Shop = { id: string; name: string };

/**
 * Ported from reference/v0.4/finnix-film.html:2477-2525 (shared period + shop filter bar).
 *
 * The prototype defaults `shopOptions` to the module-level `SHOPS` constant. In the
 * port the shop list comes from the database via the session context, so the default
 * is an empty array and every call site passes `shopOptions={accessibleShops}`.
 */
export function PeriodShopFilter({
  shopFilter,
  setShopFilter,
  period,
  setPeriod,
  periodValue,
  setPeriodValue,
  rangeStart,
  setRangeStart,
  rangeEnd,
  setRangeEnd,
  allowAllShops = true,
  shopOptions = [],
}: {
  shopFilter: string;
  setShopFilter: (s: string) => void;
  period: string;
  setPeriod: (p: string) => void;
  periodValue: string;
  setPeriodValue: (v: string) => void;
  rangeStart: string;
  setRangeStart: (v: string) => void;
  rangeEnd: string;
  setRangeEnd: (v: string) => void;
  allowAllShops?: boolean;
  shopOptions?: Shop[];
}) {
  return (
    <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
      {allowAllShops ? (
        <select
          value={shopFilter}
          onChange={(e) => setShopFilter(e.target.value)}
          aria-label="เลือกสาขา"
          className="field text-sm px-3 py-2 font-medium"
        >
          <option value="all">ทุกร้าน ({shopOptions.length})</option>
          {shopOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={shopFilter}
          onChange={(e) => setShopFilter(e.target.value)}
          aria-label="เลือกสาขา"
          className="field text-sm px-3 py-2 font-medium"
        >
          {shopOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <div
        className="flex rounded-xl overflow-hidden"
        style={{ border: '1.5px solid var(--line)' }}
      >
        {(
          [
            ['today', 'วันนี้'],
            ['month', 'รายเดือน'],
            ['year', 'รายปี'],
            ['range', 'ช่วงเวลา'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className="text-xs px-3 py-2 font-semibold"
            style={{
              background: period === key ? 'var(--primary)' : 'transparent',
              color: period === key ? '#fff' : 'var(--ink-soft)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {period === 'today' && (
        <span
          className="text-xs px-3 py-2 rounded-lg font-medium"
          style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}
        >
          <i className="fa-regular fa-calendar mr-1.5"></i>
          {new Date().toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </span>
      )}
      {period === 'month' && (
        <input
          type="month"
          value={periodValue}
          onChange={(e) => setPeriodValue(e.target.value)}
          className="field text-sm px-3 py-2"
        />
      )}
      {period === 'year' && (
        <select
          value={periodValue}
          onChange={(e) => setPeriodValue(e.target.value)}
          aria-label="เลือกปี"
          className="field text-sm px-3 py-2"
        >
          {[2569, 2568, 2567].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
      {period === 'range' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="field text-sm px-3 py-2"
          />
          <i className="fa-solid fa-arrow-right text-xs" style={{ color: 'var(--ink-faint)' }}></i>
          <input
            type="date"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            className="field text-sm px-3 py-2"
          />
        </div>
      )}
    </div>
  );
}
