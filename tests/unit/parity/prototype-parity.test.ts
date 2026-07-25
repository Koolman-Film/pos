import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MECHANICAL PARITY GUARD against reference/v0.4/finnix-film.html.
 *
 * The prototype is the behavioural source of truth for this port, and it is
 * entirely Thai-labelled. So every Thai string in it is a proxy for a
 * user-visible feature: a label, a button, a column heading, a status, a
 * confirmation. If a string exists there and nowhere in the port, that is
 * either a missing feature, a silently reworded one, or a divergence somebody
 * decided on and should have written down.
 *
 * This test is how the third possibility stays honest. Every accepted absence is
 * listed in ACCEPTED_ABSENCES with a reason; anything else fails. That makes the
 * check bidirectional — it catches a feature being dropped, and it also catches a
 * divergence being introduced without a note.
 *
 * It found real gaps when first written: the pre-installation QC checklist was
 * truncated to 6 of 20 electrical rows, the Permissions module had no
 * "รีเซ็ตค่าเริ่มต้น" button, the Stock module had lost its unsaved-changes guard,
 * and automatic stock movement was not persisted at all.
 *
 * If you are here because this test failed: either restore the feature, or add an
 * entry to ACCEPTED_ABSENCES explaining why the port deliberately differs.
 */

const ROOT = join(__dirname, '../../..');
const PROTOTYPE = join(ROOT, 'reference/v0.4/finnix-film.html');

/** Prototype module ranges → the port directories that could hold their labels. */
const MODULES: { name: string; from: number; to: number; dirs: string[] }[] = [
  { name: 'Sidebar', from: 402, to: 452, dirs: ['components/layout'] },
  { name: 'Header', from: 453, to: 498, dirs: ['components/layout'] },
  { name: 'Charts', from: 499, to: 570, dirs: ['components/charts'] },
  { name: 'JobCalendar', from: 571, to: 641, dirs: ['components/dashboard'] },
  {
    name: 'Dashboard',
    from: 642,
    to: 958,
    dirs: ['components/dashboard', 'app/(app)/dashboard'],
  },
  { name: 'TicketList', from: 959, to: 1149, dirs: ['components/tickets', 'app/(app)/tickets'] },
  { name: 'UIKit', from: 1150, to: 1309, dirs: ['components/ui', 'components/tickets'] },
  { name: 'TicketDetail', from: 1310, to: 2469, dirs: ['components/tickets', 'app/(app)/tickets'] },
  { name: 'StatusPillAndFilter', from: 2470, to: 2525, dirs: ['components/ui'] },
  {
    name: 'WholesaleList',
    from: 2526,
    to: 2689,
    dirs: ['components/wholesale', 'app/(app)/wholesale'],
  },
  {
    name: 'WholesaleDetail',
    from: 2690,
    to: 2979,
    dirs: ['components/wholesale', 'app/(app)/wholesale'],
  },
  { name: 'StockModule', from: 2980, to: 3462, dirs: ['components/stock', 'app/(app)/stock'] },
  {
    name: 'CommissionModule',
    from: 3463,
    to: 3527,
    dirs: ['components/commission', 'app/(app)/commission'],
  },
  {
    name: 'AccountingModule',
    from: 3528,
    to: 3902,
    dirs: ['components/accounting', 'app/(app)/accounting'],
  },
  {
    name: 'PermissionsModule',
    from: 3903,
    to: 4284,
    dirs: ['components/permissions', 'app/(app)/permissions'],
  },
  { name: 'LoginScreen', from: 4285, to: 4320, dirs: ['app/login', 'components/layout'] },
];

/**
 * Strings the port deliberately does not contain. Each needs a reason.
 *
 * Most entries are artifacts of matching raw Thai runs out of source: a fragment
 * of a code comment, or a label the regex clipped mid-way. Those are marked
 * `not-a-label`. The genuinely interesting ones are the behavioural divergences.
 */
const ACCEPTED_ABSENCES: Record<string, string> = {
  // --- prototype source comments, not UI ---
  'ลูกหนี้)': 'not-a-label: fragment of the prototype comment above the AR/AP block',
  'เจ้าหนี้)': 'not-a-label: same comment',
  'ใบงาน / ขายส่ง / บัญชี ----': 'not-a-label: prototype section comment',

  // --- clipped by the Thai-run regex; the label is assembled, not literal ---
  // `ตัดสต็อก...` happens to appear verbatim in migration 0010's comment, so it is
  // NOT exempt — only the return direction needs one.
  'คืนสต็อกจากใบงาน (':
    'clipped: assembled as `คืนสต็อก` + `จาก${kind}` in lib/stock/movements.ts, so no literal exists',
  'คืนสต็อกจากขายส่ง (': 'clipped: same template as the ticket variant above',

  // --- real, deliberate divergences ---
  'เร็วๆ นี้':
    'divergence: the prototype greys out unbuilt nav entries with a "coming soon" badge. Every entry is built in the port, so the state cannot occur.',
  'ระบบนี้ยืนยันตัวตนด้วยอีเมลที่แอดมินลงทะเบียนไว้เท่านั้น (ยังไม่มีรหัสผ่านจริง':
    'divergence: the prototype had no real auth and said so on the login card. The port authenticates against Supabase with real passwords, so the disclaimer would be false.',
  'เป็นระบบทดลอง)': 'divergence: tail of the same prototype-only disclaimer.',
  'คุณ (ผ่านระบบ)':
    'divergence: the prototype stamped manual withdrawals with the literal "คุณ (ผ่านระบบ)" because it had no user identity. The port records the real signed-in user name.',
};

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel);
    return /\.(ts|tsx|sql)$/.test(entry) ? [rel] : [];
  });
}

/** A run of Thai text, optionally containing digits/punctuation, at least 3 chars. */
const THAI_RUN = /[฀-๿][฀-๿0-9\s./%()-]{2,}/g;
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

const prototypeLines = readFileSync(PROTOTYPE, 'utf8').split('\n');

// Config-driven labels (statuses, option lists, permission keys) became table rows,
// so the migrations and the seed are part of the corpus, as is the shared lib.
const SHARED_DIRS = ['supabase/migrations', 'supabase', 'lib', 'components/ui'];

function corpusFor(dirs: string[]): string {
  const files = [...new Set([...dirs, ...SHARED_DIRS].flatMap(walk))];
  return collapse(files.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n'));
}

function thaiStringsIn(from: number, to: number): string[] {
  const src = prototypeLines.slice(from - 1, to).join('\n');
  const found = new Set<string>();
  for (const match of src.match(THAI_RUN) ?? []) {
    const s = collapse(match);
    if (s.length >= 3) found.add(s);
  }
  return [...found];
}

describe('prototype parity — every prototype label exists in the port', () => {
  for (const mod of MODULES) {
    it(`${mod.name} has no unexplained missing labels`, () => {
      const corpus = corpusFor(mod.dirs);
      const missing = thaiStringsIn(mod.from, mod.to)
        .filter((s) => !corpus.includes(s))
        .filter((s) => !(s in ACCEPTED_ABSENCES));

      expect(
        missing,
        missing.length
          ? `${mod.name}: ${missing.length} prototype label(s) missing from the port.\n` +
              missing.map((m) => `  - ${JSON.stringify(m)}`).join('\n') +
              `\n\nEither restore the feature, or add each string to ACCEPTED_ABSENCES with a reason.`
          : '',
      ).toEqual([]);
    });
  }

  it('every ACCEPTED_ABSENCES entry carries a reason', () => {
    for (const [text, reason] of Object.entries(ACCEPTED_ABSENCES)) {
      expect(reason.length, `"${text}" needs a real reason`).toBeGreaterThan(20);
    }
  });

  it('ACCEPTED_ABSENCES has no stale entries', () => {
    // If a string is now present everywhere, the exemption is dead weight and
    // should be deleted so the list stays meaningful.
    const wholeCorpus = corpusFor(MODULES.flatMap((m) => m.dirs));
    const allPrototypeStrings = new Set(MODULES.flatMap((m) => thaiStringsIn(m.from, m.to)));
    const stale = Object.keys(ACCEPTED_ABSENCES).filter(
      (s) => allPrototypeStrings.has(s) && wholeCorpus.includes(s),
    );
    expect(stale, `these exemptions are no longer needed: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('prototype parity — the QC checklist is complete', () => {
  /**
   * The pre-installation inspection sheet is a paper document the shop relies on,
   * and it was truncated in an earlier port (6 of 20 electrical rows, 3 of 7 audio).
   * Rather than restate the lists, parse them out of the prototype and compare, so
   * this test cannot drift from the source it is checking.
   */
  const parsePrototypeSections = () => {
    const src = prototypeLines.slice(2100, 2106).join('\n');
    const sections: { title: string; items: string[] }[] = [];
    const re = /\{\s*title\s*:\s*'([^']+)'\s*,\s*items\s*:\s*\[([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const items = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      sections.push({ title: m[1], items });
    }
    return sections;
  };

  it('matches the prototype section-for-section and row-for-row', async () => {
    const { QC_CHECKLIST_SECTIONS } = await import('@/components/tickets/PrintJobSheet');
    const expected = parsePrototypeSections();

    // Guard the parser itself: if the prototype layout changes, fail loudly here
    // rather than silently comparing against an empty list.
    expect(expected.length, 'could not parse the prototype checklist').toBe(4);
    expect(expected[0].items.length).toBe(20);

    expect(QC_CHECKLIST_SECTIONS.map((s) => s.title)).toEqual(expected.map((s) => s.title));
    for (const [i, section] of expected.entries()) {
      expect(QC_CHECKLIST_SECTIONS[i].items, `section "${section.title}"`).toEqual(section.items);
    }
  });
});
