# Testing Harness + Import/Migration Integrity Implementation Plan

## Overview

Stand up a Vitest integration harness against a Postgres-18 Docker Compose service (matching the Render-hosted major), defend Risk #1 (import non-atomicity) with action-level integration tests driven through a programmable Drive fake, defend Risk #2 (migration drift) with a forward → down → forward replay + committed schema snapshot, and wire both gates into a GitHub Actions workflow on every PR. This is `context/foundation/test-plan.md` Phase 1, and it is load-bearing for Phases 2–4 (the harness, the Drive fake, and the test scripts established here are reused).

## Current State Analysis

The project has **no test infrastructure at all** — no Vitest, no test files, no fixtures, no CI workflow, no `test` script in `package.json` (verified by the Phase-1 research in [`research.md`](./research.md)). What does exist and is reusable:

- **Docker Compose Postgres** ([`docker-compose.yml`](../../../docker-compose.yml)) — `postgres:16-alpine`, port 5432, db/user/pass `bookshelf/bookshelf/bookshelf`, healthcheck wired. **Major-version drift identified**: Render is on Postgres 18 (verified via Render MCP `dpg-d887ac7avr4c73e2uufg-a`, version `"18"`); local is on 16. Phase 1 closes that gap.
- **Migration runner** ([`scripts/migrate.mts`](../../../scripts/migrate.mts)) — Kysely `FileMigrationProvider` over `src/lib/db/migrations/`. `npm run db:migrate` (up) / `npm run db:migrate:down` (one step). Tracks state in `kysely_migration` + `kysely_migration_lock`. Reads `DATABASE_URL`. Exits 1 on failure.
- **DB layer seam** ([`src/lib/db.ts:77-115`](../../../src/lib/db.ts)) — Kysely Proxy over a `globalThis`-cached `pg.Pool`, keyed on `DATABASE_URL` at first touch. Tests set the env var before importing any app code; no reset needed within a single test process.
- **Import flow code map** (the surface this plan tests, verified in [`research.md`](./research.md)):
  - [`importEpubAction`](../../../src/app/actions/import-epub.ts) creates a `books` row at `review_state: 'pending'` + a `book_drafts` row with staged bytes, both inside `createDraft` ([`src/lib/book-drafts.ts:42-70`](../../../src/lib/book-drafts.ts)) — single Kysely transaction. **No Drive call.**
  - [`confirmReviewAction`](../../../src/app/actions/confirm-review.ts) (`/review/[bookId]` form action) **owns the Risk #1 surface**. Order at lines 99–120: `getDriveClient` → folder lookup → filename collision check → `uploadBookToDrive` (Drive write) → `confirmDraft` (DB transaction: UPDATE `pending → confirmed` + DELETE `book_drafts`). The Drive write is **outside** the DB transaction.
  - Best-effort rollback at lines 121–136: on confirm-side failure with a captured `fileId`, calls `drive.files.delete({fileId})` in its own try/catch and logs+swallows failure. The original `epub-import-to-drive` plan explicitly accepts the double-failure orphan-leak.
- **Drive client seam** ([`src/lib/drive/client.ts:7-19`](../../../src/lib/drive/client.ts)) — per-call `getDriveClient()` factory returning the concrete `drive_v3.Drive`. No `DriveClient` interface; every helper takes `drive: drive_v3.Drive`. `vi.mock('@/lib/drive/client', ...)` is the cleanest test seam (no production refactor).
- **Drive surface exercised by the confirm flow** (the surface the fake must implement for Phase 2):
  - `drive.files.list({q})` — used by `library-folder.ts:15,46` and `upload.ts:29`
  - `drive.files.create({...})` — used by `library-folder.ts:26,57` and `upload.ts:44`
  - `drive.files.delete({fileId})` — used by `confirm-review.ts:129`
- **`auth()` seam** ([`src/auth.ts`](../../../src/auth.ts)) — `confirmReviewAction` calls `auth()` at line 63 and redirects to `/signin` if there's no session. Tests must mock this alongside the Drive client.
- **Books schema** ([`src/lib/db.ts:18-31`](../../../src/lib/db.ts) + migrations `0002`/`0003`) — `id UUID PK`, `user_id UUID FK CASCADE`, `drive_file_id TEXT NULL` (nullable since `0003`), `title TEXT NOT NULL`, `author/isbn TEXT`, `cover_bytes BYTEA`, `cover_mime TEXT`, `trashed_at TIMESTAMPTZ`, `review_state TEXT NOT NULL DEFAULT 'confirmed'`, `created_at/updated_at TIMESTAMPTZ`. The atomicity oracle for Risk #1 is `(review_state, drive_file_id, book_drafts row presence)`.
- **Migrations on disk**: `0001_initial_auth_tokens.mts`, `0002_library_schema.mts`, `0003_book_drafts.mts`.
- **CLAUDE.md hard-rule #5**: Next.js 16 may differ from training data; consult `node_modules/next/dist/docs/` before writing framework code. (Vitest config does not touch Next internals here, so the hard rule binds only if a downstream phase uses `next/server` imports inside tests — currently it doesn't.)

## Desired End State

When this plan is complete, the following is true:

- `npm test` runs from a clean clone — given `docker compose up -d db` and `npm run db:migrate` — and exits 0 with all integration and replay tests passing.
- A regression that breaks the Drive ↔ DB atomicity of `confirmReviewAction` (e.g., reordering Drive vs DB calls; removing the rollback delete) fails an integration test with a clear, action-level diagnostic — not a snapshot diff, not a unit-level mock assertion.
- A regression in a migration's `down()` function — or in the schema produced by running migrations forward against the Render-major Postgres image — fails `npm run test:migrate-replay` with a clear diff against the committed schema snapshot.
- `.github/workflows/test.yml` runs three jobs (`lint`, `test:integration`, `test:migrate-replay`) on every PR, each against a Postgres-18 service container, and merging is blocked when any of them fails.
- `docker-compose.yml` is pinned to `postgres:18-alpine` (matching Render), and the test plan's Phase 1 row in `context/foundation/test-plan.md` is `complete`.

### Key Discoveries:

- **The "import action" is two actions, not one** ([`research.md`](./research.md) §1). The Risk #1 surface is `confirmReviewAction`, not `importEpubAction`. Tests must drive the second action through a pre-seeded draft, not the file-picker entry point alone.
- **`books.review_state` is the atomicity oracle** — a consistent post-state is `pending + drive_file_id NULL + book_drafts row exists` **or** `confirmed + drive_file_id NOT NULL + no book_drafts row`. Anything else is a Risk #1 violation.
- **Render Postgres is on major 18** (verified via Render MCP this session); the Docker Compose image is currently 16. Closing that gap is part of Phase 1 and is itself a Risk #2 mitigation.
- **The original `epub-import-to-drive` plan explicitly accepts the double-failure orphan-leak** (Drive upload OK, confirmDraft throws, rollback delete also throws). The Phase 2 test suite locks that contract in.
- **No `DriveClient` interface exists** — `vi.mock('@/lib/drive/client')` at the test-file top is the only injection seam without refactoring production code.

## What We're NOT Doing

- **No tests for Risks #3, #4, #5, #6, #7** — those land in test-plan Phases 2 and 3 and reuse the harness this change ships.
- **No refactor of `confirmReviewAction` or `getDriveClient` for testability.** The seams already exist (module-level mock + DB env-var swap). No `DriveClient` interface, no DI parameter, no factory rewrite.
- **No e2e / Playwright** (per test-plan §4 — defer until a real failure mode requires it).
- **No `tsc --noEmit` gate in CI** — test-plan §5 marks typecheck as required after Phase 4, not Phase 1.
- **No post-deploy smoke** (test-plan §5 marks this optional after Phase 4).
- **No cleanup machinery for the double-failure orphan-leak.** The current contract is "accept one orphan in the double-failure case" per the `epub-import-to-drive` plan. The Phase 2 test asserts the orphan IS left behind by design.
- **No OpenAI/AI-enrichment test fakes** — those belong to test-plan Phase 3 (Risk #5).
- **No Drive `about.get` / `files.get` / `files.update` faking** — these are used by connection-check, books actions, and trash, none of which the confirm flow exercises. Phase 2 of the test plan will extend the fake when those surfaces need coverage.
- **No multi-Postgres-major matrix.** CI runs against 18 only; if Render bumps majors, this changes in lockstep with a docker-compose bump.
- **No test:unit script yet.** Phase 1 ships `test:integration` only; `test:unit` lands in test-plan Phase 3 when the first unit test (Drive error-mapper) does.
- **No fixture for AI-proposed metadata, OAuth tokens, or cover-fetch HTTP**. The Phase 2 tests bypass the AI/cover path by submitting `coverChoice=embedded` (the test fixture has an embedded cover) or `coverChoice=""` (no cover), which the confirm action handles natively.

## Implementation Approach

Land four incremental phases. Each phase is a green-CI-friendly commit; each builds strictly on its predecessor:

1. **Harness primitives** — install Vitest, pin Postgres to 18-alpine, write `vitest.config.ts`, build the three reusable helpers (DB reset/seed, programmable Drive fake, fixture loader), commit a tiny real `.epub` fixture, expose three `npm` scripts. No tests of production code yet — just the foundation Phases 2/3/4 build on.
2. **Risk #1 integration tests** — five tests against the confirm flow + entry-point flow, exercising the atomicity oracle through the harness from Phase 1.
3. **Risk #2 migration replay** — a script that drops and recreates a dedicated test DB, runs forward → down → forward, then queries `information_schema` and diffs against a committed JSON snapshot. Wired as `npm run test:migrate-replay`.
4. **CI workflow** — `.github/workflows/test.yml` with three jobs (`lint`, `test:integration`, `test:migrate-replay`) against a `postgres:18-alpine` service container, required for PR merge.

Each phase has its own commit ritual; the Progress section at the bottom drives `/10x-implement`.

## Critical Implementation Details

These are non-obvious facts the implementer needs before touching code — gathered during research and the planning interview.

- **TRUNCATE ordering and CASCADE.** The DB-reset helper must use `TRUNCATE ... CASCADE` (or list child tables before parents) because of FK chains: `book_tags → tags/books`, `notes → books`, `books → users`, `book_drafts → books`. A naive `TRUNCATE books` without CASCADE fails. Use `TRUNCATE TABLE notes, book_tags, book_drafts, books, tags, users RESTART IDENTITY CASCADE` — single statement, one round-trip.
- **`globalThis` cache does NOT need resetting between tests** (only between processes). `DATABASE_URL` is read at first-touch; once a process is pointed at `DATABASE_URL_TEST`, the cached pool stays correct for the whole process. The TRUNCATE-between-tests pattern doesn't disturb the pool.
- **`vi.mock` hoisting.** Vitest hoists `vi.mock()` calls to the top of the file before imports — so the mock factory must not reference variables declared later in the file. Pattern: `vi.mock('@/lib/drive/client', () => ({ getDriveClient: vi.fn() }))` then `import { getDriveClient } from '@/lib/drive/client'` then per-test `(getDriveClient as Mock).mockResolvedValue(fakeDrive)`. Same pattern for `vi.mock('@/auth')`.
- **`redirect()` throws.** `confirmReviewAction` uses `next/navigation`'s `redirect`, which throws a `NEXT_REDIRECT` error to short-circuit. The happy-path test must catch this thrown control-flow signal and inspect it (Next exports `isRedirectError` for this; tests can also match the message prefix). Do not treat it as a test failure.
- **`fileId` lifecycle in the catch block** is the hidden invariant that drives test-case selection: `fileId` is set only between `uploadBookToDrive` returning and `confirmDraft` throwing. The `if (fileId)` guard at [`confirm-review.ts:126`](../../../src/app/actions/confirm-review.ts) correctly skips the rollback-delete when Drive-upload itself fails. The "mid-upload" Phase-2 test must verify that the fake's `files.delete` is NEVER called in that branch (a regression that removes the `if (fileId)` guard would call delete on `undefined`).
- **Atomicity oracle assertions read three things, always together**: `books.review_state`, `books.drive_file_id`, and the existence of the matching `book_drafts` row. A single-column read leaves the door open to inconsistent intermediate states being accidentally treated as "OK." The DB-reset helper should also expose a `readState(bookId)` test-only query that returns `{review_state, drive_file_id, hasDraft}` so every test asserts on the triple.
- **Schema-snapshot determinism.** `information_schema.columns` and `information_schema.table_constraints` are not naturally sorted. The snapshot generator must `ORDER BY table_schema, table_name, ordinal_position` (and constraints by `constraint_name`) so the committed JSON is stable across PostgreSQL minor versions. Exclude Kysely's own bookkeeping tables (`kysely_migration`, `kysely_migration_lock`) from the snapshot — they're churn.
- **Migration replay needs a dedicated DB.** Running `db:migrate:down` inside the same DB the integration tests use destroys their data and fights for the `kysely_migration_lock`. The replay test must use its own DB (e.g., `bookshelf_replay`) created and dropped per script run. Use `pg`'s `Client` to issue `DROP DATABASE IF EXISTS` / `CREATE DATABASE` against the `postgres` admin DB before each replay run.
- **Drive fake — `files.list` shape.** `confirmReviewAction` calls `findAvailableFilename` which calls `drive.files.list({q: "name = '...' and ... and trashed = false", fields, spaces})`. The fake must parse only the `name = '...'` and `'<parent>' in parents` clauses from `q` (regex match is sufficient) and return matching items from its in-memory Map. Anything fancier is YAGNI.
- **`googleapis` types.** The Drive fake should be typed as `Pick<drive_v3.Drive, 'files'>` with `files: { create, list, delete }` matching the SDK's response envelope (`{ data: { id, name, ... } }`). Tests cast the fake to `drive_v3.Drive` at the `vi.mock` boundary — the runtime calls only the implemented methods.
- **Vitest config: `pool: 'forks'` + `singleFork: true`.** Integration tests share a single Postgres database; running them in parallel would race TRUNCATE/INSERT. Use `pool: 'forks'` with `poolOptions.forks.singleFork: true` so tests run sequentially within one process while still leaving room for the migration-replay script to run as a separate process via its own npm script.
- **`AUTH_SECRET`, `AUTH_URL`, `AUTH_TOKENS_ENCRYPTION_KEY`** etc. are required by `@/auth` import-side. Because `vi.mock('@/auth')` replaces the module wholesale, the actual env vars are not needed in tests — but if a downstream test ever imports `@/auth` for real, it will crash without them. The Phase 1 vitest setup file should set safe placeholder values for these env vars **before** any import runs (Vitest's `setupFiles` hook), so the failure mode is "test asserts wrong thing" rather than "test crashes at import."

## Phase 1: Harness Primitives

### Overview

Install Vitest. Pin Postgres to 18-alpine. Build three reusable test helpers: the DB reset/seed helper, the programmable Drive fake, and the fixture loader. Commit a tiny valid `.epub` under `tests/fixtures/`. Add three `npm` scripts. No production-code tests yet — this phase exists so Phase 2 starts with a clean foundation.

### Changes Required:

#### 1. Add Vitest and supporting devDependencies

**File**: `package.json`

**Intent**: Add `vitest` (and `@vitest/coverage-v8` if needed; defer until used). Add the three test scripts the planning interview converged on. Keep `engines.node` at `>=22`. Vitest is TS-native and ESM-friendly so no Babel layer is needed.

**Contract**: New `devDependency` `vitest`; new scripts `"test": "vitest run"`, `"test:integration": "vitest run --dir tests/integration"`, `"test:migrate-replay": "tsx scripts/test-migrate-replay.mts"`. The default `test` runs both Vitest and the replay script (chained with `&&`) so contributors get the full gate with one command. Resolution: keep `test` minimal (`vitest run` only) and let CI invoke the three scripts as three jobs; document this in a one-line comment in `package.json` style if practical, otherwise in `AGENTS.md`/`CLAUDE.md`. Final shape:

```json
"test": "vitest run",
"test:integration": "vitest run --dir tests/integration",
"test:migrate-replay": "tsx scripts/test-migrate-replay.mts"
```

#### 2. Pin Postgres to major 18

**File**: `docker-compose.yml`

**Intent**: Change `image: postgres:16-alpine` to `image: postgres:18-alpine` to match Render's provisioned major (verified via Render MCP `dpg-d887ac7avr4c73e2uufg-a`, version `"18"`). This is itself a Risk #2 mitigation: it removes the most likely source of "works locally, fails on Render" drift.

**Contract**: One line changed: `image: postgres:18-alpine`. All other settings (env, ports, healthcheck, volume) unchanged. Local volume `bookshelf_pgdata` will be incompatible with the new major — contributors must drop the named volume (`docker compose down -v`) before `docker compose up -d db`. Note this in the change's commit message and in Phase 1 manual-verification step.

#### 3. Vitest configuration

**File**: `vitest.config.ts` (new)

**Intent**: Configure Vitest for integration tests sharing a single Postgres database. Use `pool: 'forks'` + `singleFork: true` to serialize tests within one process. Wire `setupFiles` to load env-var defaults (test `DATABASE_URL`, NextAuth placeholders) before any module import. Include `tsconfig` paths via `vite-tsconfig-paths` so `@/*` resolves the same as in production code.

**Contract**: Exports a Vitest config object. Key fields: `test.include: ['tests/**/*.test.ts']`, `test.setupFiles: ['tests/setup.ts']`, `test.pool: 'forks'`, `test.poolOptions.forks.singleFork: true`, `test.environment: 'node'`. `resolve.alias: { '@': path.resolve(__dirname, 'src') }` (no need for `vite-tsconfig-paths` plugin — the alias config is fine for a single-prefix path map).

#### 4. Vitest setup file (env-var bootstrap)

**File**: `tests/setup.ts` (new)

**Intent**: Set placeholder env vars **before** any module import so the `@/auth` and `@/lib/db` imports don't blow up in tests that touch them. `DATABASE_URL` points at a dedicated test DB (e.g., `bookshelf_test`). Auth secrets are placeholders; `vi.mock('@/auth')` replaces the module wholesale anyway.

**Contract**: Sets `process.env.DATABASE_URL` (default `postgres://bookshelf:bookshelf@localhost:5432/bookshelf_test`, overridable via `DATABASE_URL_TEST`), `AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BOOKSHELF_ALLOWED_EMAIL`, `AUTH_TOKENS_ENCRYPTION_KEY` (the encryption key must be a valid 32-byte base64 string the auth module accepts; use a fixed test value). No imports from `@/` — this file runs before anything else.

#### 5. DB reset + seed helper

**File**: `tests/helpers/db.ts` (new)

**Intent**: One function `resetDb()` that TRUNCATEs all user-data tables in FK-safe order and re-seeds a fixed test user; one function `seedDraft(...)` that inserts a `books` row at `review_state: 'pending'` plus a `book_drafts` row to drive the confirm flow without going through `importEpubAction`; one function `readState(bookId)` that returns `{review_state, drive_file_id, hasDraft, driveFileBytes?}` for atomicity assertions. Reuses the production Kysely instance (`@/lib/db`) — no separate pool.

**Contract**: 
- `resetDb(): Promise<void>` runs `TRUNCATE TABLE notes, book_tags, book_drafts, books, tags, users RESTART IDENTITY CASCADE` then INSERTs `users` with a fixed id/email (constant exported as `TEST_USER`).
- `seedDraft(input: { filename: string, derivedTitle: string, stagedBytes: Buffer, embedded?: {...} }): Promise<string>` returns the inserted `bookId`. Mirrors `createDraft`'s signature in [`src/lib/book-drafts.ts`](../../../src/lib/book-drafts.ts) so tests look like the production caller, but bypasses parseEpub to allow synthetic drafts when needed.
- `readState(bookId: string): Promise<{ reviewState: string, driveFileId: string|null, hasDraft: boolean }>` — single query against `books LEFT JOIN book_drafts`.
- `TEST_USER` constant: `{ id: '00000000-0000-0000-0000-000000000001', email: 'test@example.com' }`.

#### 6. Programmable Drive fake

**File**: `tests/helpers/drive-fake.ts` (new)

**Intent**: Map-backed in-memory implementation of the slice of `drive_v3.Drive` the confirm flow uses (`files.list`, `files.create`, `files.delete`). Programmable failure hooks for each method (e.g., `fake.failNextCreate(error)`, `fake.failNextDelete(error)`). The fake also exposes its internal file Map for assertions ("did the orphan really stay behind?").

**Contract**:
- `createDriveFake(): DriveFake` factory.
- `DriveFake` exposes:
  - `client: drive_v3.Drive` — the object to feed to `vi.mock('@/lib/drive/client')`. Implements only `files.list`, `files.create`, `files.delete` (other methods throw a clear "not implemented in fake" error so Phase 2/3 know what to extend).
  - `failNextCreate(err: Error): void` — next `files.create` call rejects with the given error.
  - `failNextDelete(err: Error): void` — next `files.delete` rejects with the given error.
  - `files: ReadonlyMap<string, FakeDriveFile>` — for assertions on whether the orphan/file is present.
  - `reset(): void` — clears state between tests (called from `beforeEach`).
- `files.list({q})` parses `name = '...'` and `'<parent>' in parents` clauses with regex; returns `{ data: { files: [...] } }`.
- `files.create({requestBody, media})` generates a deterministic id (e.g., `fake-drive-${counter}`), stores `{name, parents, mimeType, contentBytes}`, returns `{ data: { id } }`.
- `files.delete({fileId})` removes from the Map; returns `{ data: {} }`.

#### 7. Fixture loader

**File**: `tests/helpers/fixtures.ts` (new)

**Intent**: One function that loads the committed test epub from `tests/fixtures/` as a `Buffer` so tests don't pass a path around. Keeps the fixture directory's structure addressable from one place.

**Contract**: `loadFixtureEpub(name: 'minimal' | string = 'minimal'): Buffer` reads `tests/fixtures/${name}.epub` synchronously and returns the bytes. Default loads `minimal.epub`.

#### 8. Minimal test epub fixture

**Files**: `tests/fixtures/minimal.epub` (new binary), `tests/fixtures/README.md` (new)

**Intent**: A real, tiny, valid epub (well under 5 KB) with known embedded metadata (title="Test Book", author="Test Author", a 1×1 PNG cover, isbn=`"9780000000000"`) so the import-flow tests can exercise the real `parseEpub` path. Committed as a binary file. The README documents how it was constructed (a 10-line `jszip` script kept around for regeneration).

**Contract**: Valid epub 3.0 structure: `mimetype` (uncompressed first entry), `META-INF/container.xml`, `OEBPS/content.opf` with the four metadata fields, a 1×1 PNG cover declared in the manifest, one stub XHTML chapter. The README contains the regen recipe and the expected metadata values for assertion.

#### 9. `.gitignore` and ESLint adjustments

**Files**: `.gitignore`, `eslint.config.mjs` (if test dirs need explicit allowlisting)

**Intent**: Ensure Vitest's `coverage/` is ignored if/when added (defer if not present), and that ESLint covers `tests/` with the same TS rules as `src/`. Verify the existing `eslint.config.mjs` already globs `**/*.ts` — if it doesn't, extend the `files` glob.

**Contract**: `.gitignore` adds `/coverage`. ESLint either already covers `tests/` (verify) or the config grows one entry. No new ESLint rules.

### Success Criteria:

#### Automated Verification:

- `npm install` completes without errors
- `docker compose down -v && docker compose up -d db` brings up Postgres 18 cleanly (image pulls; healthcheck reports healthy within 30s)
- `DATABASE_URL=postgres://bookshelf:bookshelf@localhost:5432/bookshelf_test psql -c 'CREATE DATABASE bookshelf_test'` succeeds (one-shot DB create against the new image)
- `DATABASE_URL=postgres://bookshelf:bookshelf@localhost:5432/bookshelf_test npm run db:migrate` succeeds against Postgres 18 (verifies migrations apply forward on the Render-major image — a tiny Risk #2 smoke beyond the full replay test)
- `npm test` exits 0 (empty test suite is allowed — Vitest reports `0 tests`, no errors)
- `npm run lint` passes including new files under `tests/`
- `tsc --noEmit -p tsconfig.json` passes on test files (verifies path-alias resolution and type-correctness of helpers)

#### Manual Verification:

- A clean clone runs through `docker compose up -d db` → `createdb bookshelf_test` → `npm i` → `DATABASE_URL=... npm run db:migrate` → `npm test` and produces a green empty suite within 60s
- The Drive fake's surface is reviewable for Phase 2/3 reuse (read [`tests/helpers/drive-fake.ts`](../../../tests/helpers/drive-fake.ts) and confirm the method names map 1:1 to the calls in `src/lib/drive/upload.ts` and `confirm-review.ts`)
- The `minimal.epub` fixture's `README.md` describes the regen recipe and the expected metadata values, and `parseEpub(loadFixtureEpub())` returns those values when invoked manually in a `node --eval` snippet
- The pinned Postgres 18 image is documented in the change's commit message with a one-line note about dropping the local volume

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Risk #1 Integration Tests

### Overview

Write the `confirmReviewAction` integration tests against real Postgres + the Phase-1 Drive fake. Cover the four states of the atomicity oracle plus one `importEpubAction` test that verifies the entry-point wiring (parseEpub → createDraft) is intact. Lock in the orphan-leak contract per the original `epub-import-to-drive` plan.

### Changes Required:

#### 1. Test file for `confirmReviewAction`

**File**: `tests/integration/confirm-review.test.ts` (new)

**Intent**: Five `it` blocks covering the atomicity oracle. Each test calls `confirmReviewAction(null, formData)`, then asserts the post-state via `readState(bookId)` AND inspects the Drive fake's internal Map. Uses `beforeEach(() => { resetDb(); driveFake.reset(); })`.

**Contract**: Mocks `@/lib/drive/client` to return the Phase-1 fake. Mocks `@/auth` to return `{ user: { email: TEST_USER.email } }`. Wraps `confirmReviewAction` calls in `try/catch` to handle the `redirect()` thrown `NEXT_REDIRECT` on success.

Five test scenarios (each ends with a triple-read assertion `{reviewState, driveFileId, hasDraft}` + a Drive-fake Map assertion):

1. **Happy path**: seed a draft with the minimal fixture bytes; call `confirmReviewAction` with `title="Test Book"`, `coverChoice="embedded"`. Assert: `redirect("/")` thrown, books row is `{review_state: 'confirmed', drive_file_id: <fake id>}`, no `book_drafts` row, one file present in the Drive fake.
2. **Mid-upload Drive failure**: seed a draft; configure `driveFake.failNextCreate(new Error('500'))`. Call confirm. Assert: returns `{ ok: false, message: 'Could not finish import. Please try again.' }`, books row still `{review_state: 'pending', drive_file_id: null}`, draft row still present, Drive fake is empty (the upload never landed bytes). Critical: assert `files.delete` was never called.
3. **Confirm-DB failure, rollback succeeds**: seed a draft; let `files.create` succeed but force `confirmDraft` to throw (e.g., by deleting the draft row between `createDraft` and the `confirmReviewAction` call so the `WHERE review_state = 'pending'` clause matches zero rows). Assert: returns the generic error, books row absent (because we removed it pre-action) — but a parallel test should manipulate the data so the row is at `confirmed` already, which also forces the `numUpdatedRows = 0` throw. Drive fake's `files.delete` IS called; Drive fake's Map is empty (rollback succeeded). 
4. **Confirm-DB failure, rollback ALSO fails (orphan-leak contract)**: seed a draft; arrange `confirmDraft` to throw; configure `driveFake.failNextDelete(new Error('500'))`. Call confirm. Assert: returns the generic error, books row at `pending` (DB transaction rolled back), draft row still present, and **the orphan file IS still in the Drive fake's Map**. Add an inline comment quoting the `epub-import-to-drive` plan's acceptance: "consistent with the app-independent guardrail."
5. **Unauthorized session**: mock `@/auth` to return `null`. Call confirm. Assert: a `redirect("/signin")` `NEXT_REDIRECT` is thrown; books row unchanged; Drive fake empty.

#### 2. Test file for `importEpubAction` (entry-point wiring)

**File**: `tests/integration/import-epub.test.ts` (new)

**Intent**: Two `it` blocks for the entry-point action. This isn't a Risk #1 test per se (no Drive); it's an anti-regression test ensuring the draft-creation path stays wired to `parseEpub` and `createDraft`. Tests would catch a refactor that breaks the contract `importEpubAction → confirmReviewAction` depends on.

**Contract**:
1. **Happy import**: call `importEpubAction(null, formData)` with the minimal fixture as a `File`. Assert: `redirect('/review/<id>')` thrown, books row present at `review_state: 'pending'`, `drive_file_id: null`, `book_drafts` row present with the staged bytes.
2. **Invalid epub**: call with a random `Buffer.from('not-an-epub')` wrapped in a File. Assert: returns `{ ok: false, message: 'This file does not look like a valid epub.' }`, no books row inserted (createDraft never reached).

#### 3. `Mock` typing helpers (only if needed)

**File**: `tests/helpers/mocks.ts` (new, conditional)

**Intent**: Tiny utility to type-cast `vi.mock`-replaced exports so tests don't sprinkle `as unknown as Mock` everywhere. Skip if Vitest's auto-typing is sufficient.

**Contract**: `mocked<T>(value: T): Mocked<T>` thin wrapper around `vi.mocked`. Add only if Phase 2 test code becomes noisy; otherwise omit.

### Success Criteria:

#### Automated Verification:

- All five tests in `tests/integration/confirm-review.test.ts` pass: `npm run test:integration`
- Both tests in `tests/integration/import-epub.test.ts` pass: `npm run test:integration`
- `npm test` (which runs both suites) exits 0 in under 30s on a warm Docker container
- `npm run lint` passes with no new warnings in the test files
- `tsc --noEmit -p tsconfig.json` passes — fake-Drive cast to `drive_v3.Drive` typechecks

#### Manual Verification:

- Comment out the `if (fileId)` guard at `confirm-review.ts:126` and re-run tests — the "mid-upload Drive failure" test fails with a clear message (because `files.delete(undefined)` either throws in the fake or the assertion that delete was NEVER called fires)
- Comment out the `await drive.files.delete({fileId})` at `confirm-review.ts:129` and re-run — the "confirm-DB failure, rollback succeeds" test fails because the Drive fake's Map still holds the file
- Swap the order of the Drive upload and the DB transaction in `confirm-review.ts` (move `confirmDraft` before `uploadBookToDrive`) and re-run — at least two tests fail with messages that point at the wrong post-state
- The orphan-leak test's inline comment explains why the orphan is left behind, with a reference to the `epub-import-to-drive` plan

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Migration Replay Test (Risk #2)

### Overview

A script that proves every migration applies forward against the Render-major (Postgres 18) image, rolls back cleanly to empty, re-applies forward, and produces the same schema both times. Output is diffed against a committed JSON snapshot so any drift surfaces as a clean PR-review delta. Wired as `npm run test:migrate-replay`.

### Changes Required:

#### 1. Migration replay script

**File**: `scripts/test-migrate-replay.mts` (new)

**Intent**: An end-to-end Risk #2 driver. Uses a dedicated test DB (e.g., `bookshelf_replay`) to avoid colliding with `bookshelf_test`. Sequence: drop+create DB → migrate up to head → record schema snapshot A → migrate down to empty → assert `kysely_migration` is empty and no user tables remain → migrate up again → record schema snapshot B → assert A == B → diff B against the committed snapshot file. Exits non-zero on any mismatch with a clear diff.

**Contract**: 
- Reads `DATABASE_URL_REPLAY` (overridable; defaults to `postgres://bookshelf:bookshelf@localhost:5432/bookshelf_replay`).
- Uses `pg.Client` to connect to the `postgres` admin DB for `DROP/CREATE DATABASE`.
- Reuses the migration runner's logic by importing the Kysely migrator directly from `scripts/migrate.mts` (extract a `runMigrations(direction: 'up'|'down', target?: string)` helper at the top of `migrate.mts` so both scripts share it).
- Snapshot shape: `{ tables: [{ name, columns: [{name, type, nullable, default}], constraints: [{name, type, definition}], indexes: [{name, definition}] }] }`, sorted deterministically (table name, ordinal_position, constraint name, index name). Excludes `kysely_migration*` tables and `pg_*`/`information_schema*` schemas.
- Diff implementation: shallow JSON.stringify comparison; on mismatch, print a `diff -u` style output (use Node's `node:diff` or a small inline diff) and exit 1.
- Snapshot file path: `tests/fixtures/migration-schema-snapshot.json`.

#### 2. Refactor `scripts/migrate.mts` to expose a reusable runner

**File**: `scripts/migrate.mts`

**Intent**: Extract the migrator setup (file provider + `Migrator` instance) into a named export so the replay script can drive forward/backward steps without spawning child processes. The CLI entry point keeps its existing surface.

**Contract**: New export `export async function runMigrator(db: Kysely<any>, direction: 'latest' | 'down' | 'reset'): Promise<MigrationResultSet>`. `'latest'` calls `migrator.migrateToLatest()`, `'down'` calls `migrator.migrateDown()` once, `'reset'` calls `migrator.migrateDown()` in a loop until no more migrations are applied. The existing top-level CLI calls `runMigrator(db, process.argv[2] === 'down' ? 'down' : 'latest')` and exits with the same codes.

#### 3. Committed schema snapshot

**File**: `tests/fixtures/migration-schema-snapshot.json` (new)

**Intent**: The ground-truth schema produced by applying `0001 → 0002 → 0003` against Postgres 18. Committed; regenerated when migrations change via `npm run test:migrate-replay -- --update-snapshot` (or a separate `npm run snapshot:migrate` if cleaner). Reviewed in PRs.

**Contract**: JSON file. Structure matches the snapshot shape above. The replay script's `--update-snapshot` flag overwrites this file from the live DB state.

#### 4. Documentation note in test plan §6.4

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD" placeholder in §6.4 with a 2-3 line cookbook entry: how to add a migration (write the migration; run `npm run db:migrate`; regenerate the snapshot with `--update-snapshot`; commit migration + snapshot in one commit; CI replay catches drift). This belongs to the test plan, not the change folder.

**Contract**: Replace the single line under "### 6.4 Adding a migration + verifying parity" with the cookbook entry. Other §6 sections stay TBD (their phases haven't shipped).

### Success Criteria:

#### Automated Verification:

- `npm run test:migrate-replay` exits 0 against a clean Postgres 18 with no pre-existing `bookshelf_replay` DB
- `npm run test:migrate-replay` exits 0 when invoked twice in a row (script must be idempotent / re-runnable)
- `npm run test:migrate-replay -- --update-snapshot` overwrites `tests/fixtures/migration-schema-snapshot.json` deterministically (running it twice in a row produces zero `git diff`)
- The committed snapshot reflects the current `0001/0002/0003` migrations (manual review of one round)
- `npm run lint` passes on the script
- The CLI entry of `scripts/migrate.mts` still works: `npm run db:migrate` and `npm run db:migrate:down` succeed against the integration DB after the refactor

#### Manual Verification:

- Introduce a deliberately broken `down()` in `0003_book_drafts.mts` (e.g., omit the `dropTable('book_drafts')` call); run `npm run test:migrate-replay`; verify it fails with a snapshot diff that clearly names `book_drafts` as the leaked table
- Add a new dummy migration `0004_throwaway.mts` that adds a column; run replay; verify it fails (snapshot mismatch); regenerate with `--update-snapshot`; verify the new snapshot includes the column; revert the migration to ensure the test isn't sticky
- The cookbook entry in test-plan §6.4 reads cleanly without requiring the reader to open the plan or research docs

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: CI Workflow

### Overview

Ship `.github/workflows/test.yml` with three required jobs running against a `postgres:18-alpine` service container. Closes the test-plan §5 loop ("required after Phase 1" for both Vitest and migration replay).

### Changes Required:

#### 1. GitHub Actions workflow

**File**: `.github/workflows/test.yml` (new)

**Intent**: PR-triggered workflow with three jobs: `lint` (runs `npm run lint`), `test:integration` (boots Postgres 18 service, creates `bookshelf_test`, runs `npm run db:migrate`, runs `npm run test:integration`), `test:migrate-replay` (boots Postgres 18, runs `npm run test:migrate-replay` — script handles DB create/drop). Each job pins Node 22 (matching `package.json` engines) and caches `node_modules` via `actions/setup-node@v4`'s cache option.

**Contract**:
- Triggers: `pull_request` (any branch), `push` to `main`.
- All three jobs run in parallel (no `needs:`).
- Service container in `test:integration` and `test:migrate-replay` jobs: `postgres:18-alpine`, env `POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB` = `bookshelf/bookshelf/bookshelf`, healthcheck `pg_isready -U bookshelf`, port 5432 mapped.
- Env vars passed to test steps: `DATABASE_URL=postgres://bookshelf:bookshelf@localhost:5432/bookshelf_test`, `DATABASE_URL_REPLAY=postgres://bookshelf:bookshelf@localhost:5432/bookshelf_replay`. Auth/Drive/OpenAI secrets are not needed (mocks at module level — Phase 1 setup file provides safe placeholders).
- Pre-test step in `test:integration`: `psql ... -c 'CREATE DATABASE bookshelf_test'`.
- Pin `actions/checkout@v4`, `actions/setup-node@v4` by major version (matches GHA conventions).

#### 2. Update README or AGENTS.md with CI badge / one-line runner note

**File**: `AGENTS.md` (or `README.md` if AGENTS.md doesn't exist yet — verify)

**Intent**: Two-line addition under a "Running tests" heading: how to run locally (`docker compose up -d db && createdb bookshelf_test && npm run db:migrate && npm test`) and how CI runs it (link to the workflow). Defer the badge until the first green run on `main`.

**Contract**: A "Running tests" section with the two commands. Optional but recommended: a sentence pointing at `test-plan.md` for the broader strategy. No new headings deeper than h3.

#### 3. Update test-plan.md Phase-1 status and §6.2/§6.3 cookbook entries

**File**: `context/foundation/test-plan.md`

**Intent**: This change ships test-plan Phase 1 — update its row's Status to `complete`. Also fill in §6.2 (integration test against Postgres) and §6.3 (server-action test) with 2–3 line cookbook entries pointing at the canonical patterns landed in Phase 2 (`tests/integration/confirm-review.test.ts` and the `tests/helpers/` utilities). §6.1 stays TBD (Phase 3 of the test plan owns it).

**Contract**: 
- §3 Phase 1 row: change `Status` from `change opened` (or `planned` if already advanced by orchestrator) to `complete`.
- §6.2 entry: "Drop into `tests/integration/`. Import `resetDb`, `seedDraft`, `readState` from `tests/helpers/db.ts`; mock `@/lib/drive/client` with the Drive fake from `tests/helpers/drive-fake.ts`; assert on the `{reviewState, driveFileId, hasDraft}` triple. Example: `tests/integration/confirm-review.test.ts`."
- §6.3 entry: "Action tests call the action directly with a `FormData` and an `initialState` arg; mock `@/auth` for session control; catch the `NEXT_REDIRECT` error to assert on redirect targets. Example: `tests/integration/import-epub.test.ts`."
- §8 freshness ledger: add a one-line entry "Phase 1 landed: 2026-MM-DD" (filled in at implementation time).

### Success Criteria:

#### Automated Verification:

- `.github/workflows/test.yml` passes GitHub's YAML parser (verified by pushing a PR — see manual verification)
- `actionlint` (if available locally) reports no warnings on the workflow (skip the gate if not installed)
- The "Running tests" section of AGENTS.md references the exact commands a contributor needs

#### Manual Verification:

- Open a draft PR with the workflow added; all three jobs run and pass on the green baseline
- Open a second draft PR that deliberately breaks a migration (e.g., drops a CASCADE from `0002`); verify CI fails specifically on `test:migrate-replay`, not on `test:integration` (proves the jobs catch different things)
- Open a third draft PR that deliberately breaks the rollback delete in `confirm-review.ts`; verify CI fails specifically on `test:integration`
- The PR check experience: failing jobs show diffs / errors in the GitHub Actions logs without requiring the reviewer to dig into screen-fulls of output
- The test-plan.md Phase-1 row reads `complete` and §6.2/§6.3 cookbook entries are present

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before closing out the change.

---

## Testing Strategy

### Integration Tests (the meat of this change):

- `confirm-review.test.ts` — five scenarios covering every cell of the atomicity oracle: happy round-trip, mid-upload fail, confirm-fail-rollback-OK, confirm-fail-rollback-fail (orphan), unauthorized.
- `import-epub.test.ts` — happy draft creation, invalid epub.

### Migration Replay (the contract test for Risk #2):

- One script driver: `scripts/test-migrate-replay.mts`. Forward → down → forward → snapshot. No Vitest dependency (it's not a unit-style test; it's a verification script).

### Unit Tests:

- None in this phase. Per test-plan §3, unit tests land in Phase 3 (Drive error-mapper) and Phase 3 (AI prompt-construction contract). No drive-by units here.

### Manual Testing Steps:

1. Clean clone walkthrough: `git clone … && docker compose up -d db && createdb bookshelf_test && npm i && DATABASE_URL=… npm run db:migrate && npm test`. Expect green within 60s.
2. Break the rollback delete (comment out `await drive.files.delete({fileId})` in `confirm-review.ts`); re-run `npm test`. The "confirm-DB failure, rollback succeeds" test fails clearly.
3. Break a migration's `down()` (comment out the table drop in `0003`); run `npm run test:migrate-replay`. Snapshot diff names the leaked table.
4. Open a deliberately failing PR and confirm CI catches it in the right job.

## Performance Considerations

- The integration suite runs serially under `pool: 'forks'` + `singleFork: true`. Five confirm tests + two import tests + per-test TRUNCATE should land under 5 seconds in CI on a warm `postgres:18-alpine` container. If the suite ever crosses 15s, revisit (probably by parallelizing across files with per-worker test DBs — out of scope here).
- The migration replay does `DROP DATABASE` + full forward + full down + full forward. On three tiny migrations, expect ~2-4 seconds total. The script does not run during `npm test:integration` — only via `npm run test:migrate-replay` and its own CI job — so it doesn't slow per-test feedback.

## Migration Notes

- **Bumping Postgres 16 → 18** invalidates the named volume `bookshelf_pgdata`. Contributors with running local containers must run `docker compose down -v` before `docker compose up -d db`. Note this in the Phase-1 commit message.
- No application data is migrated. No production DB is touched. Render Postgres is already on 18; this change brings local + CI in line.

## References

- Related research: [`context/changes/testing-harness-and-import-integrity/research.md`](./research.md)
- Test plan: [`context/foundation/test-plan.md`](../../foundation/test-plan.md) — Phase 1 is the source of scope for this change; §5 is the source of which CI gates ship now
- Risk #1 anchor code: [`src/app/actions/confirm-review.ts`](../../../src/app/actions/confirm-review.ts), [`src/lib/book-drafts.ts:135-167`](../../../src/lib/book-drafts.ts)
- Drive seam: [`src/lib/drive/client.ts:7-19`](../../../src/lib/drive/client.ts), [`src/lib/drive/upload.ts:23-58`](../../../src/lib/drive/upload.ts), [`src/lib/drive/library-folder.ts:8-66`](../../../src/lib/drive/library-folder.ts)
- DB seam: [`src/lib/db.ts:77-115`](../../../src/lib/db.ts), [`scripts/migrate.mts`](../../../scripts/migrate.mts)
- Original import contract: [`context/changes/epub-import-to-drive/plan.md`](../epub-import-to-drive/plan.md) (explicitly accepts the orphan-leak in the double-failure case)
- Render Postgres version source of truth: Render MCP `dpg-d887ac7avr4c73e2uufg-a` → `version: "18"` (verified 2026-06-04)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Harness Primitives

#### Automated

- [x] 1.1 `npm install` completes without errors
- [x] 1.2 `docker compose down -v && docker compose up -d db` brings up Postgres 18 cleanly (healthcheck reports healthy within 30s)
- [x] 1.3 `createdb bookshelf_test` via psql succeeds against the new image
- [x] 1.4 `npm run db:migrate` against `bookshelf_test` succeeds on Postgres 18
- [x] 1.5 `npm test` exits 0 with an empty suite
- [x] 1.6 `npm run lint` passes including new `tests/` files
- [x] 1.7 `tsc --noEmit -p tsconfig.json` passes on test files

#### Manual

- [ ] 1.8 Clean-clone walkthrough produces a green empty suite within 60s
- [ ] 1.9 Drive fake's surface is reviewable for Phase 2/3 reuse
- [ ] 1.10 `minimal.epub` fixture README documents regen + expected metadata; `parseEpub` agrees
- [ ] 1.11 Postgres 18 image bump documented in commit message with the volume-drop note

### Phase 2: Risk #1 Integration Tests

#### Automated

- [ ] 2.1 All five tests in `tests/integration/confirm-review.test.ts` pass
- [ ] 2.2 Both tests in `tests/integration/import-epub.test.ts` pass
- [ ] 2.3 `npm test` exits 0 in under 30s on warm Docker
- [ ] 2.4 `npm run lint` passes with no new test-file warnings
- [ ] 2.5 `tsc --noEmit -p tsconfig.json` passes (Drive fake cast typechecks)

#### Manual

- [ ] 2.6 Removing the `if (fileId)` guard in `confirm-review.ts` makes the mid-upload-fail test fail clearly
- [ ] 2.7 Removing the rollback `drive.files.delete` makes the rollback-OK test fail because the Drive fake still holds the file
- [ ] 2.8 Swapping Drive-upload vs DB-transaction order produces ≥2 test failures with clear post-state diagnostics
- [ ] 2.9 The orphan-leak test carries an inline comment referencing the `epub-import-to-drive` plan's contract

### Phase 3: Migration Replay Test

#### Automated

- [ ] 3.1 `npm run test:migrate-replay` exits 0 against a clean Postgres 18
- [ ] 3.2 `npm run test:migrate-replay` is idempotent across consecutive runs
- [ ] 3.3 `npm run test:migrate-replay -- --update-snapshot` produces zero `git diff` on a re-run
- [ ] 3.4 Committed snapshot reflects current 0001/0002/0003 migrations (manual review of round)
- [ ] 3.5 `npm run lint` passes on the script
- [ ] 3.6 `npm run db:migrate` / `db:migrate:down` still work after the migrate.mts refactor

#### Manual

- [ ] 3.7 Broken `down()` in 0003 produces a clear snapshot diff naming the leaked table
- [ ] 3.8 Adding `0004_throwaway.mts` + regen produces an updated snapshot; reverting clears it
- [ ] 3.9 test-plan §6.4 cookbook entry reads cleanly stand-alone

### Phase 4: CI Workflow

#### Automated

- [ ] 4.1 `.github/workflows/test.yml` parses cleanly on GitHub (verified by draft PR)
- [ ] 4.2 `actionlint` reports no warnings (skip if tool not installed)
- [ ] 4.3 AGENTS.md "Running tests" references the exact local commands

#### Manual

- [ ] 4.4 Draft PR runs all three jobs green on the baseline
- [ ] 4.5 Deliberately-broken-migration PR fails `test:migrate-replay`, not `test:integration`
- [ ] 4.6 Deliberately-broken-rollback PR fails `test:integration`, not `test:migrate-replay`
- [ ] 4.7 Failing-job logs are reviewable without screen-fulls of noise
- [ ] 4.8 test-plan.md §3 Phase 1 row updated to `complete`; §6.2/§6.3 cookbook entries filled
