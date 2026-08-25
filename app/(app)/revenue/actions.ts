'use server';

import { getSessionContext } from '@/lib/auth/session';

/**
 * Build the Excel workbook server-side so the export capability is re-checked
 * there (C2), exactly like บัญชี's export. `accounting.export` is the gate: a
 * sales export and an expense export are the same kind of permission, and adding
 * a second capability key would have meant another permissions migration for no
 * new decision.
 */
export async function exportRevenue(payload: {
  fileNameBase: string;
  groups: { sheetName: string; rows: Record<string, string | number>[] }[];
}): Promise<{ fileName: string; base64: string } | null> {
  const session = await getSessionContext();
  if (!session.canDo('accounting.export')) throw new Error('forbidden');

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  if (payload.groups.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'รายการขาย');
  } else {
    payload.groups.forEach((g) => {
      const ws = XLSX.utils.json_to_sheet(g.rows);
      // Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 chars.
      const sheetName = (g.sheetName || '').replace(/[:\/?*[\]]/g, '').slice(0, 31) || 'sheet';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  }
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return { fileName: `${payload.fileNameBase}-${Date.now()}.xlsx`, base64 };
}
