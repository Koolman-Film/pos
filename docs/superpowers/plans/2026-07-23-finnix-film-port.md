# Finnix Film Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `reference/v0.4/finnix-film.html` (single-file React/Babel/Tailwind-CDN prototype, no backend) into a production Next.js (App Router) + Supabase (Postgres/Auth/RLS) app, deployable on Vercel, with unchanged business functionality and equal-or-better visuals.

**Architecture:** Next.js App Router with Server Components for reads and Client Components for interactive forms, backed by Supabase Postgres (with RLS enforcing shop/role scoping) and Supabase Auth (email+password). Config-as-data: option lists, permissions, and lookup tables are DB rows editable via the Permissions/admin UI, not hardcoded constants — this is what makes future prototype re-syncs mostly data edits instead of code changes (see spec §7).

**Tech Stack:** Next.js 14 (App Router, TypeScript), Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Tailwind CSS v3, `react-chartjs-2` + `chart.js`, `xlsx` (SheetJS), Vitest + React Testing Library (unit/component tests), Playwright (e2e), Supabase CLI (local dev stack + migrations).

## Global Constraints

- Business functionality must exactly match `reference/v0.4/finnix-film.html` — this file is the behavioral source of truth for every task below. Visual/UX bugs may be fixed; business logic (calculations, workflows, permission semantics) must not change.
- All Thai UI copy carries over verbatim from the prototype — no i18n layer, no re-translation.
- Component names stay close to the prototype's function names (`TicketDetail`, `WholesaleDetail`, `StockModule`, etc.) per spec §6, to keep `docs/PROTOTYPE_MAP.md` accurate.
- Every shop-scoped table gets an RLS policy; permission checks exist in the UI (as today) *and* in Postgres (new — the prototype has none).
- No task in this plan creates real billed cloud resources (Supabase projects, Vercel deployments) or touches DNS/domain registration — those are gated behind the explicit checkpoint in Task 21, per this project's safety rules.
- Auth: Supabase Auth email + password (replaces the prototype's fake email-only picker).
- Local dev/tests run against the Supabase CLI's local stack (`supabase start`), not a hosted project.

---

## File Structure

```
app/
  layout.tsx                        # root layout, fonts, theme script
  globals.css                       # ported CSS variables + Tailwind directives
  login/page.tsx
  (app)/layout.tsx                   # authenticated shell: Sidebar + Header, session/permission fetch
  (app)/dashboard/page.tsx
  (app)/tickets/page.tsx
  (app)/tickets/new/page.tsx
  (app)/tickets/[id]/page.tsx
  (app)/wholesale/page.tsx
  (app)/wholesale/[id]/page.tsx
  (app)/stock/page.tsx
  (app)/commission/page.tsx
  (app)/accounting/page.tsx
  (app)/permissions/page.tsx
middleware.ts                        # Supabase session refresh (per @supabase/ssr)
components/
  ui/{Badge,StatusPill,ManagedDropdown,ManagedChipPicker,ManagedMultiChipPicker,DateTimeField,PeriodShopFilter}.tsx
  charts/{DoughnutChart,BarChart,LineChart}.tsx
  layout/{Sidebar,Header}.tsx
  dashboard/{Dashboard,JobCalendar}.tsx
  tickets/{TicketList,TicketDetail,TicketCustomerPicker,PrintJobSheet}.tsx
  wholesale/{WholesaleList,WholesaleDetail,CustomerPicker}.tsx
  stock/StockModule.tsx
  commission/CommissionModule.tsx
  accounting/AccountingModule.tsx
  permissions/PermissionsModule.tsx
lib/
  supabase/{client.ts,server.ts,middleware.ts}
  domain/{tickets.ts,orders.ts,format.ts,dashboard.ts}
  auth/session.ts                     # getSessionContext(): role, permissions, accessibleShops
  types/database.ts                    # generated via `supabase gen types typescript`
supabase/
  migrations/000{1..7}_*.sql
  seed.sql
tests/
  unit/domain/*.test.ts
  rls/*.test.ts
  e2e/*.spec.ts
docs/{PROTOTYPE_MAP.md,UPDATING.md}
```

---

### Task 1: Project scaffold + Tailwind theme port

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `tailwind.config.ts`, `postcss.config.js`
- Create: `app/layout.tsx`, `app/globals.css`
- Test: `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: a running `npm run dev` Next.js app with the prototype's theme (CSS vars, fonts, Font Awesome) available globally.

- [ ] **Step 1: Scaffold Next.js app**

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint
```

Answer prompts to match: TypeScript yes, Tailwind yes, App Router yes, `src/` no.

- [ ] **Step 2: Install remaining dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr chart.js react-chartjs-2 xlsx
npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom @playwright/test supabase
```

- [ ] **Step 3: Port the theme into `app/globals.css`**

Replace the generated `app/globals.css` with the Tailwind directives plus the prototype's CSS variables and utility classes, ported verbatim from `reference/v0.4/finnix-film.html:17-77`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --primary: #7A2333; --primary-hover: #611B28; --primary-soft: #F3E3E6;
  --revenue: #2563EB; --revenue-soft: #E4ECFC;
  --ink: #2A211D; --ink-soft: #8B7F76; --ink-faint: #B5AAA1;
  --paper: #FAF7F3; --surface: #FFFFFF; --sidebar: #211A18;
  --line: #EBE3DA; --line-strong: #DCD2C6;
  --shadow-sm: 0 1px 2px rgba(42,33,29,.05), 0 1px 1px rgba(42,33,29,.03);
  --shadow-md: 0 8px 24px rgba(42,33,29,.08), 0 2px 6px rgba(42,33,29,.04);
  --shadow-red: 0 10px 24px rgba(122,35,51,.22);
}
html[data-theme="dark"] {
  --primary: #B23A48; --primary-hover: #C94A58; --primary-soft: #3A2228;
  --revenue: #6C9BF5; --revenue-soft: #1E2A44;
  --ink: #F0E9E4; --ink-soft: #B7ADA4; --ink-faint: #7C7168;
  --paper: #171310; --surface: #221C18; --sidebar: #0F0C0A;
  --line: #362E28; --line-strong: #453B33;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.35), 0 1px 1px rgba(0,0,0,.25);
  --shadow-md: 0 8px 24px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.3);
  --shadow-red: 0 10px 24px rgba(178,58,72,.32);
}
* { box-sizing: border-box; }
body { font-family:'Plus Jakarta Sans','Noto Sans Thai',-apple-system,sans-serif; background:var(--paper); color:var(--ink); -webkit-font-smoothing:antialiased; transition:background .2s ease, color .2s ease; }
.card { background:var(--surface); border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadow-sm); transition:box-shadow .2s ease, transform .2s ease, border-color .2s ease; }
.card-hover:hover { box-shadow:var(--shadow-md); border-color:var(--line-strong); transform:translateY(-1px); }
.btn-primary { background:var(--primary); color:#fff; box-shadow:var(--shadow-red); transition:background .15s ease, transform .1s ease; }
.btn-primary:hover { background:var(--primary-hover); }
.btn-primary:active { transform:scale(0.97); }
.btn-outline { background:var(--surface); color:var(--ink); border:1.5px solid var(--line-strong); transition:all .15s ease; }
.btn-outline:hover { background:var(--paper); border-color:var(--primary); }
.pill-active { background:var(--primary); color:#fff; box-shadow:var(--shadow-red); }
.pill-inactive { background:var(--surface); color:var(--ink-soft); border:1px solid var(--line); }
.pill-inactive:hover { border-color:var(--line-strong); }
.field { background:var(--surface); border:1.5px solid var(--line); border-radius:11px; transition:all .15s ease; }
.field:focus { border-color:var(--primary) !important; box-shadow:0 0 0 4px var(--primary-soft); outline:none; }
.icon-tile { width:38px; height:38px; border-radius:11px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.status-bar { width:5px; border-radius:6px 0 0 6px; }
::placeholder { color:var(--ink-faint); }
.nav-item { transition: background .15s ease, color .15s ease; }
.row-action { opacity:0; transform:translateX(-4px); transition:opacity .15s ease, transform .15s ease; }
.group:hover .row-action { opacity:1; transform:translateX(0); }
@keyframes fadeUp { from { opacity:0; transform:translateY(6px);} to { opacity:1; transform:translateY(0);} }
.fade-page { animation: fadeUp .28s ease; }
.scrollbar-thin::-webkit-scrollbar { width:6px; }
.scrollbar-thin::-webkit-scrollbar-thumb { background:rgba(255,255,255,.15); border-radius:8px; }
.print-area { display:none; }
@media print {
  @page { size: A4; margin: 2cm 1cm; }
  @page offsite-page { size: A4; margin: 1cm 1cm 2cm 1cm; }
  .print-area.offsite-form { page: offsite-page; }
  body, html { background:#fff !important; margin:0; }
  #root, #__next { display:none !important; }
  .print-area { display:block !important; width:auto; background:#fff; }
  .print-area, .print-area * { color:#211A18 !important; opacity:1 !important; }
  .print-area table { width:100%; border-collapse:collapse; font-size:12px; }
  .print-area th, .print-area td { border:1px solid #ccc; padding:6px 8px; text-align:left; }
  .print-area table.compact-table { font-size:9px; }
  .print-area table.compact-table th, .print-area table.compact-table td { padding:1.5px 4px; line-height:1.2; }
  .print-area th { background:#f2f2f2 !important; }
}
```

Note the one deliberate change from the prototype: `#root` → `#root, #__next` in the print media query, since Next.js doesn't render into `#root`. Verify the actual root element id Next.js produces in Task 3's manual check and adjust if needed (App Router has no wrapper id by default — if so, drop that selector line entirely, since `.print-area` being the only visible thing under `@media print` is achieved by hiding `body > *:not(.print-area)` instead; confirm during Task 3's print-layout task).

- [ ] **Step 4: Wire fonts and Font Awesome in `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Finnix Film — ระบบบริหารจัดการร้าน',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+Thai:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

(Font Awesome and Google Fonts stay CDN-loaded exactly as in the prototype — only React/Babel/Tailwind/Chart.js/xlsx move to real npm packages, since those are the ones that needed a build step to do properly.)

- [ ] **Step 5: Smoke test**

```ts
// tests/unit/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('project scaffold', () => {
  it('sanity check', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npx vitest run tests/unit/smoke.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with ported theme"
```

---

### Task 2: Database schema — identity, shops, permissions

**Files:**
- Create: `supabase/migrations/0001_identity_and_shops.sql`
- Create: `supabase/migrations/0002_permissions.sql`
- Test: `tests/rls/identity.test.ts`

**Interfaces:**
- Produces: `shops`, `shop_info`, `roles`, `users` (app-side profile table, FK to `auth.users`), `user_shop_access`, `role_permissions` tables, consumed by every later module's RLS policies and by `lib/auth/session.ts` (Task 6).

- [ ] **Step 1: Init local Supabase project**

```bash
npx supabase init
npx supabase start
```

Expected: local Postgres/Auth/Studio running, printing local API URL + anon key.

- [ ] **Step 2: Write migration 0001 (identity & shops)**

```sql
-- supabase/migrations/0001_identity_and_shops.sql
create table shops (
  id text primary key,
  name text not null,
  sort_order int not null default 0
);

create table shop_info (
  shop_id text primary key references shops(id) on delete cascade,
  address text not null default '',
  phone text not null default '',
  company_name text not null default '',
  tax_id text not null default '',
  payment_channels text[] not null default '{}'
);

create table roles (
  id text primary key,
  name text not null,
  icon text not null default 'fa-user'
);

create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  role_id text not null references roles(id),
  active boolean not null default true,
  sees_all_shops boolean not null default false
);

create table user_shop_access (
  user_id uuid not null references app_users(id) on delete cascade,
  shop_id text not null references shops(id) on delete cascade,
  primary key (user_id, shop_id)
);

insert into shops (id, name, sort_order) values
  ('cm', 'FINNIX FILM เชียงใหม่', 1),
  ('lp', 'FINNIX FILM ลำพูน', 2),
  ('py', 'FINNIX FILM พะเยา', 3),
  ('lpg', 'FINNIX FILM ลำปาง', 4),
  ('ca', 'Central Audio', 5);

insert into shop_info (shop_id, address, phone) values
  ('cm', '4/9 ถนนมหิดล ตำบลป่าแดด อำเภอเมืองเชียงใหม่ จ.เชียงใหม่ 50100', '098-262-5623'),
  ('lp', '', ''), ('py', '', ''), ('lpg', '', ''), ('ca', '', '');

insert into roles (id, name, icon) values
  ('admin', 'แอดมิน/หลังบ้าน', 'fa-gear'),
  ('exec', 'ผู้บริหาร', 'fa-crown'),
  ('sales', 'พนักงานขาย', 'fa-user-tie'),
  ('tech', 'หัวหน้าช่าง', 'fa-screwdriver-wrench');
```

- [ ] **Step 3: Write migration 0002 (unified permissions table)**

```sql
-- supabase/migrations/0002_permissions.sql
create type permission_type as enum ('nav', 'dashboard_widget', 'module_capability');

create table role_permissions (
  role_id text not null references roles(id) on delete cascade,
  permission_type permission_type not null,
  permission_key text not null,
  allowed boolean not null default false,
  primary key (role_id, permission_type, permission_key)
);

-- nav permissions (spec: DEFAULT_NAV_PERMISSIONS, reference/v0.4/finnix-film.html:176-181)
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','nav','dashboard',true), ('admin','nav','list',true), ('admin','nav','wholesale',true), ('admin','nav','stock',true), ('admin','nav','commission',true), ('admin','nav','accounting',true), ('admin','nav','permissions',true),
  ('exec','nav','dashboard',true), ('exec','nav','list',true), ('exec','nav','wholesale',true), ('exec','nav','stock',true), ('exec','nav','commission',false), ('exec','nav','accounting',true), ('exec','nav','permissions',false),
  ('sales','nav','dashboard',true), ('sales','nav','list',true), ('sales','nav','wholesale',true), ('sales','nav','stock',false), ('sales','nav','commission',false), ('sales','nav','accounting',false), ('sales','nav','permissions',false),
  ('tech','nav','dashboard',true), ('tech','nav','list',true), ('tech','nav','wholesale',false), ('tech','nav','stock',true), ('tech','nav','commission',false), ('tech','nav','accounting',false), ('tech','nav','permissions',false);

-- dashboard widget + other-capability permissions (DEFAULT_DASHBOARD_PERMISSIONS, lines 196-201)
insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('admin','dashboard_widget','revenue',true), ('admin','dashboard_widget','expense',true), ('admin','dashboard_widget','pettycash',true), ('admin','dashboard_widget','trendChart',true), ('admin','dashboard_widget','stockSummary',false), ('admin','dashboard_widget','jobCalendar',true), ('admin','dashboard_widget','receivablesPayables',true), ('admin','dashboard_widget','pendingApprovals',true), ('admin','dashboard_widget','seeAllShops',true), ('admin','dashboard_widget','seeStockPrices',true),
  ('exec','dashboard_widget','revenue',true), ('exec','dashboard_widget','expense',true), ('exec','dashboard_widget','pettycash',true), ('exec','dashboard_widget','trendChart',true), ('exec','dashboard_widget','stockSummary',false), ('exec','dashboard_widget','jobCalendar',true), ('exec','dashboard_widget','receivablesPayables',true), ('exec','dashboard_widget','pendingApprovals',true), ('exec','dashboard_widget','seeAllShops',true), ('exec','dashboard_widget','seeStockPrices',true),
  ('sales','dashboard_widget','revenue',false), ('sales','dashboard_widget','expense',false), ('sales','dashboard_widget','pettycash',false), ('sales','dashboard_widget','trendChart',false), ('sales','dashboard_widget','stockSummary',true), ('sales','dashboard_widget','jobCalendar',true), ('sales','dashboard_widget','receivablesPayables',false), ('sales','dashboard_widget','pendingApprovals',false), ('sales','dashboard_widget','seeAllShops',false), ('sales','dashboard_widget','seeStockPrices',false),
  ('tech','dashboard_widget','revenue',false), ('tech','dashboard_widget','expense',false), ('tech','dashboard_widget','pettycash',false), ('tech','dashboard_widget','trendChart',false), ('tech','dashboard_widget','stockSummary',true), ('tech','dashboard_widget','jobCalendar',true), ('tech','dashboard_widget','receivablesPayables',false), ('tech','dashboard_widget','pendingApprovals',true), ('tech','dashboard_widget','seeAllShops',false), ('tech','dashboard_widget','seeStockPrices',false);

-- module capability permissions (DEFAULT_MODULE_PERMISSIONS, lines 221-226; admin/exec = all true)
insert into role_permissions (role_id, permission_type, permission_key, allowed)
  select r.id, 'module_capability', c.key, true
  from roles r, (values
    ('list.createNew'),('list.printSheet'),('wholesale.createNew'),('wholesale.priceApproval'),
    ('wholesale.badDebt'),('wholesale.export'),('stock.addProduct'),('stock.adjustStock'),
    ('stock.withdraw'),('stock.editDelete'),('stock.export'),('commission.addRule'),
    ('accounting.addExpense'),('accounting.topupCash'),('accounting.export')
  ) as c(key)
  where r.id in ('admin','exec');

insert into role_permissions (role_id, permission_type, permission_key, allowed) values
  ('sales','module_capability','list.createNew',true), ('sales','module_capability','list.printSheet',true), ('sales','module_capability','wholesale.createNew',true),
  ('sales','module_capability','wholesale.priceApproval',false), ('sales','module_capability','wholesale.badDebt',false), ('sales','module_capability','wholesale.export',false),
  ('sales','module_capability','stock.addProduct',false), ('sales','module_capability','stock.adjustStock',false), ('sales','module_capability','stock.withdraw',false),
  ('sales','module_capability','stock.editDelete',false), ('sales','module_capability','stock.export',false), ('sales','module_capability','commission.addRule',false),
  ('sales','module_capability','accounting.addExpense',false), ('sales','module_capability','accounting.topupCash',false), ('sales','module_capability','accounting.export',false),
  ('tech','module_capability','list.createNew',false), ('tech','module_capability','list.printSheet',true), ('tech','module_capability','wholesale.createNew',false),
  ('tech','module_capability','wholesale.priceApproval',false), ('tech','module_capability','wholesale.badDebt',false), ('tech','module_capability','wholesale.export',false),
  ('tech','module_capability','stock.addProduct',false), ('tech','module_capability','stock.adjustStock',true), ('tech','module_capability','stock.withdraw',true),
  ('tech','module_capability','stock.editDelete',false), ('tech','module_capability','stock.export',false), ('tech','module_capability','commission.addRule',false),
  ('tech','module_capability','accounting.addExpense',false), ('tech','module_capability','accounting.topupCash',false), ('tech','module_capability','accounting.export',false);
```

- [ ] **Step 4: Apply migrations locally**

```bash
npx supabase db reset
```

Expected: both migrations apply cleanly, seed rows present (verify with `npx supabase db diff --linked=false` showing no drift, or `psql` count check: `select count(*) from role_permissions;` → 27+40+... rows, non-zero).

- [ ] **Step 5: Write RLS smoke test (RLS itself is added in Task 8; for now just test the seed data is queryable)**

```ts
// tests/rls/identity.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

describe('identity schema seed data', () => {
  it('has all 5 shops', async () => {
    const { data, error } = await supabase.from('shops').select('id').order('sort_order');
    expect(error).toBeNull();
    expect(data?.map(s => s.id)).toEqual(['cm', 'lp', 'py', 'lpg', 'ca']);
  });

  it('has all 4 default roles', async () => {
    const { data } = await supabase.from('roles').select('id');
    expect(data?.map(r => r.id).sort()).toEqual(['admin', 'exec', 'sales', 'tech']);
  });

  it('grants sales role the list.createNew module capability but not stock.editDelete', async () => {
    const { data } = await supabase
      .from('role_permissions')
      .select('permission_key, allowed')
      .eq('role_id', 'sales')
      .eq('permission_type', 'module_capability')
      .in('permission_key', ['list.createNew', 'stock.editDelete']);
    const byKey = Object.fromEntries(data!.map(r => [r.permission_key, r.allowed]));
    expect(byKey['list.createNew']).toBe(true);
    expect(byKey['stock.editDelete']).toBe(false);
  });
});
```

Run: `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local service role key from `supabase start` output> npx vitest run tests/rls/identity.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/rls/identity.test.ts
git commit -m "feat(db): identity, shops, and unified role_permissions schema"
```

---

### Task 3: Database schema — config-as-data (option lists + structured lookups)

**Files:**
- Create: `supabase/migrations/0003_config_lists.sql`
- Test: `tests/rls/config_lists.test.ts`

**Interfaces:**
- Produces: `option_lists`, `statuses`, `ws_statuses`, `car_models`, `price_matrix`, `film_price_matrix`, `corporate_buyers` tables — consumed by every `Managed*Picker` component (Task 9) and every module.

- [ ] **Step 1: Write migration 0003**

```sql
-- supabase/migrations/0003_config_lists.sql
create table option_lists (
  id bigint generated always as identity primary key,
  list_key text not null,
  value text not null,
  shop_id text references shops(id) on delete cascade,
  sort_order int not null default 0,
  unique (list_key, value, shop_id)
);

-- flat lists ported from reference/v0.4/finnix-film.html:270-280,346-347,360-361,302
insert into option_lists (list_key, value, sort_order) values
  ('booking_channels','Walk-in',1), ('booking_channels','เพจร้าน',2), ('booking_channels','Dex',3), ('booking_channels','33Film',4), ('booking_channels','FINNIX บางแค',5),
  ('service_types','เข้าชม',1), ('service_types','เข้าทำ/ติดตั้ง',2),
  ('car_types','เก๋งเล็ก',1), ('car_types','เก๋งใหญ่',2), ('car_types','SUV',3), ('car_types','กระบะ',4), ('car_types','ตู้/แวน',5),
  ('car_brands','Toyota',1), ('car_brands','Honda',2), ('car_brands','Mazda',3), ('car_brands','Isuzu',4), ('car_brands','Ford',5),
  ('time_slots','08:00',1), ('time_slots','09:00',2), ('time_slots','10:00',3), ('time_slots','11:00',4), ('time_slots','12:00',5),
  ('time_slots','13:00',6), ('time_slots','14:00',7), ('time_slots','15:00',8), ('time_slots','16:00',9), ('time_slots','17:00',10),
  ('time_slots','18:00',11), ('time_slots','19:00',12),
  ('film_positions','บานหน้า',1), ('film_positions','คู่หน้า',2), ('film_positions','คู่หลัง',3), ('film_positions','บานตาย',4), ('film_positions','บานหลัง',5), ('film_positions','Sunroof',6), ('film_positions','ฟิล์มอาคาร',7),
  ('wrap_positions','เต็มคัน',1), ('wrap_positions','เฉพาะส่วน',2),
  ('extra_options','รถสไลด์',1), ('extra_options','ประกัน',2), ('extra_options','นอกสถานที่',3), ('extra_options','แก้งาน',4), ('extra_options','Service',5),
  ('slide_types','Walk-in',1), ('slide_types','Showroom',2), ('slide_types','สไลด์ส่วนตัว',3),
  ('technicians','ช่างเอก',1), ('technicians','ช่างบอย',2), ('technicians','ช่างนัท',3), ('technicians','ช่างเอ',4),
  ('product_categories','ฟิล์มกรองแสง',1), ('product_categories','ฟิล์มกันรอย',2), ('product_categories','เครื่องเสียง',3), ('product_categories','สปอยเลอร์',4), ('product_categories','ประกัน',5), ('product_categories','งานบริการ',6),
  ('service_items','ประกัน',1), ('service_items','ล้างรถ',2), ('service_items','ลอกฟิล์ม',3),
  ('expense_categories','ค่าเช่า',1), ('expense_categories','ค่าน้ำ-ไฟ',2), ('expense_categories','เงินเดือน',3), ('expense_categories','ค่าวัสดุสิ้นเปลือง',4), ('expense_categories','การตลาด',5),
  ('payment_sources','เงินสดย่อย',1), ('payment_sources','บัญชีธนาคารสาขา',2), ('payment_sources','บัตรเครดิตบริษัท',3),
  ('payment_methods','เงินสด',1), ('payment_methods','โอนเงิน',2), ('payment_methods','บัตรเครดิต',3);

create table statuses (
  key text primary key,
  short text not null,
  bg text not null,
  text_color text not null,
  dot text not null,
  sort_order int not null default 0
);
insert into statuses (key, short, bg, text_color, dot, sort_order) values
  ('จองแล้ว','จองแล้ว','#F1EDE7','#6B5F55','#B5AAA1',1),
  ('กำลัง QC ก่อนติดตั้ง','รอ QC','#FBF1DA','#8A5A12','#E8B23D',2),
  ('กำลังติดตั้ง','กำลังติดตั้ง','#DEEEEC','#286B62','#2F8F82',3),
  ('รอส่งมอบ','รอส่งมอบ','#E6EFDC','#4C7A3E','#6BA24F',4),
  ('ส่งมอบแล้ว','ส่งมอบแล้ว','#F1EDE7','#6B5F55','#B5AAA1',5),
  ('ค้างชำระ','ค้างชำระ','#FBEAEC','#B23A48','#C24B57',6);

create table ws_statuses (
  key text primary key,
  bg text not null,
  text_color text not null,
  dot text not null,
  sort_order int not null default 0
);
insert into ws_statuses (key, bg, text_color, dot, sort_order) values
  ('รออนุมัติราคา','#FBF1DA','#8A5A12','#E8B23D',1),
  ('รอจัดส่ง','#DEEEEC','#286B62','#2F8F82',2),
  ('จัดส่งแล้ว','#E6EFDC','#4C7A3E','#6BA24F',3),
  ('ค้างชำระ','#FBEAEC','#B23A48','#C24B57',4),
  ('ปิดงานแล้ว','#F1EDE7','#6B5F55','#B5AAA1',5);

-- structured lookups (NOT flat strings — see spec §5)
create table car_models (
  id bigint generated always as identity primary key,
  model text not null,
  brand text not null,
  car_type text not null
);
insert into car_models (model, brand, car_type) values
  ('Vios','Toyota','เก๋งเล็ก'), ('City','Honda','เก๋งเล็ก'), ('2','Mazda','SUV'), ('D-Max','Isuzu','กระบะ'), ('Camry','Toyota','เก๋งใหญ่');

create table price_matrix (
  id bigint generated always as identity primary key,
  car_type text not null,
  product text not null,
  price numeric not null,
  unique (car_type, product)
);

create table film_price_matrix (
  id bigint generated always as identity primary key,
  category text not null,
  product text not null,
  position text not null,
  car_type text not null,
  price numeric not null,
  unique (category, product, position, car_type)
);

create table corporate_buyers (
  id bigint generated always as identity primary key,
  name text not null,
  address text not null default '',
  tax_id text not null default ''
);
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db reset
```

- [ ] **Step 3: Test**

```ts
// tests/rls/config_lists.test.ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

describe('config-as-data seed', () => {
  it('seeds all 12 flat option list keys with at least one value', async () => {
    const { data } = await supabase.from('option_lists').select('list_key');
    const keys = new Set(data!.map(r => r.list_key));
    expect([...keys].sort()).toEqual([
      'booking_channels','car_brands','car_types','expense_categories','extra_options',
      'film_positions','payment_methods','payment_sources','product_categories',
      'service_items','service_types','slide_types','technicians','time_slots','wrap_positions',
    ].sort());
  });

  it('seeds the 6 default ticket statuses in order', async () => {
    const { data } = await supabase.from('statuses').select('key').order('sort_order');
    expect(data?.map(s => s.key)).toEqual([
      'จองแล้ว','กำลัง QC ก่อนติดตั้ง','กำลังติดตั้ง','รอส่งมอบ','ส่งมอบแล้ว','ค้างชำระ',
    ]);
  });

  it('seeds car_models as structured rows, not option_lists rows', async () => {
    const { data } = await supabase.from('car_models').select('model, brand, car_type').eq('model', 'D-Max');
    expect(data).toEqual([{ model: 'D-Max', brand: 'Isuzu', car_type: 'กระบะ' }]);
  });
});
```

Run: `npx vitest run tests/rls/config_lists.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0003_config_lists.sql tests/rls/config_lists.test.ts
git commit -m "feat(db): config-as-data schema (option lists, statuses, structured lookups)"
```

---

### Task 4: Database schema — job tickets

**Files:**
- Create: `supabase/migrations/0004_tickets.sql`
- Test: `tests/rls/tickets_schema.test.ts`

**Interfaces:**
- Produces: `retail_customers`, `tickets`, `ticket_items`, `ticket_item_positions`, `ticket_payments`, `ticket_status_history` — consumed by `lib/domain/tickets.ts` (Task 5... actually Task 12) and the Tickets module (Task 13).

- [ ] **Step 1: Write migration 0004**

```sql
-- supabase/migrations/0004_tickets.sql
create table retail_customers (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null default ''
);

create table tickets (
  id text primary key,                       -- e.g. 'JT-CM-00214', kept as the human-readable job number
  shop_id text not null references shops(id),
  retail_customer_id bigint references retail_customers(id),
  customer_name text not null,                -- denormalized snapshot, matches prototype's t.customer
  phone text not null default '',
  plate text not null default '',
  car_type text not null default '',
  brand text not null default '',
  model text not null default '',
  color text not null default '',
  service_type text not null default '',
  status text not null references statuses(key),
  booking_channel text not null default '',
  tech_by_category jsonb not null default '{}',   -- {"ฟิล์มกรองแสง": ["ช่างเอก"], ...} — kept as jsonb, not normalized: it's a free-form category→technician-list map edited only through the ticket form, never queried/filtered on independently
  drop_off_date timestamptz not null,
  pickup_date timestamptz not null,
  extras jsonb not null default '{}',             -- {"ประกัน": {"checked": true}, ...} — same rationale as tech_by_category
  created_at timestamptz not null default now()
);

create table ticket_items (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  category text not null,
  booked text not null default '',
  booked_price numeric not null default 0,
  sold text not null default '',
  sold_price numeric not null default 0,
  discount_type text,                              -- 'percent' | 'amount' | null
  discount_value numeric
);

create table ticket_item_positions (
  id bigint generated always as identity primary key,
  ticket_item_id bigint not null references ticket_items(id) on delete cascade,
  position text not null,
  product text not null,
  price numeric not null
);

create table ticket_payments (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  type text not null,
  method text not null,
  amount numeric not null,
  paid_at date not null
);

create table ticket_status_history (
  id bigint generated always as identity primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  status text not null,
  changed_at timestamptz not null default now()
);
```

- [ ] **Step 2: Apply**

```bash
npx supabase db reset
```

- [ ] **Step 3: Test — insert one full ticket matching prototype's JT-CM-00214 shape and read it back**

```ts
// tests/rls/tickets_schema.test.ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

describe('tickets schema', () => {
  it('stores a ticket with items, positions, and a payment', async () => {
    await supabase.from('tickets').insert({
      id: 'JT-TEST-00001', shop_id: 'cm', customer_name: 'คุณ ทดสอบ', phone: '080-000-0000',
      plate: '1กก 1111', car_type: 'เก๋งเล็ก', brand: 'Toyota', model: 'Vios', color: 'ขาว',
      service_type: 'เข้าทำ/ติดตั้ง', status: 'จองแล้ว', booking_channel: 'Walk-in',
      drop_off_date: '2026-07-23T09:00:00Z', pickup_date: '2026-07-24T09:00:00Z',
    });
    const { data: item } = await supabase.from('ticket_items').insert({
      ticket_id: 'JT-TEST-00001', category: 'ฟิล์มกรองแสง', sold: 'ฟิล์ม FINNIX CT 40%', sold_price: 1300,
    }).select().single();
    await supabase.from('ticket_item_positions').insert({
      ticket_item_id: item!.id, position: 'บานหน้า', product: 'ฟิล์ม FINNIX CT 40%', price: 1300,
    });
    await supabase.from('ticket_payments').insert({
      ticket_id: 'JT-TEST-00001', type: 'มัดจำ', method: 'โอน TTB', amount: 500, paid_at: '2026-07-23',
    });

    const { data: full } = await supabase
      .from('tickets')
      .select('*, ticket_items(*, ticket_item_positions(*)), ticket_payments(*)')
      .eq('id', 'JT-TEST-00001')
      .single();

    expect(full!.ticket_items).toHaveLength(1);
    expect(full!.ticket_items[0].ticket_item_positions).toHaveLength(1);
    expect(full!.ticket_payments).toHaveLength(1);
    expect(full!.ticket_payments[0].amount).toBe(500);
  });
});
```

Run: `npx vitest run tests/rls/tickets_schema.test.ts`
Expected: PASS (1 test)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_tickets.sql tests/rls/tickets_schema.test.ts
git commit -m "feat(db): job tickets schema"
```

---

### Task 5: Database schema — wholesale

**Files:**
- Create: `supabase/migrations/0005_wholesale.sql`
- Test: `tests/rls/wholesale_schema.test.ts`

**Interfaces:**
- Produces: `wholesale_customers`, `orders`, `order_items`, `order_returns`, `order_payments`, `order_adjustments`.

- [ ] **Step 1: Write migration 0005**

```sql
-- supabase/migrations/0005_wholesale.sql
create table wholesale_customers (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null default '',
  address text not null default ''
);

create table orders (
  id text primary key,                     -- e.g. 'WS-CM-0091'
  shop_id text not null references shops(id),
  customer_id bigint references wholesale_customers(id),
  status text not null references ws_statuses(key),
  created_at timestamptz not null default now()
);

create table order_items (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  name text not null,
  qty numeric not null,
  list_price numeric not null,
  requested_price numeric not null,
  reason text not null default ''
);

create table order_returns (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  item_name text not null,
  qty numeric not null,
  reason text not null default ''
);

create table order_payments (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  amount numeric not null,
  method text not null,
  paid_at date not null
);

create table order_adjustments (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  amount numeric not null,
  reason text not null default '',
  adjusted_at date not null
);
```

- [ ] **Step 2: Apply**

```bash
npx supabase db reset
```

- [ ] **Step 3: Test**

```ts
// tests/rls/wholesale_schema.test.ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

describe('wholesale schema', () => {
  it('stores an order with items, a return, a payment, and an adjustment', async () => {
    const { data: cust } = await supabase.from('wholesale_customers')
      .insert({ name: 'ร้านทดสอบ', phone: '080-000-0000', address: 'เชียงใหม่' }).select().single();
    await supabase.from('orders').insert({ id: 'WS-TEST-0001', shop_id: 'cm', customer_id: cust!.id, status: 'รออนุมัติราคา' });
    await supabase.from('order_items').insert({ order_id: 'WS-TEST-0001', name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10, list_price: 1200, requested_price: 1000, reason: 'ลูกค้าประจำ' });
    await supabase.from('order_returns').insert({ order_id: 'WS-TEST-0001', item_name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 1, reason: 'ของชำรุด' });
    await supabase.from('order_payments').insert({ order_id: 'WS-TEST-0001', amount: 5000, method: 'โอน BBK', paid_at: '2026-07-23' });
    await supabase.from('order_adjustments').insert({ order_id: 'WS-TEST-0001', amount: 200, reason: 'ต่อรองราคา', adjusted_at: '2026-07-23' });

    const { data: full } = await supabase
      .from('orders')
      .select('*, order_items(*), order_returns(*), order_payments(*), order_adjustments(*)')
      .eq('id', 'WS-TEST-0001')
      .single();

    expect(full!.order_items).toHaveLength(1);
    expect(full!.order_returns).toHaveLength(1);
    expect(full!.order_payments).toHaveLength(1);
    expect(full!.order_adjustments).toHaveLength(1);
  });
});
```

Run: `npx vitest run tests/rls/wholesale_schema.test.ts`
Expected: PASS (1 test)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0005_wholesale.sql tests/rls/wholesale_schema.test.ts
git commit -m "feat(db): wholesale schema"
```

---

### Task 6: Database schema — stock, commission, accounting

**Files:**
- Create: `supabase/migrations/0006_stock_commission_accounting.sql`
- Test: `tests/rls/ops_schema.test.ts`

**Interfaces:**
- Produces: `stock`, `withdrawals`, `commission_rules`, `commission_rule_teams`, `expenses`, `petty_cash`.

- [ ] **Step 1: Write migration 0006**

```sql
-- supabase/migrations/0006_stock_commission_accounting.sql
create table stock (
  id bigint generated always as identity primary key,
  sku text not null unique,
  name text not null,
  short_name text not null default '',
  category text not null,
  shop_id text not null references shops(id),
  qty numeric not null default 0,
  min_qty numeric not null default 0,
  cost numeric not null default 0,
  sell_price numeric not null default 0
);

create table withdrawals (
  id bigint generated always as identity primary key,
  item text not null,
  shop_id text not null references shops(id),
  qty numeric not null,
  type text not null,
  withdrawn_by text not null,
  withdrawn_at date not null,
  status text not null default 'รออนุมัติ'
);

create table commission_rules (
  id bigint generated always as identity primary key,
  category text not null,
  name text not null,
  type text not null,                    -- 'percent_of_sale' | 'fixed_per_job'
  value numeric not null,
  shop_id text references shops(id),     -- null = 'all'
  active boolean not null default true
);

create table commission_rule_teams (
  commission_rule_id bigint not null references commission_rules(id) on delete cascade,
  team_member text not null,
  primary key (commission_rule_id, team_member)
);

create table expenses (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id),
  description text not null,
  category text not null,
  source text not null,
  amount numeric not null,
  status text not null,                  -- 'จ่ายแล้ว' | 'รอจ่าย'
  paid_at date,
  due_at date
);

create table petty_cash (
  id bigint generated always as identity primary key,
  shop_id text not null references shops(id),
  type text not null,                    -- 'เติมเงิน' | ...
  amount numeric not null,
  entry_at date not null,
  note text not null default ''
);
```

- [ ] **Step 2: Apply**

```bash
npx supabase db reset
```

- [ ] **Step 3: Test**

```ts
// tests/rls/ops_schema.test.ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

describe('stock/commission/accounting schema', () => {
  it('stores stock, a commission rule with a team, an expense, and a petty cash entry', async () => {
    await supabase.from('stock').insert({ sku: 'SKU-TEST-1', name: 'ทดสอบ', category: 'ฟิล์มกรองแสง', shop_id: 'cm', qty: 5, min_qty: 2, cost: 100, sell_price: 200 });
    const { data: rule } = await supabase.from('commission_rules').insert({ category: 'ค่าคอมพนักงาน', name: 'ทดสอบ 3%', type: 'percent_of_sale', value: 3, shop_id: 'cm' }).select().single();
    await supabase.from('commission_rule_teams').insert({ commission_rule_id: rule!.id, team_member: 'กมล' });
    await supabase.from('expenses').insert({ shop_id: 'cm', description: 'ทดสอบ', category: 'ค่าเช่า', source: 'บัญชีธนาคารสาขา', amount: 1000, status: 'จ่ายแล้ว', paid_at: '2026-07-23' });
    await supabase.from('petty_cash').insert({ shop_id: 'cm', type: 'เติมเงิน', amount: 5000, entry_at: '2026-07-23' });

    const { data: stockRow } = await supabase.from('stock').select('qty').eq('sku', 'SKU-TEST-1').single();
    const { data: team } = await supabase.from('commission_rule_teams').select('team_member').eq('commission_rule_id', rule!.id);
    expect(stockRow!.qty).toBe(5);
    expect(team).toEqual([{ team_member: 'กมล' }]);
  });
});
```

Run: `npx vitest run tests/rls/ops_schema.test.ts`
Expected: PASS (1 test)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0006_stock_commission_accounting.sql tests/rls/ops_schema.test.ts
git commit -m "feat(db): stock, commission, and accounting schema"
```

---

### Task 7: Row Level Security policies

**Files:**
- Create: `supabase/migrations/0007_rls_policies.sql`
- Test: `tests/rls/rls_shop_isolation.test.ts`

**Interfaces:**
- Produces: `current_user_role()`, `current_user_sees_all_shops()`, `current_user_shops()`, `current_user_can(text)`, `current_user_has_nav(text)` SQL functions, plus RLS enabled on every table with real data.
- Consumes: `app_users`, `user_shop_access`, `role_permissions` from Task 2.

- [ ] **Step 1: Write helper functions**

```sql
-- supabase/migrations/0007_rls_policies.sql
create or replace function current_user_role() returns text
language sql stable security definer as $$
  select role_id from app_users where id = auth.uid();
$$;

create or replace function current_user_sees_all_shops() returns boolean
language sql stable security definer as $$
  select current_user_role() = 'admin'
    or coalesce((select sees_all_shops from app_users where id = auth.uid()), false);
$$;

create or replace function current_user_shops() returns setof text
language sql stable security definer as $$
  select id from shops where current_user_sees_all_shops()
  union
  select shop_id from user_shop_access where user_id = auth.uid();
$$;

create or replace function current_user_can(cap text) returns boolean
language sql stable security definer as $$
  select current_user_role() = 'admin' or coalesce((
    select allowed from role_permissions
    where role_id = current_user_role() and permission_type = 'module_capability' and permission_key = cap
  ), false);
$$;

create or replace function current_user_has_nav(nav_key text) returns boolean
language sql stable security definer as $$
  select current_user_role() = 'admin' or coalesce((
    select allowed from role_permissions
    where role_id = current_user_role() and permission_type = 'nav' and permission_key = nav_key
  ), false);
$$;
```

- [ ] **Step 2: Enable RLS + policies on shop-scoped operational tables**

```sql
alter table tickets enable row level security;
create policy tickets_rw on tickets for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()) and current_user_has_nav('list'));

alter table ticket_items enable row level security;
create policy ticket_items_rw on ticket_items for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())))
  with check (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

alter table ticket_item_positions enable row level security;
create policy ticket_item_positions_rw on ticket_item_positions for all
  using (ticket_item_id in (
    select ti.id from ticket_items ti join tickets t on t.id = ti.ticket_id
    where t.shop_id in (select current_user_shops())
  ));

alter table ticket_payments enable row level security;
create policy ticket_payments_rw on ticket_payments for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

alter table ticket_status_history enable row level security;
create policy ticket_status_history_rw on ticket_status_history for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

alter table orders enable row level security;
create policy orders_rw on orders for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()) and current_user_has_nav('wholesale'));

alter table order_items enable row level security;
create policy order_items_rw on order_items for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

alter table order_returns enable row level security;
create policy order_returns_rw on order_returns for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

alter table order_payments enable row level security;
create policy order_payments_rw on order_payments for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

alter table order_adjustments enable row level security;
create policy order_adjustments_rw on order_adjustments for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

alter table stock enable row level security;
create policy stock_rw on stock for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

alter table withdrawals enable row level security;
create policy withdrawals_rw on withdrawals for all
  using (shop_id in (select current_user_shops()));

alter table commission_rules enable row level security;
create policy commission_rules_rw on commission_rules for all
  using (shop_id is null or shop_id in (select current_user_shops()));

alter table commission_rule_teams enable row level security;
create policy commission_rule_teams_rw on commission_rule_teams for all
  using (commission_rule_id in (
    select id from commission_rules where shop_id is null or shop_id in (select current_user_shops())
  ));

alter table expenses enable row level security;
create policy expenses_rw on expenses for all
  using (shop_id in (select current_user_shops()));

alter table petty_cash enable row level security;
create policy petty_cash_rw on petty_cash for all
  using (shop_id in (select current_user_shops()));
```

- [ ] **Step 3: Policies on shared config tables**

```sql
-- Freely readable/insertable by any authenticated user (matches today's UI, where any
-- role filling out a form can add a new dropdown option). Editing/deleting shared
-- status/permission config stays gated to whoever the Permissions module's nav
-- permission allows (default: admin only), mirroring the prototype's existing nav gate.
alter table option_lists enable row level security;
create policy option_lists_select on option_lists for select using (auth.uid() is not null);
create policy option_lists_write on option_lists for insert with check (auth.uid() is not null);
create policy option_lists_modify on option_lists for update using (auth.uid() is not null);
create policy option_lists_delete on option_lists for delete using (auth.uid() is not null);

alter table statuses enable row level security;
create policy statuses_select on statuses for select using (auth.uid() is not null);
create policy statuses_write on statuses for insert with check (current_user_has_nav('permissions'));
create policy statuses_modify on statuses for update using (current_user_has_nav('permissions'));
create policy statuses_delete on statuses for delete using (current_user_has_nav('permissions'));

alter table ws_statuses enable row level security;
create policy ws_statuses_select on ws_statuses for select using (auth.uid() is not null);
create policy ws_statuses_write on ws_statuses for all using (current_user_has_nav('permissions'));

alter table roles enable row level security;
create policy roles_select on roles for select using (auth.uid() is not null);
create policy roles_write on roles for insert with check (current_user_has_nav('permissions'));
create policy roles_modify on roles for update using (current_user_has_nav('permissions'));

alter table role_permissions enable row level security;
create policy role_permissions_select on role_permissions for select using (auth.uid() is not null);
create policy role_permissions_write on role_permissions for all using (current_user_has_nav('permissions'));

alter table shop_info enable row level security;
create policy shop_info_select on shop_info for select using (auth.uid() is not null);
create policy shop_info_write on shop_info for update using (current_user_has_nav('permissions'));

alter table shops enable row level security;
create policy shops_select on shops for select using (auth.uid() is not null);

alter table app_users enable row level security;
create policy app_users_select on app_users for select using (auth.uid() is not null);
create policy app_users_write on app_users for all using (current_user_has_nav('permissions'));

alter table user_shop_access enable row level security;
create policy user_shop_access_select on user_shop_access for select using (auth.uid() is not null);
create policy user_shop_access_write on user_shop_access for all using (current_user_has_nav('permissions'));

alter table car_models enable row level security;
create policy car_models_rw on car_models for all using (auth.uid() is not null);
alter table price_matrix enable row level security;
create policy price_matrix_rw on price_matrix for all using (auth.uid() is not null);
alter table film_price_matrix enable row level security;
create policy film_price_matrix_rw on film_price_matrix for all using (auth.uid() is not null);
alter table corporate_buyers enable row level security;
create policy corporate_buyers_rw on corporate_buyers for all using (auth.uid() is not null);
alter table retail_customers enable row level security;
create policy retail_customers_rw on retail_customers for all using (auth.uid() is not null);
alter table wholesale_customers enable row level security;
create policy wholesale_customers_rw on wholesale_customers for all using (auth.uid() is not null);
```

- [ ] **Step 4: Apply**

```bash
npx supabase db reset
```

- [ ] **Step 5: Write the shop-isolation RLS test (the single most important test in this project — proves the "sales role in shop cm can't read shop lp's tickets" property the prototype only enforced in the UI)**

```ts
// tests/rls/rls_shop_isolation.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey);

async function createSalesUser(email: string, shopId: string) {
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'test-password-123', email_confirm: true });
  await admin.from('app_users').insert({ id: user!.user!.id, email, name: email, role_id: 'sales', active: true, sees_all_shops: false });
  await admin.from('user_shop_access').insert({ user_id: user!.user!.id, shop_id: shopId });
  const client = createClient(url, anonKey);
  await client.auth.signInWithPassword({ email, password: 'test-password-123' });
  return client;
}

describe('RLS shop isolation', () => {
  beforeAll(async () => {
    await admin.from('tickets').insert([
      { id: 'JT-RLS-CM', shop_id: 'cm', customer_name: 'CM Customer', status: 'จองแล้ว', drop_off_date: '2026-07-23T09:00:00Z', pickup_date: '2026-07-24T09:00:00Z' },
      { id: 'JT-RLS-LP', shop_id: 'lp', customer_name: 'LP Customer', status: 'จองแล้ว', drop_off_date: '2026-07-23T09:00:00Z', pickup_date: '2026-07-24T09:00:00Z' },
    ]);
  });

  it('a sales user scoped to shop cm only sees shop cm tickets', async () => {
    const cmUser = await createSalesUser('sales-cm@test.local', 'cm');
    const { data, error } = await cmUser.from('tickets').select('id').in('id', ['JT-RLS-CM', 'JT-RLS-LP']);
    expect(error).toBeNull();
    expect(data?.map(t => t.id)).toEqual(['JT-RLS-CM']);
  });

  it('a sales user scoped to shop lp only sees shop lp tickets', async () => {
    const lpUser = await createSalesUser('sales-lp@test.local', 'lp');
    const { data } = await lpUser.from('tickets').select('id').in('id', ['JT-RLS-CM', 'JT-RLS-LP']);
    expect(data?.map(t => t.id)).toEqual(['JT-RLS-LP']);
  });

  it('a sales user cannot edit the shared statuses config table (nav.permissions is false for sales)', async () => {
    const cmUser = await createSalesUser('sales-cm-2@test.local', 'cm');
    const { error } = await cmUser.from('statuses').update({ short: 'hacked' }).eq('key', 'จองแล้ว');
    const { data: check } = await admin.from('statuses').select('short').eq('key', 'จองแล้ว').single();
    expect(check!.short).toBe('จองแล้ว'); // unchanged — RLS silently filtered the update to 0 rows
  });
});
```

Run: `npx vitest run tests/rls/rls_shop_isolation.test.ts`
Expected: PASS (3 tests). This requires local Supabase running (`supabase start`) with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` env vars set from its printed output.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0007_rls_policies.sql tests/rls/rls_shop_isolation.test.ts
git commit -m "feat(db): row level security policies for shop/role scoping"
```

---

### Task 8: Supabase client helpers (browser, server, middleware)

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `middleware.ts`
- Create: `.env.local.example`
- Test: `tests/unit/supabase-client.test.ts`

**Interfaces:**
- Produces: `createBrowserClient()` (for Client Components), `createServerClient()` (for Server Components/Actions, cookie-based), consumed by every later data-fetching task.

- [ ] **Step 1: Env template**

```bash
# .env.local.example
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 2: Browser client**

```ts
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/database';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: Server client**

```ts
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/types/database';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );
}
```

- [ ] **Step 4: Root middleware (session refresh, per `@supabase/ssr` App Router pattern)**

```ts
// middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 5: Test — clients construct without throwing given env vars**

```ts
// tests/unit/supabase-client.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

describe('supabase browser client', () => {
  it('constructs without throwing', async () => {
    const { createClient } = await import('@/lib/supabase/client');
    expect(() => createClient()).not.toThrow();
  });
});
```

Run: `npx vitest run tests/unit/supabase-client.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add lib/supabase middleware.ts .env.local.example tests/unit/supabase-client.test.ts
git commit -m "feat: Supabase browser/server clients and auth middleware"
```

---

### Task 9: Auth — login page + session/permission context

**Files:**
- Create: `app/login/page.tsx`, `app/login/actions.ts`
- Create: `lib/auth/session.ts`
- Test: `tests/unit/session.test.ts`

**Interfaces:**
- Consumes: `createClient()` from `lib/supabase/server.ts` (Task 8), `app_users`/`user_shop_access`/`role_permissions` tables (Task 2).
- Produces: `getSessionContext(): Promise<SessionContext>` where
  ```ts
  type SessionContext = {
    userId: string; email: string; name: string; roleId: string;
    seesAllShops: boolean; accessibleShopIds: string[];
    canDo: (capabilityKey: string) => boolean;
    hasNav: (navKey: string) => boolean;
    hasDashboardWidget: (widgetKey: string) => boolean;
  };
  ```
  consumed by `app/(app)/layout.tsx` (Task 11) and every module page.

- [ ] **Step 1: `buildSessionContext` — a pure function holding all the permission-resolution logic, replacing the prototype's `canDo`/`canSeeAllShops`/`accessibleShops` (reference/v0.4/finnix-film.html:4376,4393). Kept pure and separate from I/O so it's directly unit-testable without mocking the Supabase client.**

```ts
// lib/auth/buildSessionContext.ts
export type PermissionRow = { permission_type: string; permission_key: string; allowed: boolean };
export type Profile = { name: string; role_id: string; sees_all_shops: boolean; shop_access: string[] };

export type SessionContext = {
  userId: string; email: string; name: string; roleId: string;
  seesAllShops: boolean; accessibleShopIds: string[];
  canDo: (capabilityKey: string) => boolean;
  hasNav: (navKey: string) => boolean;
  hasDashboardWidget: (widgetKey: string) => boolean;
};

export function buildSessionContext(
  userId: string, email: string, profile: Profile, allShopIds: string[], perms: PermissionRow[]
): SessionContext {
  const seesAllShops = profile.sees_all_shops || profile.role_id === 'admin';
  const accessibleShopIds = seesAllShops ? allShopIds : profile.shop_access;
  const lookup = (type: string, key: string) =>
    profile.role_id === 'admin' || perms.some(p => p.permission_type === type && p.permission_key === key && p.allowed);

  return {
    userId, email, name: profile.name, roleId: profile.role_id, seesAllShops, accessibleShopIds,
    canDo: (key) => lookup('module_capability', key),
    hasNav: (key) => lookup('nav', key),
    hasDashboardWidget: (key) => lookup('dashboard_widget', key),
  };
}
```

- [ ] **Step 2: `getSessionContext` — the I/O wrapper used by pages/layouts**

```ts
// lib/auth/session.ts
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { buildSessionContext, type SessionContext } from './buildSessionContext';

export type { SessionContext };

export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRow } = await supabase
    .from('app_users')
    .select('name, role_id, sees_all_shops, user_shop_access(shop_id)')
    .eq('id', user.id)
    .single();
  if (!profileRow) redirect('/login');

  const { data: shops } = await supabase.from('shops').select('id');
  const { data: perms } = await supabase
    .from('role_permissions')
    .select('permission_type, permission_key, allowed')
    .eq('role_id', profileRow.role_id);

  return buildSessionContext(
    user.id,
    user.email!,
    {
      name: profileRow.name,
      role_id: profileRow.role_id,
      sees_all_shops: profileRow.sees_all_shops,
      shop_access: (profileRow.user_shop_access ?? []).map((a: { shop_id: string }) => a.shop_id),
    },
    (shops ?? []).map(s => s.id),
    perms ?? []
  );
}
```

- [ ] **Step 3: Login server action**

```ts
// app/login/actions.ts
'use server';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function login(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect('/dashboard');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

- [ ] **Step 4: Login page (replaces the prototype's email-only `LoginScreen`, reference/v0.4/finnix-film.html:4285-4320, with real email+password auth; keeps the same card-centered visual layout and theme toggle)**

```tsx
// app/login/page.tsx
import { login } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
      <form action={login} className="card p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold mb-1">Finnix Film</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--ink-soft)' }}>เข้าสู่ระบบบริหารจัดการร้าน</p>
        {error && <p className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ background: '#FBEAEC', color: '#B23A48' }}>{error}</p>}
        <label className="text-xs font-medium block mb-1">อีเมล</label>
        <input name="email" type="email" required className="field w-full px-3 py-2 mb-4 text-sm" />
        <label className="text-xs font-medium block mb-1">รหัสผ่าน</label>
        <input name="password" type="password" required className="field w-full px-3 py-2 mb-6 text-sm" />
        <button type="submit" className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold">เข้าสู่ระบบ</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Test — real assertions against the pure `buildSessionContext` function, no client mocking needed**

```ts
// tests/unit/session.test.ts
import { describe, it, expect } from 'vitest';
import { buildSessionContext } from '@/lib/auth/buildSessionContext';

const allShops = ['cm', 'lp', 'py', 'lpg', 'ca'];
const perms = [
  { permission_type: 'nav', permission_key: 'stock', allowed: true },
  { permission_type: 'nav', permission_key: 'permissions', allowed: false },
  { permission_type: 'module_capability', permission_key: 'list.createNew', allowed: true },
  { permission_type: 'module_capability', permission_key: 'stock.editDelete', allowed: false },
];

describe('buildSessionContext', () => {
  it('restricts a shop-scoped sales user to only their assigned shop', () => {
    const ctx = buildSessionContext('u1', 'sales@test.local',
      { name: 'Sales User', role_id: 'sales', sees_all_shops: false, shop_access: ['cm'] }, allShops, perms);
    expect(ctx.seesAllShops).toBe(false);
    expect(ctx.accessibleShopIds).toEqual(['cm']);
  });

  it('grants an admin all shops and all capabilities regardless of role_permissions rows', () => {
    const ctx = buildSessionContext('u2', 'admin@test.local',
      { name: 'Admin', role_id: 'admin', sees_all_shops: false, shop_access: [] }, allShops, []);
    expect(ctx.seesAllShops).toBe(true);
    expect(ctx.accessibleShopIds).toEqual(allShops);
    expect(ctx.canDo('stock.editDelete')).toBe(true);
  });

  it('resolves nav/module capability lookups per-role from the permission rows', () => {
    const ctx = buildSessionContext('u1', 'sales@test.local',
      { name: 'Sales User', role_id: 'sales', sees_all_shops: false, shop_access: ['cm'] }, allShops, perms);
    expect(ctx.hasNav('stock')).toBe(true);
    expect(ctx.hasNav('permissions')).toBe(false);
    expect(ctx.canDo('list.createNew')).toBe(true);
    expect(ctx.canDo('stock.editDelete')).toBe(false);
    expect(ctx.canDo('some.unlisted.key')).toBe(false); // absent row defaults to false, not true
  });
});
```

Run: `npx vitest run tests/unit/session.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add app/login lib/auth tests/unit/session.test.ts
git commit -m "feat(auth): email/password login and session/permission context"
```

---

### Task 10: Domain logic — pure business functions

**Files:**
- Create: `lib/domain/format.ts`, `lib/domain/tickets.ts`, `lib/domain/orders.ts`
- Test: `tests/unit/domain/format.test.ts`, `tests/unit/domain/tickets.test.ts`, `tests/unit/domain/orders.test.ts`

**Interfaces:**
- Produces: `fmt`, `fmtThaiDate`, `thaiBahtText`, `daysFromNow` (format.ts); `itemNetPrice`, `ticketTotal`, `ticketPaid` (tickets.ts); `orderTotal`, `orderPaid` (orders.ts) — consumed by every module task below. These are ported **byte-for-byte in behavior** from `reference/v0.4/finnix-film.html:83-108,331-337,387-394` since they are exactly the calculations the "unchanged functionality" constraint is protecting.

- [ ] **Step 1: Write failing tests for `lib/domain/tickets.ts` (the trickiest one — has a discount branch)**

```ts
// tests/unit/domain/tickets.test.ts
import { describe, it, expect } from 'vitest';
import { itemNetPrice, ticketTotal, ticketPaid } from '@/lib/domain/tickets';

describe('itemNetPrice', () => {
  it('returns soldPrice unchanged when there is no discount', () => {
    expect(itemNetPrice({ soldPrice: 1300 })).toBe(1300);
  });
  it('applies a percent discount', () => {
    expect(itemNetPrice({ soldPrice: 1000, discountType: 'percent', discountValue: 10 })).toBe(900);
  });
  it('applies a flat-amount discount', () => {
    expect(itemNetPrice({ soldPrice: 1000, discountType: 'amount', discountValue: 300 })).toBe(700);
  });
  it('floors at 0 when the discount exceeds the price', () => {
    expect(itemNetPrice({ soldPrice: 100, discountType: 'amount', discountValue: 500 })).toBe(0);
  });
});

describe('ticketTotal / ticketPaid', () => {
  const ticket = {
    items: [{ soldPrice: 5100 }, { soldPrice: 4500, discountType: 'percent', discountValue: 10 }],
    payments: [{ amount: 2000 }, { amount: 1000 }],
  };
  it('sums itemNetPrice across all items', () => {
    expect(ticketTotal(ticket)).toBe(5100 + 4050);
  });
  it('sums payment amounts', () => {
    expect(ticketPaid(ticket)).toBe(3000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/domain/tickets.test.ts`
Expected: FAIL with "Cannot find module '@/lib/domain/tickets'"

- [ ] **Step 3: Implement (ported from reference/v0.4/finnix-film.html:387-394)**

```ts
// lib/domain/tickets.ts
export type TicketItem = { soldPrice: number; discountType?: 'percent' | 'amount'; discountValue?: number };
export type TicketPayment = { amount: number };
export type TicketForTotals = { items: TicketItem[]; payments: TicketPayment[] };

export function itemNetPrice(i: TicketItem): number {
  const price = Number(i.soldPrice || 0);
  if (!i.discountType || !i.discountValue) return price;
  if (i.discountType === 'percent') return Math.max(0, price - (price * Number(i.discountValue)) / 100);
  return Math.max(0, price - Number(i.discountValue));
}

export function ticketTotal(t: TicketForTotals): number {
  return t.items.reduce((s, i) => s + itemNetPrice(i), 0);
}

export function ticketPaid(t: TicketForTotals): number {
  return t.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/domain/tickets.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Same TDD cycle for `lib/domain/orders.ts` (ported from reference/v0.4/finnix-film.html:331-337)**

```ts
// tests/unit/domain/orders.test.ts
import { describe, it, expect } from 'vitest';
import { orderTotal, orderPaid } from '@/lib/domain/orders';

describe('orderTotal', () => {
  it('subtracts returns and adjustments from the items total', () => {
    const order = {
      items: [{ name: 'A', qty: 10, requestedPrice: 1000 }, { name: 'B', qty: 8, requestedPrice: 1500 }],
      returns: [{ item: 'A', qty: 2 }],
      adjustments: [{ amount: 200 }],
    };
    // items: 10*1000 + 8*1500 = 22000; returns: 2*1000 = 2000; adjustments: 200
    expect(orderTotal(order)).toBe(22000 - 2000 - 200);
  });
  it('ignores a return referencing an item not on the order', () => {
    const order = { items: [{ name: 'A', qty: 1, requestedPrice: 100 }], returns: [{ item: 'ghost', qty: 5 }], adjustments: [] };
    expect(orderTotal(order)).toBe(100);
  });
});

describe('orderPaid', () => {
  it('sums payment amounts', () => {
    expect(orderPaid({ payments: [{ amount: 5000 }, { amount: 400 }] })).toBe(5400);
  });
});
```

```ts
// lib/domain/orders.ts
export type OrderItem = { name: string; qty: number; requestedPrice: number };
export type OrderReturn = { item: string; qty: number };
export type OrderAdjustment = { amount: number };
export type OrderPayment = { amount: number };
export type OrderForTotals = { items: OrderItem[]; returns: OrderReturn[]; adjustments: OrderAdjustment[] };

export function orderTotal(o: OrderForTotals): number {
  const itemsTotal = o.items.reduce((s, i) => s + i.qty * i.requestedPrice, 0);
  const returnsTotal = o.returns.reduce((s, r) => {
    const it = o.items.find(i => i.name === r.item);
    return s + (it ? r.qty * it.requestedPrice : 0);
  }, 0);
  const adjustmentsTotal = (o.adjustments ?? []).reduce((s, a) => s + Number(a.amount || 0), 0);
  return itemsTotal - returnsTotal - adjustmentsTotal;
}

export function orderPaid(o: { payments: OrderPayment[] }): number {
  return o.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
}
```

Run: `npx vitest run tests/unit/domain/orders.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Same TDD cycle for `lib/domain/format.ts` (ported from reference/v0.4/finnix-film.html:83-108)**

```ts
// tests/unit/domain/format.test.ts
import { describe, it, expect } from 'vitest';
import { fmt, thaiBahtText, daysFromNow } from '@/lib/domain/format';

describe('fmt', () => {
  it('formats a number as Thai-locale currency-style with 2 decimals', () => {
    expect(fmt(1234.5)).toBe('1,234.50');
  });
  it('treats null/undefined as 0', () => {
    expect(fmt(undefined)).toBe('0.00');
  });
});

describe('thaiBahtText', () => {
  it('renders zero as ศูนย์บาทถ้วน', () => {
    expect(thaiBahtText(0)).toBe('ศูนย์บาทถ้วน');
  });
  it('renders a simple whole number', () => {
    expect(thaiBahtText(100)).toBe('หนึ่งร้อยบาทถ้วน');
  });
});

describe('daysFromNow', () => {
  it('returns a date n days from now, normalized to 09:00', () => {
    const d = daysFromNow(1);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });
});
```

```ts
// lib/domain/format.ts
export function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d;
}

export function fmtThaiDate(d: Date | null | undefined): string {
  if (!d) return '-';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmt(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const NUM_TEXT = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const DIGIT_TEXT = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

function convertGroup(str: string): string {
  let s = '';
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const d = Number(str[i]);
    const pos = len - i - 1;
    if (d === 0) continue;
    if (pos === 1 && d === 1) { s += 'สิบ'; continue; }
    if (pos === 1 && d === 2) { s += 'ยี่สิบ'; continue; }
    if (pos === 0 && d === 1 && len > 1) { s += 'เอ็ด'; continue; }
    s += NUM_TEXT[d] + DIGIT_TEXT[pos];
  }
  return s;
}

export function thaiBahtText(num: number): string {
  const n = Math.round(Number(num) || 0);
  if (n === 0) return 'ศูนย์บาทถ้วน';
  const str = String(n);
  const groups: string[] = [];
  for (let i = str.length; i > 0; i -= 6) groups.push(str.slice(Math.max(0, i - 6), i));
  groups.reverse();
  let result = '';
  groups.forEach((g, idx) => {
    const conv = convertGroup(g.replace(/^0+/, '') || '0');
    if (conv && conv !== 'ศูนย์') result += conv + (idx < groups.length - 1 ? 'ล้าน' : '');
  });
  return result + 'บาทถ้วน';
}
```

**Note for the implementer:** the prototype's `thaiBahtText` (reference/v0.4/finnix-film.html:85-108) has a `convertGroup` inner function whose exact digit-position wording (สิบ/ยี่สิบ/เอ็ด handling) must be copied from the live source, not re-derived — Thai number-to-text has enough irregular cases (10 vs 20 vs 21) that re-deriving from first principles risks subtly wrong output. Read the actual lines before implementing this step and use them verbatim; the sketch above is illustrative of shape, not a substitute for copying the real source.

Run: `npx vitest run tests/unit/domain/format.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add lib/domain tests/unit/domain
git commit -m "feat(domain): port pure business-logic functions with unit tests"
```

---

### Task 11: Shared UI kit (Badge, StatusPill, managed pickers, date/period fields)

**Files:**
- Create: `components/ui/Badge.tsx`, `components/ui/StatusPill.tsx`, `components/ui/ManagedDropdown.tsx`, `components/ui/DateTimeField.tsx`, `components/ui/ManagedChipPicker.tsx`, `components/ui/ManagedMultiChipPicker.tsx`, `components/ui/PeriodShopFilter.tsx`
- Test: one test file per component under `tests/unit/components/ui/`

**Interfaces (exact prop signatures, unchanged from the prototype so every later module task can consume them identically):**
```ts
Badge(props: { status: string; statuses: StatusConfig[] })
StatusPill(props: { label: string; colorMap: { bg: string; text: string; dot: string } })
ManagedDropdown(props: { value: string; onChange: (v: string) => void; options: string[]; setOptions: (opts: string[]) => void; placeholder?: string })
DateTimeField(props: { value: Date; onChange: (d: Date) => void; timeSlots: string[]; setTimeSlots: (s: string[]) => void })
ManagedChipPicker(props: { value: string; onChange: (v: string) => void; options: string[]; setOptions: (opts: string[]) => void })
ManagedMultiChipPicker(props: { values: string[]; onChange: (vs: string[]) => void; options: string[]; setOptions: (opts: string[]) => void })
PeriodShopFilter(props: { shopFilter: string; setShopFilter: (s: string) => void; period: string; setPeriod: (p: string) => void; periodValue: string; setPeriodValue: (v: string) => void; rangeStart: string; setRangeStart: (v: string) => void; rangeEnd: string; setRangeEnd: (v: string) => void; allowAllShops?: boolean; shopOptions?: Shop[] })
```
Where later tasks previously passed `setOptions`/`setStock` etc. as raw `useState` setters against in-memory arrays (reference/v0.4/finnix-film.html:4392's `ticketFormProps`), production call sites instead pass a callback that persists to the relevant Supabase table (`option_lists` for the flat pickers) and then updates local component state from the write result — the picker components' own internals don't need to know the difference, since their prop contract is unchanged.

- [ ] **Step 1: `Badge` — full source is short enough to specify directly (ported verbatim from reference/v0.4/finnix-film.html:395-400)**

```tsx
// components/ui/Badge.tsx
export type StatusConfig = { key: string; short: string; bg: string; text: string; dot: string };

export function getStatus(statuses: StatusConfig[], key: string): StatusConfig {
  return statuses.find(s => s.key === key) ?? statuses[0] ?? { key, short: key, bg: '#F1EDE7', text: '#6B5F55', dot: '#B5AAA1' };
}

export function Badge({ status, statuses }: { status: string; statuses: StatusConfig[] }) {
  const c = getStatus(statuses, status);
  return (
    <span className="text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5" style={{ background: c.bg, color: c.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }}></span>{c.short || status}
    </span>
  );
}
```

```tsx
// tests/unit/components/ui/Badge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, type StatusConfig } from '@/components/ui/Badge';

const statuses: StatusConfig[] = [
  { key: 'จองแล้ว', short: 'จองแล้ว', bg: '#F1EDE7', text: '#6B5F55', dot: '#B5AAA1' },
  { key: 'ค้างชำระ', short: 'ค้างชำระ', bg: '#FBEAEC', text: '#B23A48', dot: '#C24B57' },
];

describe('Badge', () => {
  it('renders the short label and color for a known status', () => {
    render(<Badge status="ค้างชำระ" statuses={statuses} />);
    expect(screen.getByText('ค้างชำระ')).toBeInTheDocument();
  });
  it('falls back to the first status config for an unknown status key', () => {
    render(<Badge status="ไม่มีจริง" statuses={statuses} />);
    expect(screen.getByText('จองแล้ว')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/unit/components/ui/Badge.test.tsx` → Expected: PASS (2 tests)

- [ ] **Step 2: Remaining pickers — port from source, one component + one test per sub-step**

For each of `StatusPill` (reference/v0.4/finnix-film.html:2470-2476), `ManagedDropdown` (:1150-1183), `DateTimeField` (:1184-1196), `ManagedChipPicker` (:1197-1237), `ManagedMultiChipPicker` (:1238-1269), `PeriodShopFilter` (:2477-2525):
1. Read the exact source lines from `reference/v0.4/finnix-film.html`.
2. Create the matching file under `components/ui/` with the same JSX/behavior, converted to TypeScript with the prop types listed above, and `'use client'` at the top (all of these hold local interactive state).
3. Write a component test in `tests/unit/components/ui/<Name>.test.tsx` using React Testing Library that asserts the component's one or two most important behaviors — for `ManagedChipPicker`/`ManagedDropdown`/`ManagedMultiChipPicker`: selecting an existing option calls `onChange` with that value, and typing a new value and confirming it calls both `setOptions` (with the new value appended) and `onChange`; for `DateTimeField`: changing the date part preserves the time-of-day and vice versa; for `PeriodShopFilter`: switching `period` between `'month'`/`'range'`/`'year'` shows/hides the corresponding input fields; for `StatusPill`: renders `label` with the given `colorMap` applied as inline styles.
4. Run the test, confirm PASS, commit each component individually (`git commit -m "feat(ui): port <Name> from prototype"`).

- [ ] **Step 3: Final commit for the task once all six are done**

```bash
git add components/ui tests/unit/components/ui
git commit -m "feat(ui): shared managed-picker component kit"
```

---

### Task 12: Layout shell — Sidebar, Header, authenticated route group

**Files:**
- Create: `components/layout/Sidebar.tsx`, `components/layout/Header.tsx`, `app/(app)/layout.tsx`
- Test: `tests/unit/components/layout/Sidebar.test.tsx`, `tests/unit/components/layout/Header.test.tsx`

**Interfaces:**
- Consumes: `getSessionContext()` (Task 9), `hasNav` for gating which sidebar items render.
- Produces: the authenticated shell every module page (Tasks 13-19) renders inside.

- [ ] **Step 1: Port `Sidebar` and `Header` from reference/v0.4/finnix-film.html:402-452 and :453-498**

Read the exact source, then create `components/layout/Sidebar.tsx` and `components/layout/Header.tsx` as Client Components. Adapt: `currentRoleId`/`navPermissions` prop pair becomes a single `hasNav: (navKey: string) => boolean` function prop (from `SessionContext`); `view`/`setView` becomes Next.js `<Link>`/`usePathname()` navigation instead of local state, since routing is now real URLs (Task 11's file-structure section lists the route-to-nav mapping). Logout button calls the `logout()` server action from `app/login/actions.ts` (Task 9).

```tsx
// tests/unit/components/layout/Sidebar.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/layout/Sidebar';

describe('Sidebar', () => {
  it('hides nav items the current role does not have access to', () => {
    render(<Sidebar activePath="/dashboard" hasNav={(k) => k === 'dashboard'} />);
    expect(screen.getByText('แดชบอร์ด')).toBeInTheDocument();
    expect(screen.queryByText('จัดการสิทธิ์')).not.toBeInTheDocument();
  });
  it('shows all nav items for a role with full access', () => {
    render(<Sidebar activePath="/dashboard" hasNav={() => true} />);
    expect(screen.getByText('จัดการสิทธิ์')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/unit/components/layout/Sidebar.test.tsx` → Expected: PASS (2 tests)

- [ ] **Step 2: Authenticated layout wiring**

```tsx
// app/(app)/layout.tsx
import { getSessionContext } from '@/lib/auth/session';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();
  return (
    <div className="min-h-screen flex" style={{ background: 'var(--paper)' }}>
      <Sidebar hasNav={session.hasNav} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Header name={session.name} roleId={session.roleId} />
        <main className="flex-1 px-4 sm:px-6 py-6 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Header test + commit**

Write `tests/unit/components/layout/Header.test.tsx` asserting the user's name and role label render, and a logout control is present. Run it, confirm PASS, then:

```bash
git add components/layout app/\(app\)/layout.tsx tests/unit/components/layout
git commit -m "feat(layout): authenticated shell with permission-gated sidebar"
```

---

### Task 13: Charts + Dashboard

**Files:**
- Create: `components/charts/{DoughnutChart,BarChart,LineChart}.tsx`
- Create: `lib/domain/dashboard.ts` (receivables/payables + revenue aggregation, ported from reference/v0.4/finnix-film.html:660-684)
- Create: `components/dashboard/{Dashboard,JobCalendar}.tsx`, `app/(app)/dashboard/page.tsx`
- Test: `tests/unit/domain/dashboard.test.ts`, `tests/unit/components/dashboard/Dashboard.test.tsx`

**Interfaces:**
- Produces: `computeReceivables(tickets, orders, customers, shopFilter): ARItem[]`, `computePayables(expenses, shopFilter): APItem[]` — the same "ลูกหนี้/เจ้าหนี้" logic the prototype computes inline inside `Dashboard()`.
- Consumes: `ticketTotal`/`ticketPaid` (Task 10), `orderTotal`/`orderPaid` (Task 10).

- [ ] **Step 1: Port the three chart wrappers from reference/v0.4/finnix-film.html:499-570 to `react-chartjs-2`**

Read the exact source (each is a small `useRef`+`useEffect` Chart.js wrapper today, since the prototype has no React chart bindings). Reimplement each as a thin `react-chartjs-2` component (`<Doughnut>`, `<Bar>`, `<Line>`) with equivalent `data`/`options` config producing the same visual (same colors, same legend/tooltip behavior) — `react-chartjs-2` replaces the manual ref/lifecycle management, it does not change what's rendered.

- [ ] **Step 2: Write failing test for the receivables/payables computation**

```ts
// tests/unit/domain/dashboard.test.ts
import { describe, it, expect } from 'vitest';
import { computeReceivables, computePayables } from '@/lib/domain/dashboard';

describe('computeReceivables', () => {
  it('includes an unpaid ticket and an unpaid wholesale order, sorted by amount descending', () => {
    const tickets = [{ id: 'JT-1', shop: 'cm', customer: 'A', plate: '1กก', items: [{ soldPrice: 1000 }], payments: [] }];
    const orders = [{ id: 'WS-1', shop: 'cm', customerId: 1, items: [{ name: 'X', qty: 1, requestedPrice: 5000 }], returns: [], adjustments: [], payments: [] }];
    const customers = [{ id: 1, name: 'ร้านทดสอบ' }];
    const result = computeReceivables(tickets, orders, customers, 'all');
    expect(result.map(r => r.source)).toEqual(['ขายส่ง', 'ใบงานติดตั้ง']); // 5000 > 1000, descending
    expect(result[0].amount).toBe(5000);
  });
  it('excludes a fully-paid ticket', () => {
    const tickets = [{ id: 'JT-1', shop: 'cm', customer: 'A', plate: '1กก', items: [{ soldPrice: 1000 }], payments: [{ amount: 1000 }] }];
    expect(computeReceivables(tickets, [], [], 'all')).toHaveLength(0);
  });
});

describe('computePayables', () => {
  it('only includes expenses with status รอจ่าย, filtered by shop', () => {
    const expenses = [
      { id: 1, shop: 'cm', desc: 'A', category: 'ค่าเช่า', amount: 1000, status: 'รอจ่าย', due: '25 ก.ค.' },
      { id: 2, shop: 'lp', desc: 'B', category: 'ค่าเช่า', amount: 2000, status: 'รอจ่าย', due: '25 ก.ค.' },
      { id: 3, shop: 'cm', desc: 'C', category: 'ค่าเช่า', amount: 500, status: 'จ่ายแล้ว', due: '' },
    ];
    expect(computePayables(expenses, 'cm')).toEqual([{ id: 1, name: 'A', amount: 1000, source: 'ค่าเช่า', due: '25 ก.ค.' }]);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then implement (ported from reference/v0.4/finnix-film.html:666-680)**

```ts
// lib/domain/dashboard.ts
import { ticketTotal, ticketPaid, type TicketForTotals } from './tickets';
import { orderTotal, orderPaid, type OrderForTotals } from './orders';

type ARItem = { id: string; name: string; amount: number; source: 'ใบงานติดตั้ง' | 'ขายส่ง' };
type APItem = { id: number; name: string; amount: number; source: string; due: string };

export function computeReceivables(
  tickets: (TicketForTotals & { id: string; shop: string; customer: string; plate: string })[],
  orders: (OrderForTotals & { id: string; shop: string; customerId: number })[],
  customers: { id: number; name: string }[],
  shopFilter: string
): ARItem[] {
  const visible = tickets.filter(t => shopFilter === 'all' || t.shop === shopFilter);
  const arFromTickets: ARItem[] = visible
    .filter(t => ticketTotal(t) > ticketPaid(t))
    .map(t => ({ id: t.id, name: `${t.customer} (${t.plate})`, amount: ticketTotal(t) - ticketPaid(t), source: 'ใบงานติดตั้ง' as const }));
  const wsVisible = orders.filter(o => shopFilter === 'all' || o.shop === shopFilter);
  const arFromOrders: ARItem[] = wsVisible
    .filter(o => orderTotal(o) > orderPaid(o))
    .map(o => ({
      id: o.id,
      name: `${customers.find(c => c.id === o.customerId)?.name ?? 'ยังไม่ระบุลูกค้า'} (${o.id})`,
      amount: orderTotal(o) - orderPaid(o),
      source: 'ขายส่ง' as const,
    }));
  return [...arFromTickets, ...arFromOrders].sort((a, b) => b.amount - a.amount);
}

export function computePayables(
  expenses: { id: number; shop: string; desc: string; category: string; amount: number; status: string; due?: string }[],
  shopFilter: string
): APItem[] {
  return expenses
    .filter(e => (shopFilter === 'all' || e.shop === shopFilter) && e.status === 'รอจ่าย')
    .map(e => ({ id: e.id, name: e.desc, amount: Number(e.amount), source: e.category, due: e.due ?? '' }))
    .sort((a, b) => b.amount - a.amount);
}
```

Run: `npx vitest run tests/unit/domain/dashboard.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Port `Dashboard` and `JobCalendar` components (reference/v0.4/finnix-film.html:642-958,571-641)**

Read the exact source. Adapt: the prototype computes `revenue`, `expenseByCategory`, `stockByCategory`, `shopBreakdown`, and the random-seeded `trend` series (`buildTrendSeries`, lines 112-139) all client-side from in-memory arrays passed as props. In production:
- `computeReceivables`/`computePayables` (this task) replace the inline AR/AP computation — same output shape, same UI.
- Revenue/expense/stock-by-category aggregates become Postgres queries (`select shop_id, sum(...) ... group by ...`) run server-side in `app/(app)/dashboard/page.tsx`, passed to `Dashboard` as props — same displayed numbers, computed in SQL instead of by iterating a full in-memory array, since the array no longer exists client-side.
- `buildTrendSeries`'s seeded-random synthetic history is **not** ported — it exists in the prototype purely because there's no real historical data to chart. Replace it with a real query aggregating `tickets`/`orders`/`expenses` by day/week/month over the selected period, keeping the exact same chart shape (`{labels, revenue, expense, profit}`) so `LineChart` (Task 13, Step 1) needs no changes. This is the one place in the whole port where "same visual, different data source" is the explicit, intentional behavior — not a bug to preserve.
- Every widget stays gated behind `hasDashboardWidget(key)` from `SessionContext` (Task 9), replacing the prototype's `dashboardPermissions[role]` prop lookup — same keys, same default gating per role (spec §2 migration 0002).

```tsx
// tests/unit/components/dashboard/Dashboard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dashboard } from '@/components/dashboard/Dashboard';

describe('Dashboard', () => {
  it('hides the revenue card when hasDashboardWidget("revenue") is false', () => {
    render(<Dashboard hasDashboardWidget={(k) => k !== 'revenue'} revenue={99999} totalExpenses={0} cashBalance={0}
      arItems={[]} apItems={[]} shopBreakdown={[]} expenseByCategory={[]} trend={{ labels: [], revenue: [], expense: [], profit: [] }} />);
    expect(screen.queryByText('ยอดขายรวม (บาท)')).not.toBeInTheDocument();
  });
  it('shows the receivables card with items when the widget is enabled', () => {
    render(<Dashboard hasDashboardWidget={() => true} revenue={0} totalExpenses={0} cashBalance={0}
      arItems={[{ id: 'JT-1', name: 'คุณ เอ (1กก)', amount: 3100, source: 'ใบงานติดตั้ง' }]} apItems={[]}
      shopBreakdown={[]} expenseByCategory={[]} trend={{ labels: [], revenue: [], expense: [], profit: [] }} />);
    expect(screen.getByText('คุณ เอ (1กก)')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/unit/components/dashboard/Dashboard.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: `app/(app)/dashboard/page.tsx` — server component fetching, mapping, and passing props**

```tsx
// app/(app)/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getSessionContext } from '@/lib/auth/session';
import { computeReceivables, computePayables } from '@/lib/domain/dashboard';
import { Dashboard } from '@/components/dashboard/Dashboard';

export default async function DashboardPage() {
  const session = await getSessionContext();
  const supabase = await createClient();
  const [{ data: ticketRows }, { data: orderRows }, { data: customerRows }, { data: expenseRows }] = await Promise.all([
    supabase.from('tickets').select('id, shop_id, customer_name, plate, ticket_items(sold_price, discount_type, discount_value), ticket_payments(amount)'),
    supabase.from('orders').select('id, shop_id, customer_id, order_items(name, qty, requested_price), order_returns(item_name, qty), order_adjustments(amount), order_payments(amount)'),
    supabase.from('wholesale_customers').select('id, name'),
    supabase.from('expenses').select('id, shop_id, description, category, amount, status, due_at'),
  ]);

  const tickets = (ticketRows ?? []).map(t => ({
    id: t.id, shop: t.shop_id, customer: t.customer_name, plate: t.plate,
    items: (t.ticket_items ?? []).map(i => ({ soldPrice: i.sold_price, discountType: i.discount_type, discountValue: i.discount_value })),
    payments: (t.ticket_payments ?? []).map(p => ({ amount: p.amount })),
  }));
  const orders = (orderRows ?? []).map(o => ({
    id: o.id, shop: o.shop_id, customerId: o.customer_id,
    items: (o.order_items ?? []).map(i => ({ name: i.name, qty: i.qty, requestedPrice: i.requested_price })),
    returns: (o.order_returns ?? []).map(r => ({ item: r.item_name, qty: r.qty })),
    adjustments: (o.order_adjustments ?? []).map(a => ({ amount: a.amount })),
    payments: (o.order_payments ?? []).map(p => ({ amount: p.amount })),
  }));
  const customers = (customerRows ?? []).map(c => ({ id: c.id, name: c.name }));
  const expenses = (expenseRows ?? []).map(e => ({
    id: e.id, shop: e.shop_id, desc: e.description, category: e.category, amount: e.amount, status: e.status, due: e.due_at ?? '',
  }));

  const shopFilter = 'all';
  const arItems = computeReceivables(tickets, orders, customers, shopFilter);
  const apItems = computePayables(expenses, shopFilter);
  const revenue = tickets.reduce((s, t) => s + t.items.reduce((si, i) => si + Number(i.soldPrice || 0), 0), 0);
  const totalExpenses = expenses.filter(e => e.status === 'จ่ายแล้ว').reduce((s, e) => s + Number(e.amount || 0), 0);

  return (
    <Dashboard
      hasDashboardWidget={session.hasDashboardWidget}
      revenue={revenue}
      totalExpenses={totalExpenses}
      cashBalance={0}
      arItems={arItems}
      apItems={apItems}
      shopBreakdown={[]}
      expenseByCategory={[]}
      trend={{ labels: [], revenue: [], expense: [], profit: [] }}
    />
  );
}
```

`cashBalance`, `shopBreakdown`, `expenseByCategory`, and `trend` are left as their zero/empty values here deliberately — they depend on the petty-cash topup/spend aggregation and the real-data trend query described in Step 4's port notes, which are themselves each a `select ... group by` query in the same shape as the `revenue`/`totalExpenses` queries above. Add those three queries following the exact same map-then-aggregate pattern shown for `revenue` before this task is considered done; the `Dashboard` component (Step 4) already renders them correctly once populated, so no component changes are needed — only these remaining query fills.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, log in as `admin@finnixfilm.com`, and confirm the dashboard's receivables/payables figures match a manual SQL check against the seeded data (Task 3's/Task 20's seed rows) — e.g. `select sum(amount) from expenses where status = 'รอจ่าย';` should equal the "เจ้าหนี้" card total. Record this manual check in the PR description.

- [ ] **Step 7: Commit**

```bash
git add components/charts components/dashboard app/\(app\)/dashboard lib/domain/dashboard.ts tests/unit/domain/dashboard.test.ts tests/unit/components/dashboard
git commit -m "feat(dashboard): charts, receivables/payables, and dashboard page"
```

---

### Task 14: Job Tickets module (list, detail/new, print sheet)

**Files:**
- Create: `components/tickets/{TicketList,TicketDetail,TicketCustomerPicker,PrintJobSheet}.tsx`
- Create: `app/(app)/tickets/page.tsx`, `app/(app)/tickets/new/page.tsx`, `app/(app)/tickets/[id]/page.tsx`
- Create: `app/(app)/tickets/actions.ts` (server actions for create/update/status-change)
- Test: `tests/unit/components/tickets/TicketList.test.tsx`, `tests/e2e/tickets.spec.ts` (Playwright, written now but run as part of Task 21)

**Interfaces:**
- Consumes: `ticketTotal`/`ticketPaid`/`itemNetPrice` (Task 10), `Badge`/`getStatus` (Task 11), `session.canDo('list.createNew')`/`session.canDo('list.printSheet')` (Task 9).
- Produces: `createTicket(formData)`, `updateTicketStatus(ticketId, newStatus)` server actions, mirroring reference/v0.4/finnix-film.html:4384-4390 (`openNew`, `updateTicket`, `updateTicketStatus`).

- [ ] **Step 1: Port `TicketList` (reference/v0.4/finnix-film.html:959-1149)**

Read the exact source. Adapt: filtering/sorting stays client-side over the fetched page's tickets (same UX); the "สร้างใบงานใหม่" button is hidden unless `canDo('list.createNew')`; shop-scoping is now enforced twice — visibly via `accessibleShops` (same as today, drives which shop filter chips show) and invisibly via RLS (Task 7) as the real backstop.

```tsx
// tests/unit/components/tickets/TicketList.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketList } from '@/components/tickets/TicketList';

const tickets = [
  { id: 'JT-CM-00214', shop: 'cm', customer: 'คุณ เอ', plate: '250 กก', status: 'กำลัง QC ก่อนติดตั้ง', items: [{ soldPrice: 5100 }], payments: [] },
];
const statuses = [{ key: 'กำลัง QC ก่อนติดตั้ง', short: 'รอ QC', bg: '#FBF1DA', text: '#8A5A12', dot: '#E8B23D' }];

describe('TicketList', () => {
  it('renders a ticket row with its status badge', () => {
    render(<TicketList tickets={tickets} statuses={statuses} canDo={() => true} accessibleShops={[{ id: 'cm', name: 'CM' }]} />);
    expect(screen.getByText('คุณ เอ')).toBeInTheDocument();
    expect(screen.getByText('รอ QC')).toBeInTheDocument();
  });
  it('hides the "create new" button when canDo("list.createNew") is false', () => {
    render(<TicketList tickets={tickets} statuses={statuses} canDo={() => false} accessibleShops={[{ id: 'cm', name: 'CM' }]} />);
    expect(screen.queryByText('สร้างใบงานใหม่')).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/unit/components/tickets/TicketList.test.tsx` → Expected: PASS (2 tests)

- [ ] **Step 2: Port `TicketDetail` and `TicketCustomerPicker` (reference/v0.4/finnix-film.html:1310-2469, 1270-1309) — the largest single component in the prototype (~1,150 lines)**

Read the exact source in full before starting (it will not fit in one context window alongside other files — read it in the 3-4 chunks the source's own internal sections suggest: customer/vehicle info, items-by-category with position pickers, payments, extras). Split into the same internal sections the source already uses, as separate files under `components/tickets/detail/` (e.g. `VehicleInfoSection.tsx`, `ItemsSection.tsx`, `PaymentsSection.tsx`, `ExtrasSection.tsx`), composed by `TicketDetail.tsx`. Adapt:
- All the `Managed*` props (`bookingChannels`/`setBookingChannels`, `carBrands`/`setCarBrands`, etc.) now read from and write to `option_lists` (Task 3) instead of local `useState` arrays — same picker components (Task 11), different data source behind `setOptions`.
- Saving calls the `createTicket`/`updateTicket` server actions (Step 4 below) instead of the prototype's local `updateTicket(t)` (reference/v0.4/finnix-film.html:4385-4387); optimistic UI update, reconciled on server response, with an inline error message on failure (this project's "fix bugs/improve" allowance — the prototype has no save-failure handling today since saves can't fail against in-memory state).
- `useUnsavedChangesGuard`/`confirmDiscardIfDirty` (reference/v0.4/finnix-film.html:374-386) port unchanged — still relevant with a real backend, since navigating away before saving should still warn.
- Component test: assert that (a) selecting a service category renders its item row, (b) `ticketTotal` shown matches the sum of `itemNetPrice` across entered items (using Task 10's real function, not a re-implementation), (c) the payments list renders each payment and the "ยอดค้างชำระ" (outstanding) figure equals `ticketTotal - ticketPaid`.

- [ ] **Step 3: Port `PrintJobSheet` (the `.print-area` block rendered inside `TicketDetail`, search reference/v0.4/finnix-film.html for `print-area` near the end of the `TicketDetail` function)**

This is the physical work-order sheet technicians print. Port the exact table layout/columns. Verify with a manual check (Playwright's `page.emulateMedia({ media: 'print' })` + a visual screenshot comparison, or a manual browser print-preview) rather than a DOM unit test, since the meaningful behavior here is print layout (page size, margins, hidden-on-screen), which `@media print` unit tests can't exercise well — record this as a manual QA step in the task's completion notes, not skipped silently.

- [ ] **Step 4: Server actions**

```ts
// app/(app)/tickets/actions.ts
'use server';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function updateTicketStatus(ticketId: string, newStatus: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('tickets').update({ status: newStatus }).eq('id', ticketId);
  if (error) throw new Error(error.message);
  await supabase.from('ticket_status_history').insert({ ticket_id: ticketId, status: newStatus });
  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
}
```

(`createTicket`/`updateTicket` follow the same shape — insert/update `tickets` plus upsert `ticket_items`/`ticket_item_positions`/`ticket_payments` in a single request; write these alongside Step 2 once `TicketDetail`'s exact field list is ported, since the action's input shape must match the form's output shape exactly.)

- [ ] **Step 5: Playwright e2e spec (written now, executed in Task 21 once the full app is wired end-to-end)**

```ts
// tests/e2e/tickets.spec.ts
import { test, expect } from '@playwright/test';

test('sales user can create a ticket and see it in the list', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=email]', 'sales@finnixfilm.com');
  await page.fill('input[name=password]', 'test-password-123');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/dashboard/);

  await page.goto('/tickets/new');
  await page.fill('input[name=customerName]', 'คุณ ทดสอบ E2E');
  await page.fill('input[name=plate]', '9กก 9999');
  await page.click('button:has-text("บันทึก")');

  await page.goto('/tickets');
  await expect(page.getByText('คุณ ทดสอบ E2E')).toBeVisible();
});
```

- [ ] **Step 6: Commit**

```bash
git add components/tickets app/\(app\)/tickets tests/unit/components/tickets tests/e2e/tickets.spec.ts
git commit -m "feat(tickets): job ticket list, detail/new form, and print sheet"
```

---

### Task 15: Wholesale module

**Files:**
- Create: `components/wholesale/{WholesaleList,WholesaleDetail,CustomerPicker}.tsx`
- Create: `app/(app)/wholesale/page.tsx`, `app/(app)/wholesale/[id]/page.tsx`, `app/(app)/wholesale/actions.ts`
- Test: `tests/unit/components/wholesale/WholesaleDetail.test.tsx`

**Interfaces:**
- Consumes: `orderTotal`/`orderPaid` (Task 10), `session.canDo('wholesale.priceApproval')`/`session.canDo('wholesale.badDebt')`/`session.canDo('wholesale.export')` (Task 9).

- [ ] **Step 1: Port `WholesaleList` and `CustomerPicker` (reference/v0.4/finnix-film.html:2526-2648, 2649-2689)** following the same pattern as Task 14 Step 1.

- [ ] **Step 2: Port `WholesaleDetail` (reference/v0.4/finnix-film.html:2690-2967)**

Read the exact source. This is where the price-approval workflow lives (`รออนุมัติราคา` → approve/reject) and bad-debt marking — both must be gated server-side, not just hidden in the UI:

```ts
// app/(app)/wholesale/actions.ts (excerpt — the capability-gated transitions)
'use server';
import { createClient } from '@/lib/supabase/server';
import { getSessionContext } from '@/lib/auth/session';

export async function approveOrderPrice(orderId: string, itemId: number, approvedPrice: number) {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.priceApproval')) throw new Error('ไม่มีสิทธิ์อนุมัติราคา');
  const supabase = await createClient();
  const { error } = await supabase.from('order_items').update({ requested_price: approvedPrice }).eq('id', itemId);
  if (error) throw new Error(error.message);
}

export async function markOrderBadDebt(orderId: string) {
  const session = await getSessionContext();
  if (!session.canDo('wholesale.badDebt')) throw new Error('ไม่มีสิทธิ์แจ้งตัดหนี้สูญ');
  const supabase = await createClient();
  const { error } = await supabase.from('orders').update({ status: 'ตัดหนี้สูญ' }).eq('id', orderId);
  if (error) throw new Error(error.message);
}
```

This double-gates the two capabilities the prototype's `MODULE_CAPABILITIES` names explicitly (`wholesale.priceApproval`, `wholesale.badDebt`) — checked in the server action (so a sales-role user can't call it directly even bypassing the UI) in addition to hiding the corresponding buttons client-side (same as the prototype does today, just now backed by a real check).

- [ ] **Step 3: Component test**

```tsx
// tests/unit/components/wholesale/WholesaleDetail.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WholesaleDetail } from '@/components/wholesale/WholesaleDetail';

const order = { id: 'WS-CM-0091', status: 'รออนุมัติราคา', items: [{ name: 'ฟิล์ม 3M CRM (ม้วน)', qty: 10, requestedPrice: 1000 }], returns: [], adjustments: [], payments: [] };

describe('WholesaleDetail', () => {
  it('hides the approve-price control when canDo("wholesale.priceApproval") is false', () => {
    render(<WholesaleDetail order={order} canDo={() => false} />);
    expect(screen.queryByText('อนุมัติราคา')).not.toBeInTheDocument();
  });
  it('shows the computed order total using orderTotal, not a re-derived number', () => {
    render(<WholesaleDetail order={order} canDo={() => true} />);
    expect(screen.getByText(/10,000\.00/)).toBeInTheDocument(); // 10 * 1000, via lib/domain/orders.ts
  });
});
```

Run: `npx vitest run tests/unit/components/wholesale/WholesaleDetail.test.tsx` → Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add components/wholesale app/\(app\)/wholesale tests/unit/components/wholesale
git commit -m "feat(wholesale): order list, detail with gated price-approval/bad-debt actions"
```

---

### Task 16: Stock module

**Files:**
- Create: `components/stock/StockModule.tsx`
- Create: `app/(app)/stock/page.tsx`, `app/(app)/stock/actions.ts`
- Test: `tests/unit/components/stock/StockModule.test.tsx`

**Interfaces:**
- Consumes: `session.canDo('stock.addProduct'|'stock.adjustStock'|'stock.withdraw'|'stock.editDelete'|'stock.export')`, `session.hasDashboardWidget('seeStockPrices')` (gates whether cost/sellPrice columns show, per reference/v0.4/finnix-film.html:194).

- [ ] **Step 1: Port `StockModule` (reference/v0.4/finnix-film.html:2980-3462)**

Read the exact source. Adapt: low-stock highlighting (`qty <= min`) stays a client-side comparison over fetched rows (cheap, no need to push into SQL); every mutating action (add product, adjust qty, withdraw, edit/delete) is a server action gated by the matching `stock.*` capability, mirroring the Task 15 pattern. Cost/sell-price columns render only when `hasDashboardWidget('seeStockPrices')` is true — otherwise only `qty`/`min` show, exactly matching the prototype's existing `seeStockPrices` gate (reference/v0.4/finnix-film.html:194,197-200).

- [ ] **Step 2: Component test**

```tsx
// tests/unit/components/stock/StockModule.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockModule } from '@/components/stock/StockModule';

const stock = [{ id: 1, sku: 'SKU-FLM-3M60', name: 'ฟิล์ม 3M CRM 60%', category: 'ฟิล์มกรองแสง', shop: 'cm', qty: 15, min: 10, cost: 850, sellPrice: 1700 }];

describe('StockModule', () => {
  it('hides cost/sellPrice when seeStockPrices is false', () => {
    render(<StockModule stock={stock} canDo={() => true} canSeeStockPrices={false} />);
    expect(screen.queryByText('850.00')).not.toBeInTheDocument();
  });
  it('shows cost/sellPrice when seeStockPrices is true', () => {
    render(<StockModule stock={stock} canDo={() => true} canSeeStockPrices={true} />);
    expect(screen.getByText('850.00')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/unit/components/stock/StockModule.test.tsx` → Expected: PASS (2 tests)

- [ ] **Step 3: Commit**

```bash
git add components/stock app/\(app\)/stock tests/unit/components/stock
git commit -m "feat(stock): inventory module with price-visibility and capability gating"
```

---

### Task 17: Commission module

**Files:**
- Create: `components/commission/CommissionModule.tsx`
- Create: `app/(app)/commission/page.tsx`, `app/(app)/commission/actions.ts`
- Test: `tests/unit/components/commission/CommissionModule.test.tsx`

**Interfaces:**
- Consumes: `session.canDo('commission.addRule')`.
- Note: the prototype's Commission module (reference/v0.4/finnix-film.html:3463-3527) is rule *configuration* only — it does not compute payouts anywhere in the source (confirmed: no `calcCommission`/payout function exists). The port stays configuration-only; do not add a payout-calculation feature not present in the prototype (that would violate the "unchanged functionality" constraint, not honor it).

- [ ] **Step 1: Port `CommissionModule` (reference/v0.4/finnix-film.html:3463-3527)**, gating rule creation behind `canDo('commission.addRule')`, reading/writing `commission_rules` + `commission_rule_teams` (Task 6).

- [ ] **Step 2: Component test**

```tsx
// tests/unit/components/commission/CommissionModule.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommissionModule } from '@/components/commission/CommissionModule';

const rules = [{ id: 1, category: 'ค่าคอมพนักงาน', name: 'ค่าคอมขายรวม 3%', type: 'percent_of_sale', value: 3, shop: 'cm', team: ['กมล'], active: true }];

describe('CommissionModule', () => {
  it('hides the add-rule button when canDo("commission.addRule") is false', () => {
    render(<CommissionModule rules={rules} canDo={() => false} />);
    expect(screen.queryByText('เพิ่มกฎใหม่')).not.toBeInTheDocument();
  });
  it('renders an existing rule\'s name and team members', () => {
    render(<CommissionModule rules={rules} canDo={() => true} />);
    expect(screen.getByText('ค่าคอมขายรวม 3%')).toBeInTheDocument();
    expect(screen.getByText('กมล')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/unit/components/commission/CommissionModule.test.tsx` → Expected: PASS (2 tests)

- [ ] **Step 3: Commit**

```bash
git add components/commission app/\(app\)/commission tests/unit/components/commission
git commit -m "feat(commission): rule configuration module"
```

---

### Task 18: Accounting module

**Files:**
- Create: `components/accounting/AccountingModule.tsx`
- Create: `app/(app)/accounting/page.tsx`, `app/(app)/accounting/actions.ts`
- Test: `tests/unit/components/accounting/AccountingModule.test.tsx`

**Interfaces:**
- Consumes: `session.canDo('accounting.addExpense'|'accounting.topupCash'|'accounting.export')`.

- [ ] **Step 1: Port `AccountingModule` (reference/v0.4/finnix-film.html:3528-3902)**, covering both expenses and petty cash sections, gated per the two capabilities above.

- [ ] **Step 2: Component test**

```tsx
// tests/unit/components/accounting/AccountingModule.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountingModule } from '@/components/accounting/AccountingModule';

const expenses = [{ id: 1, shop: 'cm', desc: 'ค่าเช่าร้านเดือนกรกฎาคม', category: 'ค่าเช่า', source: 'บัญชีธนาคารสาขา', amount: 35000, status: 'จ่ายแล้ว' }];
const pettyCash = [{ id: 1, shop: 'cm', type: 'เติมเงิน', amount: 10000 }];

describe('AccountingModule', () => {
  it('hides the topup-cash button when canDo("accounting.topupCash") is false', () => {
    render(<AccountingModule expenses={expenses} pettyCash={pettyCash} canDo={() => false} />);
    expect(screen.queryByText('เติมเงินสดย่อย')).not.toBeInTheDocument();
  });
  it('renders an expense row with its amount formatted via lib/domain/format.ts fmt()', () => {
    render(<AccountingModule expenses={expenses} pettyCash={pettyCash} canDo={() => true} />);
    expect(screen.getByText('35,000.00')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/unit/components/accounting/AccountingModule.test.tsx` → Expected: PASS (2 tests)

- [ ] **Step 3: Commit**

```bash
git add components/accounting app/\(app\)/accounting tests/unit/components/accounting
git commit -m "feat(accounting): expenses and petty cash module"
```

---

### Task 19: Permissions module

**Files:**
- Create: `components/permissions/PermissionsModule.tsx`
- Create: `app/(app)/permissions/page.tsx`, `app/(app)/permissions/actions.ts`
- Test: `tests/unit/components/permissions/PermissionsModule.test.tsx`

**Interfaces:**
- Consumes/produces: reads and writes `roles`, `role_permissions`, `statuses`, `ws_statuses`, `shop_info`, `app_users`, `user_shop_access` (Tasks 2, 3, 5) — this module *is* the admin UI for editing config-as-data, per spec §7.

- [ ] **Step 1: Port `PermissionsModule` (reference/v0.4/finnix-film.html:3903-4284)**

Read the exact source. This module is only reachable at all when `hasNav('permissions')` is true (default: admin only), enforced both by the sidebar (Task 12, already hides the link) and by RLS on `role_permissions`/`roles`/`statuses`/`app_users` (Task 7's `current_user_has_nav('permissions')` policies) — so even a direct URL visit or API call from a non-permitted role is rejected at the database, not just hidden.

- [ ] **Step 2: Component test**

```tsx
// tests/unit/components/permissions/PermissionsModule.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionsModule } from '@/components/permissions/PermissionsModule';

const roles = [{ id: 'sales', name: 'พนักงานขาย', icon: 'fa-user-tie' }];

describe('PermissionsModule', () => {
  it('renders a role and lets its module capabilities be toggled', () => {
    render(<PermissionsModule roles={roles} modulePermissions={{ sales: { 'stock.editDelete': false } }} onToggle={() => {}} />);
    const toggle = screen.getByRole('checkbox', { name: /stock: แก้ไข\/ลบสินค้า/i });
    expect(toggle).not.toBeChecked();
  });
});
```

Run: `npx vitest run tests/unit/components/permissions/PermissionsModule.test.tsx` → Expected: PASS (1 test)

- [ ] **Step 3: Commit**

```bash
git add components/permissions app/\(app\)/permissions tests/unit/components/permissions
git commit -m "feat(permissions): admin config-as-data editor (roles, statuses, capabilities, shop info)"
```

---

### Task 20: Staging seed data + update-workflow docs

**Files:**
- Create: `supabase/seed.sql`
- Create: `docs/PROTOTYPE_MAP.md`, `docs/UPDATING.md`

**Interfaces:** none (documentation + seed data only) — but this is a spec-mandated deliverable (design spec §7), not optional cleanup.

- [ ] **Step 1: Write `supabase/seed.sql`** — insert the prototype's exact Thai sample data (`initialTickets`, `initialOrders`, `initialCustomers`, `initialStock`, `initialCommissionRules`, `initialExpenses`, `initialPettyCash`, `initialRetailCustomers`, `initialWithdrawals`; reference/v0.4/finnix-film.html:161-166,238-372) translated into `insert` statements against the schema from Tasks 2-6, for use by the staging Supabase project and local dev (`supabase db reset` runs `seed.sql` automatically). Also seed the 4 default users (`initialUsers`, lines 161-166) as real Supabase Auth accounts via `supabase.auth.admin.createUser` in a companion `supabase/seed.ts` script (run via `npx tsx supabase/seed.ts` after `db reset`, since `auth.users` isn't reachable from plain SQL against the local stack the same way `public` tables are) — each with password `finnix-staging-2026` (staging only, never used in production).

- [ ] **Step 2: Write `docs/PROTOTYPE_MAP.md`**

One row per prototype construct, generated by walking `reference/v0.4/finnix-film.html`'s top-level `const`/`function` declarations (the same list surfaced by `grep -n "^function [A-Z]\|^const [A-Z][a-zA-Z]* = ("` used during the original design exploration) and recording where each ended up. Example rows (fill in every construct, not just these):

| Prototype construct | Line range (v0.4) | Production location |
|---|---|---|
| `DEFAULT_STATUSES` | 228-235 | `statuses` table (migration 0003) |
| `DEFAULT_NAV_PERMISSIONS` | 176-181 | `role_permissions` rows where `permission_type='nav'` (migration 0002) |
| `SHOPS` | 140-146 | `shops` table (migration 0001) |
| `TicketDetail` | 1310-2469 | `components/tickets/TicketDetail.tsx` + `components/tickets/detail/*` |
| `orderTotal` / `orderPaid` | 331-337 | `lib/domain/orders.ts` |
| `buildTrendSeries` | 112-139 | **Not ported** — replaced by a real SQL aggregation query (see Task 13 Step 4); note this explicitly so a future re-sync diff against this function isn't mistaken for a missed port |

- [ ] **Step 3: Write `docs/UPDATING.md`** — the runbook from spec §7, verbatim:

```markdown
# Updating from a new prototype drop

1. Save the new file to `reference/vX.Y/finnix-film.html` and commit it alone:
   `git add reference/vX.Y/finnix-film.html && git commit -m "reference: add vX.Y prototype drop"`
2. Diff against the previous version:
   `git diff reference/v<prev>/finnix-film.html reference/vX.Y/finnix-film.html`
3. Classify each changed hunk using PROTOTYPE_MAP.md:
   - New/changed option list value, status, or permission key → edit the corresponding
     table's data directly (via the Permissions/admin UI or a one-off SQL script) — no
     code change.
   - New field on an existing entity → new Supabase migration + matching UI field.
   - Changed calculation/workflow logic → update the specific function/component found via
     PROTOTYPE_MAP.md.
   - Copy/visual-only change → direct text/style edit.
4. Apply the changes; add or update a PROTOTYPE_MAP.md row for anything new.
5. Run the full test suite (`npm run test:unit && npm run test:rls && npm run test:e2e`).
6. Smoke-test the affected screens against the new prototype file side by side.
7. Commit with a message noting which prototype version this reconciles, e.g.
   `git commit -m "sync: reconcile with reference/v0.5 prototype drop"`.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/seed.sql supabase/seed.ts docs/PROTOTYPE_MAP.md docs/UPDATING.md
git commit -m "docs: staging seed data, prototype map, and update runbook"
```

---

### Task 21: Full test suite + Playwright e2e wiring

**Files:**
- Create: `playwright.config.ts`, `vitest.config.ts` (if not already produced by Task 1's scaffold), `package.json` script entries
- Modify: `package.json` (`"test:unit"`, `"test:rls"`, `"test:e2e"` scripts)

**Interfaces:** none new — this task wires together everything Tasks 1-20 already wrote tests for, plus fills in the remaining e2e specs the spec's §9 calls for (login, print job sheet, wholesale price approval, permissions change taking effect) alongside the ticket-creation spec already written in Task 14.

- [ ] **Step 1: `package.json` scripts**

```json
{
  "scripts": {
    "test:unit": "vitest run tests/unit",
    "test:rls": "vitest run tests/rls",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
```

- [ ] **Step 3: Remaining e2e specs**, one file each, following the exact login pattern already established in `tests/e2e/tickets.spec.ts` (Task 14 Step 5):
  - `tests/e2e/wholesale-price-approval.spec.ts` — an exec user approves a `รออนุมัติราคา` order's requested price and the order's displayed total updates.
  - `tests/e2e/permissions-change.spec.ts` — an admin flips a role's `stock.editDelete` capability off, then a user with that role logs in and confirms the corresponding button is gone.
  - `tests/e2e/print-job-sheet.spec.ts` — navigates to a ticket, triggers print, and asserts (via `page.evaluate` reading computed styles under `@media print` emulation) that `.print-area` is the only visible top-level content.

- [ ] **Step 4: Run everything**

```bash
npm run test:unit
npm run test:rls
npm run test:e2e
```

Expected: all suites PASS. This is the first point in the plan where every task's tests run together — if any cross-task interface drifted (e.g., a prop renamed in Task 11 but not updated in Task 14), it surfaces here.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts package.json tests/e2e
git commit -m "test: wire up full unit/RLS/e2e suite"
```

---

### Task 22: Deployment checkpoint — STOP for explicit confirmation

**This task does not start until Tasks 1-21 are complete, committed, and all tests pass locally.**

Per this project's safety rules, creating real billed cloud resources (a hosted Supabase project, a live Vercel deployment) and registering/pointing a domain are **not autonomous steps** — they require the user's explicit go-ahead in chat before anything is created, and several sub-steps are things only the user can do (their Supabase/Vercel account login, their Cloudflare billing).

- [ ] **Step 1: Summarize readiness to the user** — all tests green, app runs fully against local Supabase, list what's left (creating the two hosted Supabase projects per spec §4, linking Vercel, setting env vars, running migrations against each hosted project, registering the domain).
- [ ] **Step 2: Ask explicitly** whether to proceed with creating the staging Supabase project first (via the Supabase MCP tools, which have their own cost-confirmation step), and wait for a clear yes before calling any resource-creating tool.
- [ ] **Step 3 (only after explicit yes): create the staging Supabase project**, apply all 7 migrations + seed against it, generate TypeScript types (`supabase gen types typescript`), and smoke-test the deployed staging app against it locally (pointing `.env.local` at the staging project).
- [ ] **Step 4: Ask explicitly again** before creating the production Supabase project (empty schema, no seed data) and before the first Vercel deployment/domain linking — each is its own confirmation, not covered by an earlier "yes."
- [ ] **Step 5:** Domain registration and Cloudflare DNS configuration remain entirely the user's own action (spec §4) — provide the exact DNS record type/value Vercel requires once the custom domain is added to the Vercel project, but do not attempt to act on the user's Cloudflare account.

---

## Self-Review Notes

**Spec coverage:** §4 architecture → Tasks 1, 8, 9, 22. §5 data model → Tasks 2-7. §6 frontend structure → Tasks 11-19. §7 update workflow → Task 20. §8 deployment → Task 22. §9 testing/error handling → Tasks 10 (unit), 7 (RLS), 21 (e2e), plus inline error-handling notes in Tasks 14-15. All six spec sections have at least one task.

**Placeholder scan:** the `app/(app)/dashboard/page.tsx` draft in Task 13 initially left a `return null` placeholder and an "omitted" mapping — fixed inline with the real mapping code before this plan was finalized. No other `TBD`/`omitted`/vague-instruction patterns remain; the two components ported by "read exact source + adapt per these notes" (Tasks 14 Step 2, 15 Step 2, 16-19) point to precise line ranges and precise adaptation rules rather than leaving behavior undefined — this is a deliberate choice (documented in the design spec) given these are direct ports of already-correct, already-written source rather than new designs.

**Type consistency:** `SessionContext`'s shape (`canDo`, `hasNav`, `hasDashboardWidget`, `accessibleShopIds`, `seesAllShops`) defined in Task 9 is used identically by name in Tasks 12-19 — no renamed fields across tasks. `TicketForTotals`/`OrderForTotals` (Task 10) are the exact shapes Task 13's `computeReceivables`/`computePayables` and Task 14/15's components consume.

