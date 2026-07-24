'use client';

export type PillColor = { bg: string; text: string; dot: string };

/**
 * Ported from reference/v0.4/finnix-film.html:2470-2476.
 *
 * NOTE ON THE PROP TYPE: the plan writes the signature as
 *   `StatusPill(props: { label: string; colorMap: { bg: string; text: string; dot: string } })`
 * but every prototype call site (:3436, :3518, :3868) passes a *keyed map* of
 * label -> colour, and the prototype body does `colorMap[label]`. To keep both
 * the plan's literal signature and the prototype's real call sites working, the
 * prop accepts either shape: a flat `{bg,text,dot}` is used directly, anything
 * else is treated as a `Record<label, {bg,text,dot}>` lookup (prototype behavior).
 */
function isPillColor(v: PillColor | Record<string, PillColor>): v is PillColor {
  const o = v as Partial<PillColor>;
  return typeof o.bg === 'string' && typeof o.text === 'string' && typeof o.dot === 'string';
}

export function StatusPill({
  label,
  colorMap,
}: {
  label: string;
  colorMap: PillColor | Record<string, PillColor>;
}) {
  const c: PillColor = isPillColor(colorMap)
    ? colorMap
    : (colorMap[label] ?? { bg: '#F1EDE7', text: '#6B5F55', dot: '#B5AAA1' });
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"
      style={{ background: c.bg, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }}></span>
      {label}
    </span>
  );
}
