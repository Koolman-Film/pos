import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  NAV_ITEMS,
  DASHBOARD_WIDGETS,
  OTHER_CAPABILITIES,
  MODULE_CAPABILITIES,
} from '@/components/permissions/permissionMeta';
import { NAV_ITEMS as SIDEBAR_NAV } from '@/components/layout/navItems';

/**
 * จัดการสิทธิ์ ต้องครอบคลุมทุกโมดูลและทุกการ์ด.
 *
 * A permission key only does something if the admin screen lists it: a gate the
 * screen cannot see is a gate nobody can open. That is exactly what happened to
 * โมดูลรายได้ and to สต็อก: อนุมัติใบเบิก — both were built, both were checked at
 * runtime, and neither appeared on the one screen that governs access, so they
 * were ungovernable until somebody noticed by hand.
 *
 * This walks the source for every key the app actually checks and fails if the
 * registry does not carry it. It is the reason the next module cannot drift the
 * same way — the failure arrives with the feature, not months later.
 */

const ROOTS = ['app', 'components', 'lib'];
const CODE = /\.(ts|tsx)$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (CODE.test(entry)) out.push(path);
  }
  return out;
}

/** Every `fn('some.key')` call site across the app, as a set of keys. */
function keysPassedTo(fn: string): Set<string> {
  const found = new Set<string>();
  const call = new RegExp(`${fn}\\(\\s*'([A-Za-z][A-Za-z0-9.]*)'`, 'g');
  for (const file of ROOTS.flatMap(sourceFiles)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(call)) found.add(m[1]);
  }
  return found;
}

const declared = {
  nav: new Set(NAV_ITEMS.map((n) => n.id)),
  widget: new Set([...DASHBOARD_WIDGETS, ...OTHER_CAPABILITIES].map((w) => w.key)),
  capability: new Set(MODULE_CAPABILITIES.map((c) => c.key)),
};

describe('permission registry covers what the code checks', () => {
  it('lists every module the app gates on hasNav', () => {
    const used = keysPassedTo('hasNav');
    expect([...used].filter((k) => !declared.nav.has(k))).toEqual([]);
  });

  it('lists every dashboard card the app gates on hasDashboardWidget', () => {
    const used = keysPassedTo('hasDashboardWidget');
    expect([...used].filter((k) => !declared.widget.has(k))).toEqual([]);
  });

  it('lists every capability the app gates on canDo', () => {
    const used = keysPassedTo('canDo');
    expect([...used].filter((k) => !declared.capability.has(k))).toEqual([]);
  });

  it('lists exactly the sidebar’s modules, one registry not two', () => {
    // These were separate copies once, and โมดูลรายได้ lived in only one of them:
    // it shipped in the sidebar and stayed ungovernable. Pinning them equal is
    // what stops the next module repeating it.
    expect(NAV_ITEMS.map((n) => n.id)).toEqual(SIDEBAR_NAV.map((n) => n.id));
  });

  it('has a Thai label for every key it lists', () => {
    // A key with no label renders as an unexplained checkbox.
    for (const item of [...DASHBOARD_WIDGETS, ...OTHER_CAPABILITIES, ...MODULE_CAPABILITIES]) {
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
    for (const item of NAV_ITEMS) expect(item.label.trim().length).toBeGreaterThan(0);
  });
});

describe('reset_permissions_to_defaults keeps every key', () => {
  /**
   * The defaults live in SQL, which is a copy of the registry that no compiler
   * checks. A key missing there is a key that a "reset to defaults" quietly
   * un-governs — the same failure, arriving later and harder to spot.
   */
  const sql = readFileSync('supabase/migrations/0033_permission_coverage.sql', 'utf8');

  it('seeds every module', () => {
    for (const nav of declared.nav) {
      expect(sql).toContain(`'nav','${nav}'`);
    }
  });

  it('seeds every dashboard card', () => {
    for (const key of declared.widget) {
      expect(sql).toContain(`'dashboard_widget','${key}'`);
    }
  });

  it('seeds every capability', () => {
    for (const key of declared.capability) {
      expect(sql).toContain(`('${key}')`);
    }
  });
});
