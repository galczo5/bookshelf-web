---
date: 2026-06-04T11:44:42Z
researcher: Claude (Opus 4.7)
git_commit: 1009f27ad4a61ade06d7878b94cb90243d687b1f
branch: main
repository: bookshelf
topic: "Risk #1 — Import non-atomicity (Drive bytes + DB row must succeed or fail together)"
tags: [research, codebase, import, drive, kysely, atomicity, test-harness, phase-1]
status: complete
last_updated: 2026-06-04
last_updated_by: Claude (Opus 4.7)
---

# Research: Risk #1 — Import non-atomicity

**Date**: 2026-06-04T11:44:42Z
**Researcher**: Claude (Opus 4.7)
**Git Commit**: 1009f27ad4a61ade06d7878b94cb90243d687b1f
**Branch**: main
**Repository**: bookshelf

## Research Question

From `context/foundation/test-plan.md` §2 Risk #1:

> A successful "import" leaves the DB row written but the epub bytes never reach Drive (or the reverse): library shows a ghost book, or Drive holds an orphan file the app no longer references. App-independent-library guardrail silently breaks.

The Phase 1 change folder (`context/changes/testing-harness-and-import-integrity/`) needs research-grade ground truth about *where* this risk lives in the code today, so the harness and integration tests can target the real seams — not the seams the plan inferred from churn signals.

The test plan's risk-response intent (§2):

> A successful import means both the DB row exists AND the epub bytes are reachable via Drive. A Drive failure mid-upload leaves *neither* state behind, and the user sees a clean error rather than a partial success.
>
> Cheapest layer: **integration (action against a real Postgres + a fake Drive client that can fail mid-upload).**

## Summary

The single biggest finding: **the user-facing "import" is split across two server actions, not one. The atomicity risk lives in the *second* action.**

1. **`importEpubAction`** ([`src/app/actions/import-epub.ts:13`](src/app/actions/import-epub.ts#L13)) parses the epub, derives a title, and creates a *draft* row (`books.review_state = 'pending'`) plus a `book_drafts` row holding the staged bytes. **No Drive call.** Wrapped in a single Kysely transaction inside `createDraft`. Safe by construction.
2. **`confirmReviewAction`** ([`src/app/actions/confirm-review.ts:59`](src/app/actions/confirm-review.ts#L59)) is invoked after the user accepts/edits AI-proposed metadata on `/review/[bookId]`. **This is where Drive upload happens, and this is the action that owns Risk #1.** It uploads to Drive first, then runs `confirmDraft` (which performs the `pending → confirmed` UPDATE + a `book_drafts` DELETE in one transaction). The Drive call is **outside** the DB transaction.

A compensating rollback-delete is already in place at [`confirm-review.ts:126-132`](src/app/actions/confirm-review.ts#L126), best-effort: on confirm-side failure with a captured `fileId`, the code calls `drive.files.delete({ fileId })` inside its own try/catch and swallows any failure (logs only). The original plan (`context/changes/epub-import-to-drive/plan.md`) explicitly accepts the one orphan-on-double-failure case as "consistent with the app-independent guardrail."

**Implications for the harness:**

- Tests must drive the **`confirmReviewAction`** path (and seed a `book_drafts` row to feed it), not `importEpubAction`. A test that targets `importEpubAction` only exercises the draft-creation transaction; it does not touch the Risk-#1 surface.
- The natural fake-Drive injection seam is **`getDriveClient()`** in [`src/lib/drive/client.ts:7`](src/lib/drive/client.ts#L7) — there is no `DriveClient` interface, all callers depend on the concrete `drive_v3.Drive` type. The cleanest way to fake it without a refactor is `vi.mock('@/lib/drive/client', ...)` at the test level.
- DB seam: Kysely is a Proxy-wrapped singleton over a `globalThis`-cached `pg.Pool`, keyed on `process.env.DATABASE_URL` read on first access ([`src/lib/db.ts:77-115`](src/lib/db.ts#L77)). Set `DATABASE_URL` to a test database before any first import; reset `globalThis.__bookshelfDb` and `globalThis._pgPool` between test files if isolation requires it.
- Test infrastructure is **green-field**: no Vitest, no test files, no fixtures, no CI workflow. Docker Compose Postgres 16-alpine *is* in place ([`docker-compose.yml`](docker-compose.yml)) with credentials matching `.envrc` and an `npm run db:migrate` runner ready to point at any `DATABASE_URL`.

## Detailed Findings

### 1. The two-action import flow

The plan's "import action" maps to **two** real actions. The naming hides the atomicity seam.

#### `importEpubAction` — draft creation only

[`src/app/actions/import-epub.ts:13-56`](src/app/actions/import-epub.ts#L13):

```typescript
export async function importEpubAction(_prev, formData) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const file = formData.get("file");
  // ...validate, parse epub metadata...
  const userId = await getUserIdByEmail(session.user.email);

  const bookId = await createDraft({
    userId, filename: file.name, derivedTitle,
    embeddedMetadata: { author, isbn, coverBytes, coverMime },
    stagedBytes: buffer,                       // ← raw bytes go to book_drafts
  });

  redirect(`/review/${bookId}`);
}
```

`createDraft` ([`src/lib/book-drafts.ts:42-70`](src/lib/book-drafts.ts#L42)) inserts a `books` row with `review_state: 'pending'` and a `book_drafts` row carrying the staged bytes — both inside `db.transaction().execute(async (trx) => ...)`. **No Drive call.** Safe-by-construction.

#### `confirmReviewAction` — Drive upload + DB commit (the Risk-#1 surface)

[`src/app/actions/confirm-review.ts:59-139`](src/app/actions/confirm-review.ts#L59). The full critical region:

```typescript
let fileId: string | undefined;

try {
  const drive = await getDriveClient();
  const folderId = await getOrCreateLibraryFolder(drive, session.user.email);
  const desired = composeFilename(author || null, title);
  const finalName = await findAvailableFilename(drive, folderId, desired);
  fileId = await uploadBookToDrive(            // ← Drive write (line 106)
    drive, folderId, finalName, draft.stagedBytes
  );

  await confirmDraft(bookId, userId, {         // ← DB transaction (line 113)
    title, author, isbn, coverBytes, coverMime,
    driveFileId: fileId,
  });
} catch (e) {
  if (e instanceof DriveAuthError) {
    await signOut({ redirect: false });
    redirect("/signin?expired=1");
  }
  if (fileId) {
    try {
      const drive = await getDriveClient();
      await drive.files.delete({ fileId });    // ← rollback-delete (line 129)
    } catch (deleteErr) {
      console.error("Rollback delete failed:", deleteErr);
    }
  }
  console.error("Confirm review failed:", e);
  return { ok: false, message: "Could not finish import. Please try again." };
}

redirect("/");
```

#### Ordering

1. Drive folder lookup / create ([`library-folder.ts:8-66`](src/lib/drive/library-folder.ts#L8))
2. Filename collision check ([`upload.ts:23-36`](src/lib/drive/upload.ts#L23))
3. **Drive file upload** ([`upload.ts:37-58`](src/lib/drive/upload.ts#L37)) → returns `fileId`
4. **DB transaction**: UPDATE books `pending → confirmed` + DELETE book_drafts ([`book-drafts.ts:140-167`](src/lib/book-drafts.ts#L140))

The Drive upload is **outside** the DB transaction. The transaction only covers the `pending → confirmed` transition and the draft cleanup.

### 2. What the rollback path actually guarantees

The catch block at [`confirm-review.ts:121-136`](src/app/actions/confirm-review.ts#L121) handles three sub-cases:

| Failure point | `fileId` value | What runs | Final state | Notes |
|---|---|---|---|---|
| `getDriveClient()` throws `DriveAuthError` (token rotation failed) | `undefined` | `signOut` + `redirect("/signin?expired=1")` (throws) | Draft stays at `pending`; no Drive file. User redirected. | This branch returns through the redirect, *not* through the rollback-delete code. Drift risk: if `DriveAuthError` were ever raised *after* an upload (it isn't today — only `getDriveClient` throws it), the rollback would be skipped. |
| Drive folder/collision/upload throws *before* `uploadBookToDrive` returns | `undefined` | Falls into `fileId`-guarded rollback (skipped because `fileId` is `undefined`), returns generic error | Draft stays at `pending`; no Drive file; user sees "Could not finish import." | User can revisit `/review/{bookId}` and retry — the draft persists. |
| `uploadBookToDrive` returns, then `confirmDraft` throws | set | Rollback-delete runs (best-effort) | If delete succeeds: draft stays at `pending`, no Drive file (full revert). If delete fails: draft stays at `pending`, **orphan Drive file** (logged). | This is the "double failure" the original plan accepts as a manual-cleanup case. |

**Subtle invariant**: the books row is never deleted — it's transitioned `pending ↔ confirmed`. So "DB row written" in the test plan's risk wording maps to **`books.review_state = 'confirmed'` AND `books.drive_file_id IS NOT NULL`**, not to "a row appears." A `pending` row with `drive_file_id IS NULL` is the expected mid-flow state.

### 3. Drive client seam — where the fake plugs in

[`src/lib/drive/client.ts:7-19`](src/lib/drive/client.ts#L7):

```typescript
export async function getDriveClient(): Promise<drive_v3.Drive> {
  const session = await auth();
  if (!session?.user || !session.access_token
      || session.error === "RefreshAccessTokenError") {
    throw new DriveAuthError();
  }
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.access_token });
  return google.drive({ version: "v3", auth: oauth2Client });
}
```

Key facts:

- **Per-call factory**, not a singleton. Each Drive operation calls `getDriveClient()` fresh.
- Returns the **concrete `drive_v3.Drive` type** — no interface abstracting it.
- Every Drive helper in `src/lib/drive/` takes `drive: drive_v3.Drive` as a parameter. The construction is centralized at this single seam.

Drive surface actually exercised by the confirm flow (the surface the fake must implement):

| Call | File:Line | Purpose |
|---|---|---|
| `drive.files.list({ q: ... })` (search by name/parent) | [`library-folder.ts:15`](src/lib/drive/library-folder.ts#L15), [`library-folder.ts:46`](src/lib/drive/library-folder.ts#L46), [`upload.ts:29`](src/lib/drive/upload.ts#L29) | Find `Bookshelf/` folder, find collisions |
| `drive.files.create({ requestBody, media })` (upload) | [`library-folder.ts:26`](src/lib/drive/library-folder.ts#L26), [`library-folder.ts:57`](src/lib/drive/library-folder.ts#L57), [`upload.ts:44`](src/lib/drive/upload.ts#L44) | Create folder; upload epub |
| `drive.files.delete({ fileId })` | [`confirm-review.ts:129`](src/app/actions/confirm-review.ts#L129) | Rollback-delete |

**Recommended injection pattern for tests** (no production refactor):

```typescript
// In the test file:
vi.mock("@/lib/drive/client", () => ({
  getDriveClient: vi.fn(async () => fakeDrive),  // configured per test
}));
```

Where `fakeDrive` is a partial `drive_v3.Drive` shape exposing the four method paths above. Per-test, configure the fake to (a) succeed end-to-end, (b) throw on `files.create`, (c) succeed on upload but throw on `files.delete` to drive the double-failure branch.

OAuth/token state is fully encapsulated inside `getDriveClient()`. Mocking the module bypasses `auth()` and token concerns at this seam — the test only needs to mock `auth()` independently if a test wants to drive a `DriveAuthError`.

### 4. DB layer — connection, schema, transactions

#### Connection seam ([`src/lib/db.ts:77-115`](src/lib/db.ts#L77))

```typescript
function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!globalThis._pgPool) {
    globalThis._pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return globalThis._pgPool;
}

function getDb(): Kysely<Database> {
  if (!globalThis.__bookshelfDb) {
    globalThis.__bookshelfDb = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: getPool() }),
    });
  }
  return globalThis.__bookshelfDb;
}

export const db = new Proxy({} as Kysely<Database>, { /* lazy passthrough */ });
```

`DATABASE_URL` is read at first-touch, not at import. Tests can set it before the first DB call. To reset between test files pointing at different DBs, clear `globalThis.__bookshelfDb` and `globalThis._pgPool`.

#### `books` table (relevant for assertions)

Consolidated from [`src/lib/db.ts:18-31`](src/lib/db.ts#L18) (typed shape) and migrations [`0002_library_schema.mts`](src/lib/db/migrations/0002_library_schema.mts) + [`0003_book_drafts.mts`](src/lib/db/migrations/0003_book_drafts.mts):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK, `DEFAULT gen_random_uuid()` |
| `user_id` | UUID | NO | FK → `users(id)` ON DELETE CASCADE |
| `drive_file_id` | TEXT | **YES** (made nullable in 0003) | The Drive file pointer. `NOT NULL` once `review_state = 'confirmed'`. |
| `title` | TEXT | NO | |
| `author`, `isbn` | TEXT | YES | |
| `cover_bytes` | BYTEA | YES | |
| `cover_mime` | TEXT | YES | |
| `trashed_at` | TIMESTAMPTZ | YES | |
| `review_state` | TEXT | NO | Values: `'pending'` \| `'confirmed'`, default `'confirmed'` |
| `created_at`, `updated_at` | TIMESTAMPTZ | NO | `DEFAULT NOW()` |

`book_drafts` is a side table keyed by `book_id` (PK + FK), carrying `filename`, `staged_bytes` (BYTEA), `proposals` (JSONB nullable).

#### Transaction pattern

[`src/lib/book-drafts.ts:140-167`](src/lib/book-drafts.ts#L140) (the confirm transaction):

```typescript
await db.transaction().execute(async (trx) => {
  const updated = await trx
    .updateTable("books")
    .set({ drive_file_id, ..., review_state: "confirmed", updated_at })
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .where("review_state", "=", "pending")
    .executeTakeFirst();

  if (Number(updated.numUpdatedRows) === 0) {
    throw new Error(`Draft not found or already confirmed: ${bookId}`);
  }

  await trx.deleteFrom("book_drafts").where("book_id", "=", bookId).execute();
});
```

`db.transaction().execute(async (trx) => { ... })` is the established pattern. Exceptions inside the block trigger automatic rollback. The same pattern is used in `createDraft` ([`book-drafts.ts:42`](src/lib/book-drafts.ts#L42)) and `renameOrMergeTag` ([`tags.ts:163`](src/lib/tags.ts#L163)).

#### Migration runner

[`scripts/migrate.mts`](scripts/migrate.mts) — Kysely `FileMigrationProvider` over `src/lib/db/migrations/`. Two scripts:

- `npm run db:migrate` — runs all pending forward
- `npm run db:migrate:down` — rolls back the latest one

Tracks state in `kysely_migration` + `kysely_migration_lock`. Requires `DATABASE_URL`. Exits 1 on failure. Three migrations today:

1. `0001_initial_auth_tokens.mts` — auth_tokens (email PK, BYTEA refresh_token)
2. `0002_library_schema.mts` — users, books (NOT NULL drive_file_id at this point), tags, book_tags, notes
3. `0003_book_drafts.mts` — adds `review_state`, makes `drive_file_id` nullable, creates `book_drafts`

Replay (down → up) round-trips are tested implicitly by the harness only after Phase 1 ships them.

### 5. Test infrastructure: what exists, what's missing

| Concern | Status | Detail |
|---|---|---|
| Vitest installed | ❌ Missing | Not in [`package.json`](package.json) devDependencies |
| `vitest.config.ts` | ❌ Missing | — |
| Any `*.test.ts` / `*.spec.ts` | ❌ Missing | Zero test files anywhere |
| Jest / Playwright / node:test | ❌ Missing | No other runner |
| Docker Compose Postgres | ✅ Ready | `postgres:16-alpine`, port 5432, db/user/pass = `bookshelf`/`bookshelf`/`bookshelf`, healthcheck wired |
| Migration runner | ✅ Ready | `npm run db:migrate` / `npm run db:migrate:down`, points at `$DATABASE_URL` |
| `.env.example` | ✅ Present | Names all required env vars |
| `.envrc` (direnv) | ✅ Present | Has local dev credentials; tests must not use it |
| Sample `.epub` fixture | ❌ Missing | No fixtures directory at all |
| CI workflow | ❌ Missing | No `.github/` directory; only `render.yaml` for deploy |
| Test script in `package.json` | ❌ Missing | No `test` script |
| `tsconfig.test.json` | ❌ Missing | `tsconfig.json` strict, paths `@/*` → `./src/*` is fine for tests |

[`docker-compose.yml`](docker-compose.yml):

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bookshelf
      POSTGRES_PASSWORD: bookshelf
      POSTGRES_DB: bookshelf
    ports: ["5432:5432"]
    volumes: [bookshelf_pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bookshelf -d bookshelf"]
      interval: 5s
      timeout: 5s
      retries: 10
```

**Verdict**: green-field harness install. Nothing to remove or refactor; everything to add.

## Code References

- [`src/app/actions/import-epub.ts:13-56`](src/app/actions/import-epub.ts#L13) — `importEpubAction`, draft creation only (no Drive)
- [`src/app/actions/confirm-review.ts:59-139`](src/app/actions/confirm-review.ts#L59) — `confirmReviewAction`, **the Risk-#1 surface**
- [`src/app/actions/confirm-review.ts:99-120`](src/app/actions/confirm-review.ts#L99) — Drive-first ordering: upload then DB transaction
- [`src/app/actions/confirm-review.ts:121-136`](src/app/actions/confirm-review.ts#L121) — Catch block with best-effort rollback-delete
- [`src/app/actions/confirm-review.ts:126-132`](src/app/actions/confirm-review.ts#L126) — Rollback delete (swallows its own failure)
- [`src/lib/drive/client.ts:7-19`](src/lib/drive/client.ts#L7) — `getDriveClient()` — the injection seam for the fake
- [`src/lib/drive/upload.ts:23-58`](src/lib/drive/upload.ts#L23) — `findAvailableFilename`, `uploadBookToDrive` (the upload contract)
- [`src/lib/drive/library-folder.ts:8-66`](src/lib/drive/library-folder.ts#L8) — folder lookup/create
- [`src/lib/drive/errors.ts`](src/lib/drive/errors.ts) — `DriveAuthError` (caught specially in confirm)
- [`src/lib/book-drafts.ts:42-70`](src/lib/book-drafts.ts#L42) — `createDraft` (the draft-creation transaction)
- [`src/lib/book-drafts.ts:135-167`](src/lib/book-drafts.ts#L135) — `confirmDraft` (the pending → confirmed transaction)
- [`src/lib/db.ts:77-115`](src/lib/db.ts#L77) — Pool + Kysely Proxy singleton over `DATABASE_URL`
- [`src/lib/db.ts:18-31`](src/lib/db.ts#L18) — Typed `BooksTable` shape used by Kysely
- [`src/lib/db/migrations/0002_library_schema.mts`](src/lib/db/migrations/0002_library_schema.mts) — `users`, `books`, `tags`, `book_tags`, `notes`
- [`src/lib/db/migrations/0003_book_drafts.mts`](src/lib/db/migrations/0003_book_drafts.mts) — adds `review_state`; makes `drive_file_id` nullable; creates `book_drafts`
- [`scripts/migrate.mts`](scripts/migrate.mts) — migration runner CLI
- [`docker-compose.yml`](docker-compose.yml) — Postgres 16-alpine service for local + CI
- [`package.json`](package.json) — no test runner present; `db:migrate` and `db:migrate:down` scripts ready

## Architecture Insights

- **Draft-then-confirm is a deliberate split**, not an artifact. It lets the user accept/reject AI-proposed metadata before Drive bytes are written. Side effect: it means the only path that can produce an inconsistent (DB ↔ Drive) state is `confirmReviewAction`. The first action is purely transactional within Postgres.
- **The atomicity story relies on a single compensating action**, not on distributed-transaction machinery. The pattern is "do the side-effecting external thing first; on failure of the local transactional thing, attempt to undo the external thing best-effort, surface a clean error to the user." This is acknowledged in [`context/changes/epub-import-to-drive/plan.md`](context/changes/epub-import-to-drive/plan.md): "A double-failure (DB throws, delete throws) leaks one file into the user's Drive; that's recoverable manually and consistent with the app-independent guardrail."
- **No Drive client interface exists.** Every helper takes the concrete `drive_v3.Drive`. The single construction seam (`getDriveClient`) is the natural and only place to inject a fake without refactoring.
- **DB Proxy + globalThis singleton** is unusual but deliberate: it survives Next.js dev-server hot reloads. For tests, the `globalThis` keys are the explicit reset points.
- **`fileId` lifecycle in the catch block** is a hidden invariant: `fileId` is set only between `uploadBookToDrive` returning and `confirmDraft` throwing. The `if (fileId)` guard at `confirm-review.ts:126` is correct precisely because of this — the test plan's "mid-upload failure" case (Drive throws *during* `files.create`) leaves `fileId` undefined and no rollback runs (correctly, since there's nothing to delete).
- **`books.review_state` is the atomicity oracle** for tests. A consistent post-state is one of:
  - `pending` + `drive_file_id IS NULL` + `book_drafts` row exists (draft, no Drive bytes)
  - `confirmed` + `drive_file_id IS NOT NULL` + matching Drive file present + no `book_drafts` row (success)
  - Any other combination is a Risk-#1 violation.

## Historical Context (from prior changes)

- [`context/changes/epub-import-to-drive/plan.md`](context/changes/epub-import-to-drive/plan.md) — the design that introduced the rollback-delete pattern. Phase 2 explicitly states: "Rollback delete on DB-insert failure. After `drive.files.create` returns a `fileId`, wrap the DB insert in try/catch. On catch, call `drive.files.delete({fileId})` inside a separate try/catch (best-effort — log and swallow). Re-throw the DB error so the action surfaces a user-visible failure. A double-failure (DB throws, delete throws) leaks one file into the user's Drive; that's recoverable manually and consistent with the app-independent guardrail." The shipped code follows this verbatim, with the small wrinkle that the action *returns* an error state rather than re-throwing (action API uses the React form-action `ConfirmReviewState` pattern).
- [`context/changes/drive-oauth-and-client/plan.md`](context/changes/drive-oauth-and-client/plan.md) — established the per-call `getDriveClient()` factory shape and the `DriveAuthError → /signin?expired=1` recovery path. Notes: "Phase 2 layers the Drive client on top: a server-only `getDriveClient()` factory using `googleapis`, a typed `checkDriveConnection()` helper..." The plan never named a test-injection seam — Phase 1 (this change) is the first time testability of the Drive boundary is being designed in.
- [`context/changes/library-data-schema/plan.md`](context/changes/library-data-schema/plan.md) — established the migration runner contract and the `users` row bootstrap pattern (signIn callback `INSERT … ON CONFLICT DO NOTHING`). Tests must seed a `users` row before any books work due to the FK from `books.user_id`.
- [`context/changes/ai-metadata-enrichment-gate/`](context/changes/ai-metadata-enrichment-gate/) — added the `review_state` + `book_drafts` two-phase flow. This is what made the import a two-action affair; the original `epub-import-to-drive` plan described a single-shot import.

(Note: `context/archive/` is empty apart from its README — none of the above are archived yet.)

## Related Research

None yet — this is the first per-phase research under the test plan. Future phases (Risks #6 notes, #4 tag rename, #3 Drive errors, #5 AI privacy, #7 session boundary) will reuse the Postgres harness and the Drive-fake pattern introduced here.

## Open Questions

These belong to the *planning* step, not this research — flagging them so `/10x-plan` can resolve them deliberately:

1. **Should the test plan's wording in `test-plan.md` §2 Risk #1 / §2 Risk Response be updated** to name `confirmReviewAction` explicitly, or is the abstract "import action" framing intentional (and we update the harness contract only)? The wording isn't wrong — `confirmReviewAction` *is* part of the user's import flow — but it's worth making the two-action split visible in the row for future readers.
2. **Should the test harness assert on the double-failure case** (Drive upload OK, `confirmDraft` throws, `files.delete` also throws → orphan)? The plan explicitly accepts this state. A test could either (a) verify the user-visible error + the swallowed log, or (b) skip this case as out-of-contract. Recommend (a) — verifying the *observable* contract that the user sees the same error and the action doesn't crash, even if the orphan is left behind. The orphan itself isn't directly observable from the test harness without scanning Drive.
3. **Test database lifecycle**: per-test transaction-rollback (fast, but doesn't exercise commit visibility across pools) vs per-test truncate (slower, simpler, matches production semantics). The confirm flow uses `db.transaction()` internally, so wrapping the test in an *outer* transaction will produce nested savepoints rather than a true commit — recommend truncate-between-tests for this risk, but the call belongs to the plan.
4. **`auth()` mocking strategy**: the action calls `await auth()` at line 63. Tests need a session with `user.email` set. Recommend `vi.mock('@/auth')` alongside the Drive mock, with a per-test session fixture.
5. **Render Postgres major-version parity** (Risk #2, covered in the same change folder): does the CI Postgres image need to be *exactly* the Render-hosted version (which Render major?), or is `postgres:16-alpine` good enough? Needs grounding via the Render MCP. The current `docker-compose.yml` uses 16, but Render Postgres major needs verification. Out of scope for Risk #1 but inside the Phase 1 change.
