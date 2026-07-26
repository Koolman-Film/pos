-- supabase/migrations/0000_pos_schema.sql
--
-- Every table, policy and function in this project lives in the `pos` schema
-- rather than `public`.
--
-- WHY. This database is shared with the Koolman accounting app, whose `public`
-- schema is owned by a Prisma schema file in a different repository (you can see
-- its `_prisma_migrations` table there). Prisma's drift detection compares the
-- whole managed schema against that file, and anything it does not recognise is
-- drift — the remedy for which is a database reset. Names make no difference to
-- that: `pos_tickets` in `public` would be exactly as much drift as `tickets`.
-- Prisma only manages the schemas in its datasource, so putting this app in its
-- own schema is what actually makes the two safe to co-locate.
--
-- It is also far less invasive than prefixing table names. The Supabase client
-- takes a schema at construction, and this app builds its clients in two places,
-- so `.from('tickets')` keeps working untouched — versus renaming ~500 references
-- across queries, policies, functions and tests.
--
-- HOW. Each migration begins with `set search_path = pos, public, extensions;`,
-- which applies for the rest of that file, so unqualified `create table foo`
-- lands in `pos`. `public` stays on the path because the accounting app's tables
-- are there and a future integration may reference them; `extensions` is needed
-- for pgcrypto (`crypt`, `gen_salt`) and friends.
--
-- The schema must also be listed in `[api] schemas` in supabase/config.toml for
-- PostgREST to serve it — locally that file is the source of truth, and
-- `supabase config push` applies it to the linked project.

create schema if not exists pos;

-- Same grants Supabase applies to `public`, so the Data API roles can reach it.
-- RLS (migration 0007) is what actually restricts access; these grants only make
-- the schema visible to PostgREST.
grant usage on schema pos to anon, authenticated, service_role;

alter default privileges in schema pos grant all on tables to anon, authenticated, service_role;
alter default privileges in schema pos grant all on functions to anon, authenticated, service_role;
alter default privileges in schema pos grant all on sequences to anon, authenticated, service_role;
