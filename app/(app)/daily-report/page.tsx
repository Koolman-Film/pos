import { DailyReportView } from '@/components/dailyReport/DailyReportView';

import { loadDailyReport } from './data';

/**
 * รายงานการเงินรายวัน (`/daily-report`) — the owners' daily brief, a module of
 * its own in the sidebar. Everything it shows is loaded in ./data.ts.
 */
export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const props = await loadDailyReport(await searchParams);
  return <DailyReportView {...props} />;
}
