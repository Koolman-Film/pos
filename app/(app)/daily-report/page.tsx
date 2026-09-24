import { DailyReportView } from '@/components/dailyReport/DailyReportView';

import { loadDailyReport } from './data';

/**
 * สรุปการเงินประจำวัน (`/daily-report`) — the owners' daily brief, inside the
 * POS shell. The same page stands alone at `/report` (app/(report)).
 */
export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const props = await loadDailyReport(await searchParams);
  return <DailyReportView {...props} basePath="/daily-report" />;
}
