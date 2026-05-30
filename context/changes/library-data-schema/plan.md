# Library Data Schema Implementation Plan

## Overview

Stand up Kysely-based migration tooling, ship the initial library schema (`users`, `books`, `tags`, `book_tags`, `notes`), fold the existing `auth_tokens` table into the migration chain, and run migrations on container boot. Result: every table this app touches is described by a TypeScript migration file, reflected in a fully populated Kysely `Database` interface, and re-creatable from zero with a single `npm run db:migrate`. This is roadmap F-02 — foundation work that unlocks S-01 (books), S-04 (tags + book_tags), S-05 (notes), and S-09 (`trashed_at` on books).

## Current State Analysis

- **`src/lib/db.ts:5`** declares `export type Database = Record<string, never>` — the empty Kysely `Database` interface is the deliberate growth point this change fills.
- **`src/lib/auth-tokens.ts:39-55`** runs an ad-hoc `CREATE TABLE IF NOT EXISTS auth_tokens` on first use via `ensureTable()`. F-01's plan (`drive-oauth-and-client/plan.md:43`) explicitly handed migration framework selection to F-02.
- **No migration tooling in `package.json`.** Dependencies include `kysely@^0.29.2` and `pg@^8.21.0` but no migration runner, no `db:migrate` script, no migrations folder.
- **Postgres 16** in both environments: dev via `docker-compose.yml` (`postgres:16-alpine` on `localhost:5432`, user/pass/db = `bookshelf`), prod via Render free Postgres (`bookshelf-db`, Frankfurt, free tier).
- **Dockerfile is multi-stage with Next.js `standalone` output** (`Dockerfile:25-26`). Runner stage copies `.next/standalone`, `.next/static`, `public`, and `scripts`. Boot command is `node server.js` — no migration step.
- **No `.github/workflows`**: Render's GitHub integration auto-deploys on push to `main`. There is no CI/CD layer between push and deploy.
- **Roadmap defers indexes to consuming slices** (`roadmap.md:97`: "schema rigidity could bite when tags/notes patterns evolve; mitigated by deferring indexes and complex constraints until a slice forces them"). This plan respects that stance.
- **PRD §Access Control is single-user**, but this change introduces a `users` table for forward-flex per a deliberate question-round choice. The tension is acknowledged in Open Risks.

## Desired End State

After this change ships:

1. Running `npm run db:migrate` against a fresh local Postgres (or the Render free instance) creates all six tables: `auth_tokens`, `users`, `books`, `tags`, `book_tags`, `notes`. The Kysely `kysely_migration` and `kysely_migration_lock` bookkeeping tables exist alongside.
2. `src/lib/db.ts` exports a fully-populated `Database` interface covering every table. Any future Kysely query against the DB is fully type-checked.
3. `src/lib/auth-tokens.ts` no longer calls `ensureTable()`; the function and its `tableReady` cache are deleted. The table is owned by migration `0001_initial`.
4. The production container boots by running migrations first and Next.js second. A bad migration prevents traffic from being routed to the new instance.
5. The migration runner supports `up` (default) and `down` (revert one) modes via a CLI argument: `npm run db:migrate` and `npm run db:migrate:down`. Both commands exit non-zero on failure so they can drive CI/CD gates later.
6. A fresh checkout + `docker compose up -d db` + `npm install` + `npm run db:migrate` brings a dev DB to the canonical schema in a single chain.

Verification: drop the local DB volume, recreate it, run migrations, sign in, import a (hand-crafted) row, observe FK relationships hold end-to-end. On Render: after a deploy, the Render Postgres has all tables visible via the Render dashboard's PSQL view.

### Key Discoveries

- **Kysely 0.29 ships `Migrator` + `FileMigrationProvider`** for filesystem-backed migration discovery. The provider does `await import(file)` on each migration file at runtime, so files must be resolvable as modules wherever the runner executes.
- **Postgres 16 has `gen_random_uuid()` in core** (`pgcrypto` extension is no longer required since pg13). UUID PKs work with no `CREATE EXTENSION` migration.
- **`updated_at` triggers vs application-level**: F-01's `auth_tokens` ad-hoc DDL uses `DEFAULT NOW()` but never advances `updated_at` automatically — the application supplies it in the UPSERT (`auth-tokens.ts:72-77`). This plan continues that pattern (no triggers; app-level `SET updated_at = NOW()` in slices). Triggers are a slice-level decision if/when needed.
- **Next.js standalone output doesn't trace migration files.** `next build` produces `.next/standalone/` containing only modules imported from the server entry. The migration runner and migration files must be copied into the runtime image explicitly (Dockerfile patch).
- **Node 22's `--experimental-strip-types`** could run the TS migrations directly without compilation, but the flag is experimental and rejects type-only re-exports. A compiled-to-JS path is more durable: ship `tsx` for dev convenience, compile to `dist/` for the production image.
- **Render free tier has no pre-deploy command hook.** Boot-time migration is the only path that doesn't require a paid plan or external CI orchestration.

## What We're NOT Doing

- **No data-access helpers (CRUD wrappers).** Per the scope decision, F-02 ships only the schema + types. S-01/S-04/S-05/S-09 own their own Kysely queries. No `src/lib/library/*.ts` repository layer.
- **No `users`-row bootstrap in `src/auth.ts`.** The `users` table is created empty. S-01 (first slice that writes a `books` row) is responsible for adding the `signIn` callback upsert: `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING id`. This handoff is named in this plan's References section so S-01's plan can pick it up unambiguously.
- **No indexes beyond what PKs and UNIQUE constraints implicitly create.** No `book_tags(tag_id)` reverse index, no `notes(book_id)` index, no `books(title, author)` trigram or tsvector index. Each consuming slice adds its own (S-06: tag filter, S-07: title/author search, S-05: notes).
- **No CHECK constraints, no domain types, no triggers.** The schema validates structure (NOT NULL, FKs, PKs, UNIQUEs) but not content. App code enforces format-level invariants for ISBN, MIME type, etc.
- **No fold of `auth-tokens.ts`'s raw `pg.Query` code into Kysely.** The crypto helpers and `getRefreshToken`/`saveRefreshToken`/`clearRefreshToken` keep raw queries via `query()`. Only the `ensureTable()` runtime DDL is deleted (migration `0001` replaces its role).
- **No `kysely-codegen` or generated Database type.** The `Database` interface is hand-written in `src/lib/db.ts` alongside the table type aliases. Adding codegen is a separate decision, not a foundation concern.
- **No backup, restore, or seed-data tooling.** A fresh DB starts empty (no seeded user row, no example book).
- **No `.github/workflows` for migration gating.** Render auto-deploy + boot-time migration is the only deployment path this change introduces.

## Implementation Approach

Two phases, each independently verifiable.

**Phase 1 — Migration tooling on boot.** Add `tsx` (dev) and the migration runner script. Configure `tsconfig.migrate.json` to compile the runner + migrations folder to `dist/` so the Dockerfile runner stage can execute them with plain `node`. Add `db:migrate` and `db:migrate:down` npm scripts. Write the first migration (`0001_initial_auth_tokens.ts`) that re-creates the table currently owned by `auth-tokens.ts`'s ad-hoc DDL — same column shapes, same constraints. Wire `Dockerfile`'s runner-stage `CMD` to run migrations before `node server.js`. Delete `ensureTable()` (and the now-unused `tableReady` cache) from `auth-tokens.ts`. End state: a fresh dev DB plus `npm install && npm run db:migrate` produces a DB with one table (`auth_tokens`) and `kysely_migration` bookkeeping; Render boot does the same against the prod DB; the running app behaves identically to the pre-F-02 codebase (sign-in still works, refresh token still persisted).

**Phase 2 — Library schema + Database type.** Write `0002_library_schema.ts` creating `users`, `books`, `tags`, `book_tags`, `notes` with PKs, FKs, NOT NULL where essential, and UNIQUE `(user_id, name)` on tags. Hand-write the corresponding `UsersTable`, `BooksTable`, `TagsTable`, `BookTagsTable`, `NotesTable` interfaces in `src/lib/db.ts` using Kysely's `Generated` and `ColumnType` helpers. Update the exported `Database` interface to map all six table names to their types. End state: `npm run db:migrate` against a fresh DB lands all six tables; the Kysely `db` export is type-aware about every column on every table; the empty `users` table is in place awaiting S-01's first INSERT.

## Critical Implementation Details

- **Migration file naming convention.** Files use the `NNNN_short_name.ts` pattern (e.g., `0001_initial_auth_tokens.ts`, `0002_library_schema.ts`). Kysely's `FileMigrationProvider` orders by filename string-sort, so zero-padded numeric prefixes are required to keep ordering stable beyond the first nine.
- **Runner must work in both dev (TS via `tsx`) and prod (JS via `node`).** `scripts/migrate.ts` resolves the migrations folder using `path.join(__dirname, '../src/lib/db/migrations')`. When `tsc` compiles with `outDir: dist/` preserving root layout, `__dirname` becomes `<app>/dist/scripts` and the relative path resolves to `<app>/dist/src/lib/db/migrations` — which also exists because tsc compiled the migration files alongside. Same code, both runtimes, no env-var branching.
- **Boot-time migration ordering in the Dockerfile.** The runner-stage `CMD` becomes `sh -c 'node dist/scripts/migrate.js && node server.js'`. Critical: do not background the migration. If migrations fail, the shell exits non-zero, the container fails health check, and Render holds traffic on the prior healthy instance — exactly the safety property we want.
- **`auth_tokens` migration replaces an already-existing prod table.** Before deploying F-02 to Render the first time, the operator must `DROP TABLE IF EXISTS auth_tokens;` against the prod DB (Render's PSQL view, one SQL statement) so the migration can create it cleanly. The cost is one forced re-sign-in. This is explicitly preferred over `.ifNotExists()` in the migration file because conditional migrations are a long-tail debugging hazard.
- **UUID generation server-side.** Migrations declare `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`. Kysely inserts can omit `id` and let Postgres generate it; the corresponding TS column type is `Generated<string>` so callers receive the id back on INSERT-RETURNING but don't have to provide one.
- **`gen_random_uuid()` availability.** Postgres 16 ships it in core; no `CREATE EXTENSION pgcrypto` is required. Both the dev compose file and Render Postgres run pg16. Do not add an extension migration.
- **`Database` interface ordering.** Kysely's `Selectable`, `Insertable`, `Updateable` helpers infer the right field shapes from `Generated<T>` and `ColumnType<S, I, U>` markers. Use `Generated<string>` for UUID PKs and timestamps with `DEFAULT NOW()`; use `ColumnType<Date, string | undefined, string>` for `created_at`/`updated_at` columns (Postgres returns `Date`, accepts ISO strings, app rarely UPDATEs but supplies a string when it does).
- **`notes` cardinality**: `notes.id` is a UUID PK and `book_id` is a plain FK (no UNIQUE). This intentionally permits multiple notes per book — UI in S-05 may start with one but the schema does not constrain it.

## Phase 1: Migration tooling on boot

### Overview

Stand up the Kysely migration runner, an npm-scriptable `db:migrate` entry point, the boot-time migration wrapper in the Dockerfile, and the first migration that takes ownership of the `auth_tokens` table from F-01's ad-hoc DDL. After this phase, the deployed app's behavior is unchanged from a user's perspective, but every table is now under migration control.

### Changes Required

#### 1. Migration runner script

**File**: `scripts/migrate.ts` (new)

**Intent**: Single entry point that runs Kysely's `Migrator` against the migrations folder. CLI takes one optional argument (`up` default, or `down`) and exits 0 on success, non-zero on failure. Writes per-migration progress to stdout. Designed to work in both dev (executed by `tsx`) and prod (executed by `node` after tsc compilation), with no environment-aware branching beyond what Kysely's own provider needs.

**Contract**:
- Imports `Migrator`, `FileMigrationProvider` from `kysely`; imports `db` from `@/lib/db`.
- Resolves migrations folder as `path.join(__dirname, '../src/lib/db/migrations')` (resolves the same logical location whether running from `scripts/` in dev or `dist/scripts/` in prod, because tsc preserves the source layout under `dist/`).
- `process.argv[2] === 'down'` → `migrator.migrateDown()`; otherwise → `migrator.migrateToLatest()`.
- On `error`: print and `process.exit(1)`. On per-result `error` status: same.
- On success: print each applied migration with status. Final `await db.destroy()` to release the pool before exit.

#### 2. Initial migration — fold `auth_tokens`

**File**: `src/lib/db/migrations/0001_initial_auth_tokens.ts` (new)

**Intent**: Take ownership of the `auth_tokens` table from F-01's `auth-tokens.ts:42` runtime DDL. The shape must match exactly so any pre-existing rows (in prod) remain readable after the operator drops the legacy table and re-runs migrations.

**Contract**:
- `up(db)` creates `auth_tokens`: `email TEXT PRIMARY KEY`, `refresh_token_ciphertext BYTEA NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. Use Kysely's schema builder; no raw SQL.
- `down(db)` drops `auth_tokens`.

#### 3. Compile-target tsconfig for migrations + runner

**File**: `tsconfig.migrate.json` (new)

**Intent**: A second tsconfig that compiles `scripts/migrate.ts` and `src/lib/db/migrations/*.ts` to `dist/`, preserving directory layout so the runner's relative path math works in both source-tree and compiled-tree forms.

**Contract**:
- Extends `./tsconfig.json` (inherits strict mode + target).
- Overrides: `compilerOptions.outDir = "dist"`, `module = "commonjs"` (matches Node's default execution shape, avoids ESM resolution headaches in the Dockerfile runner), `noEmit = false`, `declaration = false`, `sourceMap = false`.
- `include = ["scripts/migrate.ts", "src/lib/db/migrations/**/*.ts", "src/lib/db.ts"]` (db.ts is pulled in because the runner imports it).
- `exclude` re-states the standard exclusions to be safe.

#### 4. npm scripts + tsx dev dep

**File**: `package.json`

**Intent**: Add the migration entry points and the dev runtime that executes TS without a build step locally.

**Contract**:
- Add to `devDependencies`: `tsx@^4`.
- Add to `scripts`:
  - `"db:migrate": "tsx scripts/migrate.ts"`
  - `"db:migrate:down": "tsx scripts/migrate.ts down"`
  - `"build:migrate": "tsc -p tsconfig.migrate.json"`
- Modify `"build"`: `"next build && npm run build:migrate"` so the production image always carries up-to-date compiled migrations.

#### 5. Dockerfile boot wrapper + migration artifacts copy

**File**: `Dockerfile`

**Intent**: Ensure the runtime container has the compiled migrations + runner and that migrations execute before Next.js starts accepting traffic. A failed migration exits the container non-zero, which Render interprets as a failed deploy.

**Contract**:
- In the `builder` stage, `npm run build` now also runs `build:migrate` (via the updated `build` script in step 4), so `/app/dist/` exists.
- Add a new `COPY` in the `runner` stage: `COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist`. Place after the existing `COPY ./scripts` line.
- Add a `COPY` for `node_modules` only if Kysely + pg aren't already traced into `.next/standalone/node_modules/` — they should be because `src/lib/db.ts` is server-side and imported by route handlers, so standalone tracing picks them up. **Verification step**: after Phase 1 builds, inspect `.next/standalone/node_modules/` and confirm `kysely`, `pg` are present. If not, add a separate `COPY --from=deps /app/node_modules ./node_modules` (this becomes a fallback, slightly larger image).
- Replace the final `CMD ["node", "server.js"]` with `CMD ["sh", "-c", "node dist/scripts/migrate.js && node server.js"]`.

#### 6. Remove `ensureTable()` from `auth-tokens.ts`

**File**: `src/lib/auth-tokens.ts`

**Intent**: Migration `0001` now owns the `auth_tokens` table; the runtime DDL becomes dead code. Removing it eliminates the only "two ways tables get created" smell in the codebase.

**Contract**:
- Delete the `tableReady` module-level cache (lines 37–55).
- Delete every `await ensureTable()` call inside `getRefreshToken`, `saveRefreshToken`, `clearRefreshToken`.
- Leave the crypto helpers and raw `query()` calls untouched (per scope decision: no data-access rewrites in F-02).

#### 7. Populate `Database` type with `auth_tokens`

**File**: `src/lib/db.ts`

**Intent**: First small expansion of the `Database` interface so Kysely is type-aware about the one table that exists after Phase 1. Phase 2 layers on the rest.

**Contract**:
- Replace `export type Database = Record<string, never>` with an interface:
  - Define `AuthTokensTable` with fields `email: string`, `refresh_token_ciphertext: Buffer`, `updated_at: ColumnType<Date, string | undefined, string>`.
  - `export interface Database { auth_tokens: AuthTokensTable }`.
- Add imports from `kysely` for `ColumnType` (and `Generated` — Phase 2 will use it).

#### 8. `.dockerignore` audit

**File**: `.dockerignore`

**Intent**: Ensure `dist/` and `tsconfig.migrate.json` aren't accidentally excluded from the build context. The current `.dockerignore` is short; verify and amend only if needed.

**Contract**:
- Read the file. If it currently excludes `dist`, remove that line (we need the builder stage to produce `dist/` and copy it into the runner stage; excluding `dist` from the **build context** is fine because the builder regenerates it, but excluding from `COPY` is the actual concern — which is via `--from=builder`, not `.dockerignore`, so the file is likely unaffected).
- Verify `tsconfig*.json` is not excluded.

### Success Criteria

#### Automated Verification

- `npm run build` succeeds (Next.js build + `tsc -p tsconfig.migrate.json` both pass with strict mode).
- `npm run lint` passes.
- `npm run db:migrate` against a fresh `docker compose up -d db` + truncated DB creates the `auth_tokens`, `kysely_migration`, and `kysely_migration_lock` tables (no others).
- `npm run db:migrate:down` reverts the latest migration cleanly (`auth_tokens` table is dropped; `kysely_migration` records the revert).
- `grep -r "ensureTable" src/` returns no matches (the function and all callers are gone).
- `dist/scripts/migrate.js` and `dist/src/lib/db/migrations/0001_initial_auth_tokens.js` both exist after `npm run build`.
- `docker build .` succeeds with the new CMD wrapper.

#### Manual Verification

- Local end-to-end: drop the dev DB volume (`docker compose down -v && docker compose up -d db`), run `npm run db:migrate`, then `npm run dev`, sign in via Google → land on `/` with email rendered (proves `auth_tokens` insert works against the migration-owned table).
- Production deploy: drop `auth_tokens` in the Render Postgres dashboard (`DROP TABLE auth_tokens;`), push the F-02 branch to `main`, watch the Render deploy log show `Migration "0001_initial_auth_tokens" was executed successfully` before the Next.js server starts, sign in on the live URL, verify it works.
- Container failure mode: temporarily break the migration (e.g., add `await sql\`SELECT 1/0\`.execute(db)` to `up()`), run `docker build && docker run` locally with `DATABASE_URL` pointed at the dev DB, observe the container exits non-zero before Next.js prints its startup banner.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: Library schema + populated Database type

### Overview

Add the second migration that creates the five library tables (`users`, `books`, `tags`, `book_tags`, `notes`) and hand-write the matching Kysely table interfaces in `src/lib/db.ts`. After this phase, every entity the roadmap's S-01/S-04/S-05/S-09 slices will reference is in place, typed, and queryable.

### Changes Required

#### 1. Library schema migration

**File**: `src/lib/db/migrations/0002_library_schema.ts` (new)

**Intent**: Create the five library tables with PKs (UUID via `gen_random_uuid()`), FKs with `ON DELETE CASCADE` where the relationship is composition (book_tags → books, book_tags → tags, notes → books, books → users, tags → users), NOT NULL on essentials, and a single UNIQUE constraint on `tags(user_id, name)`. No additional indexes. No CHECK constraints. No triggers.

**Contract**:
- `up(db)` (in this order to satisfy FK dependencies):
  - `users`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `email TEXT NOT NULL UNIQUE`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
  - `books`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `drive_file_id TEXT NOT NULL`, `title TEXT NOT NULL`, `author TEXT`, `isbn TEXT`, `cover_bytes BYTEA`, `cover_mime TEXT`, `trashed_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
  - `tags`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, UNIQUE `(user_id, name)`.
  - `book_tags`: `book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE`, `tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE`, `added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, PRIMARY KEY `(book_id, tag_id)`.
  - `notes`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE`, `body TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- `down(db)` drops in reverse order: `notes`, `book_tags`, `tags`, `books`, `users`.
- Use Kysely's `db.schema.createTable(...)` chain throughout. Where `DEFAULT gen_random_uuid()` is needed, use Kysely's `sql\`gen_random_uuid()\`` helper inside `.defaultTo(...)`.

#### 2. Populate Kysely table interfaces

**File**: `src/lib/db.ts`

**Intent**: Hand-write the five new table interfaces alongside the existing `AuthTokensTable` and extend the `Database` interface to map all six names. Use `Generated<string>` for UUID PKs (Postgres supplies the value) and timestamps with `DEFAULT NOW()` so callers can omit them on INSERT.

**Contract**:
- `UsersTable`: `id: Generated<string>`, `email: string`, `created_at: Generated<Date>`.
- `BooksTable`: `id: Generated<string>`, `user_id: string`, `drive_file_id: string`, `title: string`, `author: string | null`, `isbn: string | null`, `cover_bytes: Buffer | null`, `cover_mime: string | null`, `trashed_at: ColumnType<Date | null, string | null | undefined, string | null>`, `created_at: Generated<Date>`, `updated_at: ColumnType<Date, string | undefined, string>`.
- `TagsTable`: `id: Generated<string>`, `user_id: string`, `name: string`, `created_at: Generated<Date>`.
- `BookTagsTable`: `book_id: string`, `tag_id: string`, `added_at: Generated<Date>`.
- `NotesTable`: `id: Generated<string>`, `book_id: string`, `body: string`, `created_at: Generated<Date>`, `updated_at: ColumnType<Date, string | undefined, string>`.
- `Database` interface gains the five new keys: `users`, `books`, `tags`, `book_tags`, `notes`.

#### 3. tsconfig.migrate.json include update

**File**: `tsconfig.migrate.json`

**Intent**: Ensure the new migration file is picked up by the build:migrate compilation. The glob `src/lib/db/migrations/**/*.ts` already covers it — no change unless the file is somewhere unexpected.

**Contract**:
- Verify the existing `include` glob matches `0002_library_schema.ts`. No edits expected.

### Success Criteria

#### Automated Verification

- `npm run build` succeeds — TypeScript strict mode validates the new `BooksTable`, `NotesTable`, etc., against any in-repo Kysely usage (currently none beyond the type definitions themselves; this is a compile-time tautology check, the real exercise lands in S-01).
- `npm run lint` passes.
- `npm run db:migrate` against a fresh DB applies `0001_initial_auth_tokens` and `0002_library_schema` in order, ending with six tables visible in `\dt` (auth_tokens, users, books, tags, book_tags, notes) plus the two Kysely bookkeeping tables.
- `npm run db:migrate:down` reverts `0002_library_schema` only (drops the five library tables, leaves `auth_tokens`).
- A second `npm run db:migrate:down` reverts `0001_initial_auth_tokens` (drops `auth_tokens`).
- `psql` (via `docker compose exec db psql -U bookshelf`) and `\d books` shows the expected column shape, including `id` with `DEFAULT gen_random_uuid()` and FKs with `ON DELETE CASCADE`.
- `grep -E "Database|AuthTokensTable|UsersTable|BooksTable|TagsTable|BookTagsTable|NotesTable" src/lib/db.ts` returns all seven names.

#### Manual Verification

- Cascade behavior: in `psql`, manually `INSERT INTO users (email) VALUES ('test@example.com') RETURNING id`; then INSERT a book referencing that user; then `DELETE FROM users WHERE email='test@example.com'` and confirm the book row is gone (cascade fires).
- `book_tags` composite PK behavior: try to INSERT the same `(book_id, tag_id)` pair twice and observe the second INSERT fails with the PK uniqueness error.
- `tags` per-user UNIQUE: two different `user_id` values can both have a tag named `"sci-fi"`; the same `user_id` cannot.
- Production deploy: push F-02 Phase 2 to `main`, observe the Render deploy log show both `0001` and `0002` applied in order (assuming `0001` already applied during Phase 1 deploy, only `0002` runs now), sign in on the live URL, verify it still works.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before considering this change complete.

---

## Testing Strategy

### Unit Tests

None. No test framework is configured (CLAUDE.md), and migrations + type definitions are tested by running them (Automated Verification above). Introducing Jest/Vitest is a separate decision that would belong to its own foundation change.

### Integration Tests

None automated. The migration runner exercises Kysely's `Migrator` against a real Postgres; that IS the integration test.

### Manual Testing Steps

End-to-end, in order:

1. `docker compose down -v` (drops the dev DB volume).
2. `docker compose up -d db` (recreates an empty Postgres 16 instance).
3. `npm install` (picks up the new `tsx` dev dep).
4. `npm run db:migrate` — observe both `0001_initial_auth_tokens` and `0002_library_schema` execute successfully.
5. `docker compose exec db psql -U bookshelf -c '\dt'` — confirm 8 tables (6 app + 2 Kysely).
6. `npm run db:migrate:down` — observe `0002_library_schema` reverts; `\dt` now shows 3 tables (auth_tokens + 2 Kysely).
7. `npm run db:migrate:down` again — observe `0001_initial_auth_tokens` reverts; `\dt` shows only the 2 Kysely tables.
8. `npm run db:migrate` — full re-migrate, back to 8 tables.
9. `npm run dev`, sign in — confirm authentication still works against the new migration-managed `auth_tokens` table.
10. Production deploy: drop the prod `auth_tokens` table via Render's PSQL view, push to `main`, watch the Render deploy log for migration output before the Next.js startup banner, sign in via the live URL.

## Performance Considerations

The schema sets up tables that the NFRs ("library responsive within 2s for 1000 books", "filter under 200ms") will eventually have to satisfy, but those NFRs are owned by S-03 and S-06/S-07. F-02 adds no indexes beyond the PK + UNIQUE auto-indexes. The expected hot-path queries (`SELECT … FROM books WHERE user_id = ? AND trashed_at IS NULL ORDER BY title`) will fit comfortably in seq-scan territory for the MVP's ~hundreds-of-books expectation. The 1000-book target may push S-03 to add `(user_id, trashed_at)` or `(user_id, trashed_at, title)` indexes; that's its decision to make.

Boot-time migration adds latency to container startup proportional to the number of new migrations to apply. Steady-state (no new migrations) is sub-second. For a fresh DB with both migrations to apply, total runtime is ≪ 1 second.

**Cover storage in Postgres** is a real performance / capacity concern: 1000 books × ~1MB average cover ≈ 1GB, against Render Postgres free tier's 1GB cap. Adding the auth_tokens row, indexes, and Kysely bookkeeping tightens that further. The decision was made deliberately in the question round; the mitigation if this becomes binding is to upgrade to Render Postgres Starter ($7/mo, 10GB) or migrate covers to Drive in a later slice. No action in F-02.

## Migration Notes

- **Pre-deploy step for the prod DB on the first F-02 deploy**: drop the existing `auth_tokens` table once via Render's PSQL view (`DROP TABLE auth_tokens;`). The operator must complete one re-sign-in flow after the deploy to repopulate the row. Subsequent F-02 deploys need no manual step.
- **Local dev migration step on first checkout**: after `npm install`, run `docker compose up -d db && npm run db:migrate` before `npm run dev`. README or onboarding notes should mention this; CLAUDE.md's `## Commands` section may want a line added in a follow-up.
- **No data migration required.** No prior data exists in the new tables. The `auth_tokens` row in prod is sacrificed for a clean migration history (the alternative — `.ifNotExists()` or manual baselining — is worse for ongoing maintenance).
- **Rolling back F-02 in prod** is `npm run db:migrate:down` against the prod DATABASE_URL (twice — once for `0002`, once for `0001`). After both rollbacks the runtime `ensureTable()` is gone from the codebase, so the app would fail to insert a refresh token on next sign-in. Rollback realistically means rolling back the deploy as well.

## References

- Roadmap entry: `context/foundation/roadmap.md` F-02 (lines 86–98).
- PRD §FR-008, §FR-009, §FR-010, §FR-011, §FR-013, §FR-014, §FR-015, §FR-016, §NFR Persistence durability, §NFR Library responsiveness: `context/foundation/prd.md`.
- Tech-stack hand-off: `context/foundation/tech-stack.md` (Kysely + pg adjustment, line 34).
- F-01 plan for the prior `auth_tokens` ad-hoc DDL pattern: `context/changes/drive-oauth-and-client/plan.md` (Phase 1 §7, lines 174–207).
- Existing runtime DDL being deleted: `src/lib/auth-tokens.ts:37-55`.
- Kysely migration docs: https://kysely.dev/docs/migrations (verify when implementing).
- **Handoff to S-01 (epub-import-to-drive)**: S-01's plan must add a `signIn` callback upsert in `src/auth.ts` of the shape `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING` so the FK from `books.user_id` is satisfiable. F-02 deliberately leaves the `users` table empty.
- **Handoff to S-03 / S-06 / S-07**: any required indexes for the 2s/200ms NFRs land in the slice that needs them, per the roadmap risk note.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration tooling on boot

#### Automated

- [x] 1.1 `npm run build` succeeds (Next.js build + `tsc -p tsconfig.migrate.json` both pass)
- [x] 1.2 `npm run lint` passes
- [x] 1.3 `npm run db:migrate` against a fresh DB creates `auth_tokens` + 2 Kysely bookkeeping tables
- [x] 1.4 `npm run db:migrate:down` reverts `0001_initial_auth_tokens` cleanly
- [x] 1.5 `grep -r "ensureTable" src/` returns no matches
- [x] 1.6 `dist/scripts/migrate.mjs` and `dist/src/lib/db/migrations/0001_initial_auth_tokens.mjs` exist after build (adaptation: Kysely is ESM-only so files use .mts→.mjs, not .ts→.js)
- [x] 1.7 `docker build .` succeeds with the new CMD wrapper

#### Manual

- [ ] 1.8 Local end-to-end: dropped DB volume → migrate → dev → sign in works against migration-owned `auth_tokens`
- [ ] 1.9 Production deploy: dropped prod `auth_tokens`, pushed F-02, Render log shows migration before Next.js startup, sign-in works on live URL
- [ ] 1.10 Container failure mode: deliberately-broken migration causes container to exit non-zero before Next.js starts

### Phase 2: Library schema + populated Database type

#### Automated

- [x] 2.1 `npm run build` succeeds with full `Database` interface
- [x] 2.2 `npm run lint` passes
- [x] 2.3 `npm run db:migrate` lands all six app tables + 2 Kysely bookkeeping tables
- [x] 2.4 `npm run db:migrate:down` (twice) reverts `0002` then `0001` cleanly
- [x] 2.5 `psql … \d books` shows expected columns, `DEFAULT gen_random_uuid()`, and FK `ON DELETE CASCADE`
- [x] 2.6 `grep -E "Database|AuthTokensTable|UsersTable|BooksTable|TagsTable|BookTagsTable|NotesTable" src/lib/db.ts` returns all seven names

#### Manual

- [ ] 2.7 Cascade behavior: deleting a user removes its books (psql round-trip)
- [ ] 2.8 `book_tags` composite PK rejects duplicate `(book_id, tag_id)` insert
- [ ] 2.9 `tags(user_id, name)` UNIQUE permits same name under different users, rejects same name under same user
- [ ] 2.10 Production deploy of Phase 2: Render log shows `0002` applied, sign-in still works on live URL
