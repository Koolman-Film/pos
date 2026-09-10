import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MECHANICAL WCAG AA GUARD for every hard-coded foreground/background pair.
 *
 * Status badges in this app are written as literal hex pairs at the call site —
 * `style={{ background: '#E6EFDC', color: '#4C7A3E' }}` for an inline badge, or
 * `{ bg, text, dot }` for a StatusPill colour map. There is no palette module to
 * review, so a pair that fails contrast is invisible until somebody looks at it.
 *
 * The axe pass in tests/e2e/a11y.spec.ts only sees pairs that happen to be ON
 * SCREEN when it runs. That is how three failures hid here: axe flagged the
 * handover badge on the dashboard (4.36:1) but said nothing about the green
 * StatusPill fill shared by Accounting, Commission and Stock (4.27:1) or the
 * amber dashboard badge (3.76:1) — those rows simply were not rendered in the
 * seeded data at scan time. Both were worse than the one that got caught.
 *
 * This test does not care what is rendered. It reads the source, so a bad pair
 * fails the moment it is typed, in a module nobody opened.
 *
 * THE THRESHOLD IS 4.5:1, not 3:1. Every badge in this app is `text-xs` (12px),
 * which is normal-size text under WCAG — the 3:1 large-text allowance needs 24px,
 * or 18.66px when bold. If you add a genuinely large-text pair, put it in
 * LARGE_TEXT_PAIRS with the class names that make it large.
 *
 * If you are here because this test failed: darken the foreground until it
 * clears 4.5:1. `#3F6B33` is the established darker green for tinted fills
 * (see components/tickets/detail/InsuranceSection.tsx) and `#8A5A12` the amber;
 * `#4C7A3E` stays correct for figures on white or --paper, which do pass.
 */

const ROOT = join(__dirname, '../../..');
const SCAN_DIRS = ['components', 'app'];

/**
 * Pairs exempt from the 4.5:1 floor because the text really is large. Keyed by
 * `FG|BG`, valued with the reason so an exemption cannot be added silently.
 */
const LARGE_TEXT_PAIRS: Record<string, string> = {};

/** WCAG 2.1 relative luminance. */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The two ways this codebase writes a colour pair. Both put the background
 * first, which is what lets a single regex pull them out reliably.
 */
const PAIR_PATTERNS = [
  /background:\s*'(#[0-9A-Fa-f]{6})',\s*color:\s*'(#[0-9A-Fa-f]{6})'/g,
  /bg:\s*'(#[0-9A-Fa-f]{6})',\s*text:\s*'(#[0-9A-Fa-f]{6})'/g,
];

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full));
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

type Pair = { file: string; line: number; fg: string; bg: string; ratio: number };

function collectPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of tsxFilesUnder(join(ROOT, dir))) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of PAIR_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source))) {
          const bg = match[1].toUpperCase();
          const fg = match[2].toUpperCase();
          pairs.push({
            file: file.slice(ROOT.length + 1),
            line: source.slice(0, match.index).split('\n').length,
            fg,
            bg,
            ratio: contrastRatio(fg, bg),
          });
        }
      }
    }
  }
  return pairs;
}

describe('badge colour contrast', () => {
  const pairs = collectPairs();

  it('finds the badge pairs at all (guards the regex against a refactor)', () => {
    // If a future change moves these into a palette module, this test stops
    // seeing anything and would pass vacuously. Fail loudly instead so whoever
    // does that refactor points this scanner at the new home.
    expect(pairs.length).toBeGreaterThan(10);
  });

  it('every hard-coded pair meets WCAG AA (4.5:1) for 12px text', () => {
    const failures = pairs
      .filter((p) => p.ratio < 4.5)
      .filter((p) => !(`${p.fg}|${p.bg}` in LARGE_TEXT_PAIRS))
      .map((p) => `${p.file}:${p.line} — ${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)}:1`);

    expect(failures).toEqual([]);
  });
});
