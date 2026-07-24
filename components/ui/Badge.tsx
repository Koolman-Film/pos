export type StatusConfig = { key: string; short: string; bg: string; text: string; dot: string };

export function getStatus(statuses: StatusConfig[], key: string): StatusConfig {
  return (
    statuses.find((s) => s.key === key) ??
    statuses[0] ?? { key, short: key, bg: '#F1EDE7', text: '#6B5F55', dot: '#B5AAA1' }
  );
}

export function Badge({ status, statuses }: { status: string; statuses: StatusConfig[] }) {
  const c = getStatus(statuses, status);
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"
      style={{ background: c.bg, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }}></span>
      {c.short || status}
    </span>
  );
}
