'use client';

// Client wrapper around the shared PeriodShopFilter (Task 11). The prototype
// recomputed everything client-side from in-memory arrays; in the port the data
// is aggregated server-side, so each control writes its value into the URL query
// string and the Dashboard page (a Server Component) re-queries for the new
// shop/period. State therefore lives in the URL, not `useState`.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { PeriodShopFilter, type Shop } from '@/components/ui/PeriodShopFilter';

export function DashboardFilter({
  shopFilter,
  period,
  periodValue,
  rangeStart,
  rangeEnd,
  allowAllShops,
  shopOptions,
}: {
  shopFilter: string;
  period: string;
  periodValue: string;
  rangeStart: string;
  rangeEnd: string;
  allowAllShops: boolean;
  shopOptions: Shop[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const set = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <PeriodShopFilter
      shopFilter={shopFilter}
      setShopFilter={(v) => set({ shop: v })}
      period={period}
      setPeriod={(v) => set({ period: v })}
      periodValue={periodValue}
      setPeriodValue={(v) => set({ pv: v })}
      rangeStart={rangeStart}
      setRangeStart={(v) => set({ rs: v })}
      rangeEnd={rangeEnd}
      setRangeEnd={(v) => set({ re: v })}
      allowAllShops={allowAllShops}
      shopOptions={shopOptions}
    />
  );
}
