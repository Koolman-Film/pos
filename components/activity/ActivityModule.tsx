'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ThaiDateInput } from '@/components/ui/ThaiDateInput';
import {
  ACTIVITY_MODULES,
  docHref,
  entityMeta,
  groupByTransaction,
  readEntry,
  type ActivityEntry,
  type ActivityModule as ModuleName,
  type LineChange,
} from '@/lib/domain/activity';
import { fmtThaiDateTime } from '@/lib/domain/format';

/**
 * ประวัติการใช้งาน — the screen over `activity_log` (migration 0061).
 *
 * The question it exists for is "ใครแก้ใบงานนี้ทับ", so every entry leads with
 * who and when, names the document it touched as a link, and shows what the
 * value was before next to what it became. A save that wrote a ticket's header
 * and its lines in one go is shown as one card, because it was one act.
 *
 * The filters live in the URL: a filtered view is something an admin can send
 * to somebody else, and the ticket's ประวัติการแก้ไข button is just a link here
 * with `?doc=` set.
 */

export type ActivityFilterView = {
  from?: string;
  to?: string;
  shop?: string;
  module?: ModuleName;
  actor?: string;
  doc?: string;
  before?: number;
};

type Named = { id: string; name: string };

const ACTION_TONE: Record<string, { bg: string; fg: string }> = {
  สร้าง: { bg: '#E6EFDC', fg: '#4C7A3E' },
  แก้ไข: { bg: '#E4ECFC', fg: '#1E4FB8' },
  ลบ: { bg: '#FBEAEC', fg: '#B23A48' },
};

function query(f: ActivityFilterView): string {
  const p = new URLSearchParams();
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.shop) p.set('shop', f.shop);
  if (f.module) p.set('module', f.module);
  if (f.actor) p.set('actor', f.actor);
  if (f.doc) p.set('doc', f.doc);
  if (f.before) p.set('before', String(f.before));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function ActivityModule({
  entries,
  hasMore,
  filter,
  shops,
  users,
}: {
  entries: ActivityEntry[];
  hasMore: boolean;
  filter: ActivityFilterView;
  shops: Named[];
  users: Named[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ActivityFilterView>({ ...filter, before: undefined });
  const shopName = (id: string | null) => shops.find((s) => s.id === id)?.name ?? id ?? '';

  function apply(next: ActivityFilterView) {
    router.push(`/activity${query({ ...next, before: undefined })}`);
  }

  const groups = groupByTransaction(entries);
  const filtered = !!(
    filter.from ||
    filter.to ||
    filter.shop ||
    filter.module ||
    filter.actor ||
    filter.doc
  );
  const oldestId = entries.length ? entries[entries.length - 1].id : undefined;

  return (
    <div className="fade-page">
      <div className="mb-4">
        <h1 className="text-xl font-bold">ประวัติการใช้งาน</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>
          ทุกการสร้าง แก้ไข และลบในระบบ ว่าใครทำ เมื่อไหร่ และค่าเดิมคืออะไร — บันทึกโดยฐานข้อมูล
          แก้หรือลบไม่ได้ · เห็นเฉพาะแอดมิน
        </p>
      </div>

      {/* ------------------------------------------------------------ filter */}
      <form
        className="card p-4 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            เลขเอกสาร
            <input
              value={draft.doc ?? ''}
              onChange={(e) => setDraft({ ...draft, doc: e.target.value || undefined })}
              placeholder="เช่น JT-CM-00214, WS-, POS-CM-"
              aria-label="ค้นตามเลขเอกสาร"
              className="field w-full text-sm px-3 py-2 mt-1"
            />
          </label>
          <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            ใครทำ
            <select
              value={draft.actor ?? ''}
              onChange={(e) => setDraft({ ...draft, actor: e.target.value || undefined })}
              aria-label="กรองตามผู้ทำ"
              className="field w-full text-sm px-3 py-2 mt-1"
            >
              <option value="">ทุกคน</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
              <option value="system">ระบบ (ไม่ได้เข้าสู่ระบบ)</option>
            </select>
          </label>
          <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            โมดูล
            <select
              value={draft.module ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, module: (e.target.value || undefined) as ModuleName })
              }
              aria-label="กรองตามโมดูล"
              className="field w-full text-sm px-3 py-2 mt-1"
            >
              <option value="">ทุกโมดูล</option>
              {ACTIVITY_MODULES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            สาขา
            <select
              value={draft.shop ?? ''}
              onChange={(e) => setDraft({ ...draft, shop: e.target.value || undefined })}
              aria-label="กรองตามสาขา"
              className="field w-full text-sm px-3 py-2 mt-1"
            >
              <option value="">ทุกสาขา</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            ตั้งแต่วันที่
            <div className="mt-1">
              <ThaiDateInput
                value={draft.from ?? ''}
                onChange={(v) => setDraft({ ...draft, from: v || undefined })}
                ariaLabel="ตั้งแต่วันที่"
              />
            </div>
          </div>
          <div className="text-xs" style={{ color: 'var(--ink-soft)' }}>
            ถึงวันที่
            <div className="mt-1">
              <ThaiDateInput
                value={draft.to ?? ''}
                onChange={(v) => setDraft({ ...draft, to: v || undefined })}
                ariaLabel="ถึงวันที่"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-3 justify-end">
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setDraft({});
                apply({});
              }}
              className="btn-outline text-sm px-4 py-2 rounded-xl"
            >
              ล้างตัวกรอง
            </button>
          )}
          <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-xl font-semibold">
            <i className="fa-solid fa-magnifying-glass mr-2"></i>ค้นหา
          </button>
        </div>
      </form>

      {/* ------------------------------------------------------------ list */}
      {groups.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-soft)' }}>
          {filtered ? 'ไม่พบประวัติตามที่กรอง' : 'ยังไม่มีประวัติการใช้งาน'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <ActivityCard key={g[0].id} group={g} shopName={shopName} />
          ))}
        </div>
      )}

      <div
        className="flex justify-between items-center mt-4 text-xs"
        style={{ color: 'var(--ink-soft)' }}
      >
        <span>
          {entries.length > 0 &&
            `แสดง ${entries.length.toLocaleString('th-TH')} รายการ ตั้งแต่ ${fmtThaiDateTime(
              new Date(entries[entries.length - 1].at),
            )}`}
        </span>
        <span className="flex gap-2">
          {filter.before && (
            <Link
              href={`/activity${query({ ...filter, before: undefined })}`}
              className="btn-outline px-3 py-1.5 rounded-lg"
            >
              ล่าสุด
            </Link>
          )}
          {hasMore && oldestId && (
            <Link
              href={`/activity${query({ ...filter, before: oldestId })}`}
              className="btn-outline px-3 py-1.5 rounded-lg"
            >
              ก่อนหน้านี้ <i className="fa-solid fa-chevron-right ml-1"></i>
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}

function ActivityCard({
  group,
  shopName,
}: {
  group: ActivityEntry[];
  shopName: (id: string | null) => string;
}) {
  const head = group[0];
  const docs = [...new Set(group.map((e) => `${e.entity}|${e.docRef}`))]
    .map((k) => {
      const [entity, doc] = k.split('|');
      return { doc, href: docHref(entity, doc) };
    })
    .filter((d, i, all) => d.doc && all.findIndex((x) => x.doc === d.doc) === i);

  return (
    <article
      className="card p-4"
      aria-label={`${head.actorName} ${fmtThaiDateTime(new Date(head.at))}`}
    >
      <header className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <p className="text-sm">
          <span className="font-semibold">{head.actorName || 'ไม่ทราบชื่อ'}</span>
          {head.shop && (
            <span className="text-xs ml-2" style={{ color: 'var(--ink-faint)' }}>
              {shopName(head.shop)}
            </span>
          )}
        </p>
        <p className="text-xs flex items-center gap-2" style={{ color: 'var(--ink-soft)' }}>
          {docs.map((d) =>
            d.href ? (
              <Link
                key={d.doc}
                href={d.href}
                className="font-mono"
                style={{ color: 'var(--primary)' }}
              >
                {d.doc}
              </Link>
            ) : (
              <span key={d.doc} className="font-mono">
                {d.doc}
              </span>
            ),
          )}
          <time dateTime={head.at}>{fmtThaiDateTime(new Date(head.at))}</time>
        </p>
      </header>

      <div className="flex flex-col gap-2">
        {group.map((e) => (
          <EntryBody key={e.id} entry={e} />
        ))}
      </div>
    </article>
  );
}

function ActionPill({ action }: { action: string }) {
  const tone = ACTION_TONE[action] ?? ACTION_TONE['แก้ไข'];
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {action}
    </span>
  );
}

function BeforeAfter({ before, after }: { before: string; after: string }) {
  return (
    <>
      <span className="line-through" style={{ color: 'var(--change-before)' }}>
        {before}
      </span>
      <i
        className="fa-solid fa-arrow-right mx-1.5 text-[10px]"
        style={{ color: 'var(--ink-faint)' }}
      ></i>
      <span className="font-semibold" style={{ color: 'var(--change-after)' }}>
        {after}
      </span>
    </>
  );
}

function EntryBody({ entry }: { entry: ActivityEntry }) {
  const meta = entityMeta(entry.entity);
  const reading = readEntry(entry);

  return (
    <section
      className="rounded-xl p-3"
      style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}
    >
      <p className="text-xs mb-1.5 flex items-center gap-2">
        <ActionPill action={entry.action} />
        <span className="font-medium">{meta.label}</span>
        {entry.entity !== 'tickets' && entry.entity !== 'orders' && entry.docRef && (
          <span style={{ color: 'var(--ink-faint)' }}>{entry.docRef}</span>
        )}
      </p>

      {reading.shape === 'fields' && (
        <ul className="text-xs flex flex-col gap-1">
          {reading.fields.map((f, i) => (
            <li key={i}>
              <span style={{ color: 'var(--ink-soft)' }}>{f.path}: </span>
              <BeforeAfter before={f.before} after={f.after} />
            </li>
          ))}
        </ul>
      )}

      {reading.shape === 'snapshot' && (
        <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
          {reading.fields.map((f) => `${f.label} ${f.value}`).join(' · ') || '—'}
        </p>
      )}

      {reading.shape === 'lines' &&
        reading.parts.map((p) => (
          <div key={p.part} className="mb-1 last:mb-0">
            <p className="text-xs font-medium" style={{ color: 'var(--ink-soft)' }}>
              {p.label}
            </p>
            <ul className="text-xs flex flex-col gap-1 mt-0.5">
              {p.lines.map((l, i) => (
                <LineItem key={i} line={l} />
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

function LineItem({ line }: { line: LineChange }) {
  if (line.kind === 'added')
    return (
      <li>
        <span style={{ color: 'var(--change-after)' }}>+ เพิ่ม </span>
        <span className="font-medium">{line.label}</span>
        {line.detail && line.detail !== line.label && (
          <span style={{ color: 'var(--ink-faint)' }}> · {line.detail}</span>
        )}
      </li>
    );
  if (line.kind === 'removed')
    return (
      <li>
        <span style={{ color: 'var(--change-before)' }}>− ลบ </span>
        <span className="font-medium line-through">{line.label}</span>
        {line.detail && line.detail !== line.label && (
          <span style={{ color: 'var(--ink-faint)' }}> · {line.detail}</span>
        )}
      </li>
    );
  return (
    <li>
      <span style={{ color: 'var(--change-edit)' }}>แก้ </span>
      <span className="font-medium">{line.label}</span>
      <ul className="ml-4 mt-0.5 flex flex-col gap-0.5">
        {line.fields.map((f, i) => (
          <li key={i}>
            <span style={{ color: 'var(--ink-soft)' }}>{f.path}: </span>
            <BeforeAfter before={f.before} after={f.after} />
          </li>
        ))}
      </ul>
    </li>
  );
}
