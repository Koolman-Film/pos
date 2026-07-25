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

## Local environment

The test suites in step 5 need the local Supabase stack running and seeded:

```bash
npx supabase start
npx supabase db reset      # applies migrations 0001-0008, then supabase/seed.sql
npx tsx supabase/seed.ts   # the four login accounts (needs auth.users, so not in seed.sql)
```

Two things about this worktree specifically:

- Its stack is remapped off the default ports — the API is on **54351**, not
  54321, because another worktree's stack holds the defaults. `.env.local` has the
  real values; regenerate them with `npx supabase status`.
- **After `db reset`, restart Kong**: the reset gives the auth container a new IP
  and Kong keeps routing to the dead upstream, which shows up as 502s on
  `/auth/v1/*` (i.e. every login).

  ```bash
  docker restart supabase_kong_branch-porting-performance-e58d15
  ```

Seeded logins — all share the password `finnix-staging-2026`, which is for local
and staging only:

| Email                  | Role  | Shops          |
| ---------------------- | ----- | -------------- |
| `admin@finnixfilm.com` | admin | all            |
| `exec@finnixfilm.com`  | exec  | all            |
| `sales@finnixfilm.com` | sales | เชียงใหม่ only |
| `tech@finnixfilm.com`  | tech  | เชียงใหม่ only |

## A note on dates in the seed

`supabase/seed.sql` keeps ticket dates **relative** (`current_date - 2`, etc.),
because the prototype expressed them as `daysFromNow(n)`. That is what keeps the
dashboard's "today" filter and its 7-day booking window populated whenever the
seed is run. Absolute dates are used only where the prototype itself used one (the
July 2026 expense dates and Thai-date-string payments). If you re-point a test at
a specific date, use a relative offset rather than hardcoding one.
