import { loadDailyReport } from '@/app/(app)/daily-report/data';
import { DailyReportView } from '@/components/dailyReport/DailyReportView';

/** สรุปการเงินประจำวัน, standalone — see ./layout.tsx. */
export default async function StandaloneReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const props = await loadDailyReport(await searchParams);
  return <DailyReportView {...props} basePath="/report" linksIntoPos={false} />;
}
