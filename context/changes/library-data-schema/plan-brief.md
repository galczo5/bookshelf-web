# Library Data Schema — Plan Brief

> Full plan: `context/changes/library-data-schema/plan.md`

## What & Why

Stand up Kysely-based migration tooling and ship the initial schema (`users`, `books`, `tags`, `book_tags`, `notes`) plus fold the existing `auth_tokens` table into the migration chain. This is roadmap F-02 — foundation work that unlocks S-01 (books), S-04 (tags + book_tags), S-05 (notes), and S-09 (`trashed_at` on books). Without it, every slice downstream has nowhere to write its data.

## Starting Point

`src/lib/db.ts:5` declares an empty `Database` type — the deliberate growth point. `src/lib/auth-tokens.ts:39-55` creates the only existing table via an ad-hoc `CREATE TABLE IF NOT EXISTS` on first use; F-01's plan explicitly punted migration framework selection to F-02. The project runs Postgres 16 in both dev (`docker-compose.yml`) and prod (Render free Postgres). Dockerfile uses Next.js standalone output and starts via `node server.js` — no migration step.

## Desired End State

Every table the app touches is described by a versioned TypeScript migration file and reflected in a fully populated, hand-written Kysely `Database` interface. `npm run db:migrate` brings any DB (fresh or existing-empty) to the canonical schema. Production migrations run automatically on container boot — a bad migration fails the deploy before traffic shifts. The `users` table is empty awaiting S-01's first sign-in upsert.

## Key Decisions Made

| Decision                       | Choice                                                            | Why (1 sentence)                                                                                                            | Source |
| ------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| Migration tooling              | Kysely built-in `Migrator` + `FileMigrationProvider`              | Zero new runtime deps; stays in-stack with existing `kysely`/`pg`; migrations are typed and same mental model as queries.   | Plan   |
| Scope boundary                 | Schema + Kysely `Database` type only; no data-access helpers      | Matches roadmap foundation framing; consuming slices own their own query shapes — no premature abstractions.                | Plan   |
| Operator identity in schema    | `users` table with UUID PK; FK from `books` and `tags`            | Forward-flex for a possible future multi-user pivot, even though PRD §Access Control stays single-user for v1.              | Plan   |
| Notes cardinality              | Many notes per book (`notes(id)` PK, plain `book_id` FK)          | Flexibility for later patterns (highlights, journaling); UI in S-05 may start with one but the schema doesn't constrain it. | Plan   |
| Cover storage                  | `cover_bytes BYTEA` + `cover_mime TEXT` on `books`                | Single-row read returns everything; no Drive call for the library grid. Capacity risk acknowledged in Open Risks.           | Plan   |
| Tag identity                   | `tags(id UUID PK, name TEXT)` + `book_tags(book_id, tag_id)` join | FR-010 global rename is a one-row UPDATE; tag identity decoupled from display string.                                       | Plan   |
| Trash representation           | `trashed_at TIMESTAMPTZ NULL` on `books`                          | Roadmap-named soft-delete pattern; one column; preserves "when was this trashed" data.                                      | Plan   |
| Constraint tightness           | PKs, FKs, NOT NULL on essentials, UNIQUE `(user_id, name)` on tags | Roadmap risk note explicitly says defer indexes/constraints until a slice forces them.                                      | Plan   |
| Production migration timing    | On container boot (Dockerfile CMD wrapper)                        | Zero manual step per deploy; Render free tier has no pre-deploy hook; bad migration cleanly fails the deploy.               | Plan   |
| `auth_tokens` handling         | Fold into migration `0001`, delete the runtime `ensureTable()`    | Single source of truth for schema; eliminates the "two ways tables get created" smell; cost is one forced re-sign-in.       | Plan   |

## Scope

**In scope:**
- Kysely `Migrator` runner script (`scripts/migrate.ts`) with `up` / `down` modes
- `tsconfig.migrate.json` compile config; `tsx` dev dep for source-mode migration runs
- `db:migrate`, `db:migrate:down`, `build:migrate` npm scripts; `build` script chains in `build:migrate`
- Migration `0001_initial_auth_tokens.ts` — takes ownership of the `auth_tokens` table from F-01's runtime DDL
- Migration `0002_library_schema.ts` — creates `users`, `books`, `tags`, `book_tags`, `notes`
- Hand-written Kysely `Database` interface in `src/lib/db.ts` covering all six tables
- Dockerfile `CMD` becomes `sh -c 'node dist/scripts/migrate.js && node server.js'`; new `COPY` of `/app/dist`
- Removal of `ensureTable()` and `tableReady` cache from `src/lib/auth-tokens.ts`

**Out of scope:**
- All CRUD / data-access helpers (owned by S-01/S-04/S-05/S-09)
- Index creation beyond PKs and UNIQUEs (owned by consuming slices per roadmap risk note)
- CHECK constraints, domain types, triggers (none in v1)
- `users`-row bootstrap upsert in `src/auth.ts` (deferred to S-01)
- Rewriting `auth-tokens.ts` raw queries to use Kysely
- Test framework introduction (no Jest/Vitest in this change)
- `.github/workflows` for migration gating (Render auto-deploy + boot migration is the deploy path)
- `kysely-codegen` or any generated Database type
- Backup, restore, seed-data tooling

## Architecture / Approach

```
Dev:  npm run db:migrate
      → tsx scripts/migrate.ts
      → Kysely Migrator + FileMigrationProvider
      → reads src/lib/db/migrations/*.ts via dynamic import
      → applies in numeric-prefix order, records in kysely_migration table

Build: npm run build
       → next build (standalone output to .next/standalone)
       → tsc -p tsconfig.migrate.json (compiles scripts/migrate.ts + migrations/*.ts to dist/)

Prod boot: sh -c 'node dist/scripts/migrate.js && node server.js'
           → migration step exits 0 → server starts → traffic shifts
           → migration step exits non-zero → container exits → Render holds traffic on prior healthy instance

Schema (after both migrations):
  auth_tokens (email PK, ciphertext, updated_at)        — owned by 0001
  users       (id, email UNIQUE, created_at)            — owned by 0002
  books       (id, user_id FK, drive_file_id, title,    — owned by 0002
               author?, isbn?, cover_bytes?, cover_mime?,
               trashed_at?, created_at, updated_at)
  tags        (id, user_id FK, name, created_at,        — owned by 0002
               UNIQUE(user_id, name))
  book_tags   (book_id FK, tag_id FK, added_at,         — owned by 0002
               PRIMARY KEY(book_id, tag_id))
  notes       (id, book_id FK, body, created_at,        — owned by 0002
               updated_at)

  All FKs use ON DELETE CASCADE.
  All UUID PKs use DEFAULT gen_random_uuid() (pg16 core, no extension).
```

## Phases at a Glance

| Phase                                          | What it delivers                                                                                                                                                                                                                       | Key risk                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Migration tooling on boot                   | Kysely runner, npm scripts, `tsconfig.migrate.json`, migration `0001_initial_auth_tokens`, Dockerfile boot wrapper, deletion of `ensureTable()`, minimal `Database` interface (just `auth_tokens`). End: app behavior unchanged, schema under migration control. | Standalone output may not trace `kysely`/`pg` into `.next/standalone/node_modules/` — verification step calls this out; fallback is an extra `COPY` of `node_modules`.            |
| 2. Library schema + populated `Database` type  | Migration `0002_library_schema` with the five library tables; full `Database` interface for all six tables.                                                                                                                            | Cover storage as BYTEA against Render free-tier 1GB Postgres cap — flagged in Open Risks, mitigation is Starter plan upgrade or a later cover-to-Drive migration.                 |

**Prerequisites:**
- Local dev: Postgres running via `docker compose up -d db`.
- Production: Render Postgres free instance already provisioned (it is, from F-01); one manual `DROP TABLE auth_tokens;` against the prod DB before the first F-02 deploy.
- A second tsconfig file pattern is new for this repo — no extra tooling beyond `tsx`.

**Estimated effort:** ~1 evening session. Phase 1 is the bulk (tooling + Dockerfile work); Phase 2 is mostly schema typing once tooling is in place.

## Open Risks & Assumptions

- **`users` table vs PRD §Access Control.** PRD says "no role model, no permission matrix, and no concept of 'other users' inside the application." Adding a `users` table is forward-flex for a hypothetical multi-user pivot the PRD explicitly excludes. The schema is honest (`UNIQUE` email, FKs to it), but no in-app code yet references the table — bootstrap is deferred to S-01. Revisit when (if) a multi-user PRD pass happens.
- **Cover bytes in Postgres vs free-tier 1GB cap.** 1000 books × ~1MB average cover ≈ 1GB. Auth_tokens, Kysely bookkeeping, indexes (added by later slices) tighten the budget further. Mitigation if it binds: pay $7/mo for Render Postgres Starter (10GB), or migrate covers to Drive in a dedicated change.
- **Standalone tracing of Kysely + pg.** `next build` should pull these into `.next/standalone/node_modules/` because `src/lib/db.ts` is server-side and imported transitively by route handlers. Phase 1 includes a verification step; the fallback is a small extra `COPY --from=deps /app/node_modules ./node_modules` in the runner stage.
- **Bad migration blocks deploy.** Deliberate property (we want failed migrations to gate traffic), but flagged so it's not a surprise. A migration that succeeds locally but fails against the prod DB (e.g., different timezone settings, leftover ad-hoc state) holds the deploy on the prior instance until the migration is fixed.
- **S-01 handoff dependency.** The `users` table is empty after F-02. S-01 must add the `signIn` callback upsert before its first books INSERT. Plan References section names this explicitly so the dependency isn't silent.

## Success Criteria (Summary)

- A fresh local DB plus `npm install && docker compose up -d db && npm run db:migrate` brings the schema to the canonical six-table shape.
- A production deploy applies any pending migrations before Next.js starts; a failed migration prevents traffic shift.
- `src/lib/db.ts` exports a `Database` interface with `auth_tokens`, `users`, `books`, `tags`, `book_tags`, `notes` keys, all typed against the actual column shapes the migrations create.
- No table is created by application runtime code anymore — `ensureTable()` is gone from `src/lib/auth-tokens.ts`.
