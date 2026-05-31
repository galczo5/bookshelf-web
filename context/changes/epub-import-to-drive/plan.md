# Epub Import to Drive Implementation Plan

## Overview

Ship the first end-to-end write path. The operator drops or picks an epub on `/`; the server parses its embedded metadata, uploads the file to a flat `Bookshelf/` folder in Drive under `<author> — <title>.epub`, and inserts a `books` row. This closes the import half of US-01 (S-02 will fill metadata gaps with AI; S-03 will surface the library list).

## Current State Analysis

- **OAuth + Drive client (F-01)** are in place. `src/lib/drive/client.ts:7-19` returns an authenticated `drive_v3.Drive`. Refresh rotation works; `DriveAuthError` is the existing signal for clearing the session.
- **Schema (F-02)** is in place. `src/lib/db/migrations/0002_library_schema.mts` created `users`, `books`, `tags`, `book_tags`, `notes`. The `books` table has the columns this slice needs (`drive_file_id`, `title`, `author`, `isbn`, `cover_bytes`, `cover_mime`, `user_id`, `trashed_at`).
- **`users` is empty.** F-02 explicitly deferred the upsert: "S-01 must add the `signIn` callback upsert before its first books INSERT." Nothing reads or writes the table today.
- **`Bookshelf/` folder does not exist in Drive.** F-01's brief: "no `Bookshelf/` folder creation in Drive (lands in S-01)."
- **No epub parser, no file-upload UI, no Drive write code.** `src/lib/drive/` has only `client.ts`, `errors.ts`, and `connection-check.ts` (read-only `about.get`).
- **Server-action pattern is established.** `src/app/actions/check-drive.ts` returns a discriminated union (`{ok: true, ...} | {ok: false, message}`); `src/app/components/check-drive-button.tsx` consumes it via `useActionState`. The import slice mirrors this shape.
- **No global `bodySizeLimit` is set.** `next.config.ts` is minimal (`{ output: "standalone" }`). The Next.js 16 default body limit for server actions is 1MB (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:26`); typical epubs are 1–5MB.
- **OAuth scope is `drive.file`.** App can only see/modify files the app itself created. Means: the `Bookshelf/` lookup query will only ever return the folder this app created; the user can't pre-place a folder for us to find, and a manually-deleted folder will be cleanly re-created on next import.

## Desired End State

A signed-in operator drags a `.epub` (or clicks to pick) on `/`. Within a few seconds:
- A `books` row exists with the file's title, author, ISBN, cover bytes, and `drive_file_id`.
- The `.epub` lives in Drive at `Bookshelf/<sanitized-author> — <sanitized-title>.epub`.
- The page shows `Imported: <title> by <author>` inline under the dropzone.

A second drop of the same file lands as a sibling with a `(2)` suffix in Drive and a second `books` row — visible-but-tolerated duplication. A drop of a malformed or non-epub file shows a clean inline error and writes nothing. A drop while the refresh token has been revoked clears the session and redirects to `/signin?expired=1`.

### Key Discoveries:

- `serverActions.bodySizeLimit` under `experimental` is the only config path for raising the action body size in Next 16 (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:24-40`).
- `useActionState` + discriminated-union return is the codebase convention — `src/app/components/check-drive-button.tsx:7-9` is the canonical example.
- `DriveAuthError` is the established marker for "refresh token died" — `src/app/actions/check-drive.ts:27-37` shows the handler pattern (catch → `signOut({redirect:false})` → `redirect('/signin?expired=1')`).
- `googleapis` v144 is already a top-level dep (`package.json`); no new Google SDK install needed.
- `gen_random_uuid()` defaults are on `users.id` and `books.id` (`0002_library_schema.mts:6-7,18-19`), so INSERTs need only the foreign data.
- The `users` schema uses `email TEXT UNIQUE NOT NULL` (`0002_library_schema.mts:9`) — `INSERT … ON CONFLICT (email) DO NOTHING RETURNING id` would not return the existing row's id; the upsert must do an INSERT-then-SELECT pair, or a `RETURNING id` with `ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email` (no-op update that still returns the row).

## What We're NOT Doing

- **No library list view.** S-03 owns it. Post-import feedback is the per-import inline confirmation only.
- **No AI metadata enrichment.** S-02 owns it. When `<dc:title>` is missing, fall back to the filename; leave author/ISBN/cover as null.
- **No content-hash deduplication.** Every import creates a new `books` row; Drive filename collision is resolved with a numeric suffix.
- **No edit affordance for imported books.** No way (yet) to fix a wrong title or add a cover after import; that's S-02's review gate.
- **No streaming upload to Drive.** Whole file is buffered server-side then streamed to Drive. 20MB body limit is the budget.
- **No background worker, no retry queue.** If Drive upload fails, the user sees the error and re-drops. Phase 2 includes the rollback-delete on DB-insert failure; that's it.
- **No `content_hash` column on `books`.** Deferred until a dedup or integrity-verification slice asks for it.
- **No PDF, MOBI, or other formats.** Strict-epub-only per PRD Non-Goals.
- **No epub file modification.** We read; we never write back to the file. PRD Non-Goals: "No modification of the original epub file."
- **No persistent Drive folder ID cache in the DB.** Module-level in-memory cache keyed by email; rebuilds on cold start (one extra `files.list` per first import after a cold start).

## Implementation Approach

Two phases. Phase 1 ships the happy path end-to-end — a perfect epub round-trips. Phase 2 hardens the edges: filename collision, missing-title fallback, malformed-epub detection. The phase split is verification-driven: Phase 1's manual test is "drop a clean epub, see it in Drive and DB"; Phase 2's manual tests are deliberately-broken inputs.

The slice introduces two new internal modules under `src/lib/drive/` (`library-folder`, `upload`) and one under `src/lib/epub/` (`parse`). All three are server-only. The server action `importEpubAction` orchestrates them. The client component is a thin `useActionState` wrapper around a dropzone with a hidden `<input type="file">`.

## Critical Implementation Details

### Drive scope constraints (`drive.file`)

`drive.file` only sees files the app created. Two consequences for this slice:

- **Folder lookup query**: use `q: "name='Bookshelf' and mimeType='application/vnd.google-apps.folder' and trashed=false"`. Do NOT add `'root' in parents` — the user can move the folder; the query still finds it as long as we created it. If the result list is empty, create a new folder via `files.create` with `mimeType: 'application/vnd.google-apps.folder'` and no `parents` (lands in the user's Drive root).
- **Collision check (Phase 2)**: list children of the folder ID with `q: "'<folderId>' in parents and name = '<candidate>' and trashed=false"`. Reliable because we created every file in there.

### Cover image discovery (EPUB 2 vs EPUB 3)

Two different conventions; both must be tried in order:

1. **EPUB 3**: an OPF `<manifest>` item with `properties="cover-image"` — read its `href`, resolve relative to the OPF path, read those bytes from the zip.
2. **EPUB 2 fallback**: an OPF `<metadata>` entry `<meta name="cover" content="<itemId>">` — find the manifest item with `id="<itemId>"`, read its `href`, same resolution.

If neither yields bytes, `cover_bytes` and `cover_mime` stay null. `cover_mime` comes from the manifest item's `media-type` attribute.

### Filename sanitization

Both the author segment and the title segment must be sanitized before composing `<author> — <title>.epub`. Replace any of `/ \ : * ? " < > |` with `_`. Collapse runs of whitespace to single spaces. Trim leading/trailing whitespace and dots. Cap each segment at 100 characters (so the combined name stays under common 255-char filesystem limits with room for the suffix). Result must be non-empty after sanitization — if it is, substitute `unknown`.

### Rollback delete on DB-insert failure

After `drive.files.create` returns a `fileId`, wrap the DB insert in try/catch. On catch, call `drive.files.delete({fileId})` inside a separate try/catch (best-effort — log and swallow). Re-throw the DB error so the action surfaces a user-visible failure. A double-failure (DB throws, delete throws) leaks one file into the user's Drive; that's recoverable manually and consistent with the app-independent guardrail.

### Body-size config gotcha

The `experimental.serverActions.bodySizeLimit` must be set before the first deploy that exposes the dropzone, or every multi-MB epub upload fails with a 413-shaped error at the Next.js layer (before reaching the action code). The default is 1MB.

## Phase 1: Happy-path import end-to-end

### Overview

A clean, well-formed epub goes from drop → server-side parse → Drive `Bookshelf/` folder → upload → `books` INSERT → inline `"Imported: <title> by <author>"` confirmation. Rollback delete is included so a half-successful import doesn't leak Drive files. Body-size config and dependencies are wired here so the integration is real, not stubbed.

### Changes Required:

#### 1. Add new dependencies

**File**: `package.json`

**Intent**: Install `jszip` (zip reading) and `fast-xml-parser` (OPF XML parsing). Both are popular, typed, well-maintained npm packages with large LLM training surfaces.

**Contract**: New runtime deps `jszip` and `fast-xml-parser` (latest stable). No type-only sibling deps needed (both ship their own types).

#### 2. Raise server-action body limit

**File**: `next.config.ts`

**Intent**: Allow up to ~20MB request bodies on server actions so multi-MB epub uploads aren't rejected before reaching the action.

**Contract**: `experimental.serverActions.bodySizeLimit: '20mb'` added to the existing `NextConfig` object. Keep `output: 'standalone'` untouched.

#### 3. `users` row upsert in the signIn callback

**File**: `src/auth.ts`

**Intent**: Bootstrap the operator's `users` row on every sign-in so `books.user_id` always has a row to reference. Idempotent — every sign-in is safe.

**Contract**: Inside the existing `signIn` callback (`src/auth.ts:45-49`), after the allow-list check passes and before the `true` return, call a new helper `await upsertUserByEmail(user.email)`. Helper lives in `src/lib/users.ts` (new file) and runs `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`. No return value needed — the subsequent SELECT in the import action will resolve the id.

#### 4. Users helper module

**File**: `src/lib/users.ts` (new)

**Intent**: Server-only module exporting two functions: `upsertUserByEmail(email)` for the signIn bootstrap, and `getUserIdByEmail(email)` for the import action.

**Contract**:
- `upsertUserByEmail(email: string): Promise<void>` — Kysely insert with `onConflict(oc => oc.column('email').doNothing())`.
- `getUserIdByEmail(email: string): Promise<string>` — `selectFrom('users').select('id').where('email', '=', email).executeTakeFirstOrThrow()`. Throws if the row is missing (signals a bug — signIn should have created it).
- File starts with `import "server-only";`.

#### 5. Epub parser module

**File**: `src/lib/epub/parse.ts` (new)

**Intent**: Pure function that takes a Buffer (the epub file bytes) and returns parsed metadata + optional cover bytes. No I/O beyond the in-memory zip read.

**Contract**:
```ts
export interface EpubMetadata {
  title: string | null;          // <dc:title>, first occurrence
  author: string | null;          // <dc:creator>, first occurrence; joined with ", " if multiple
  isbn: string | null;            // <dc:identifier> with opf:scheme="ISBN" OR scheme="isbn" (case-insensitive)
  cover: { bytes: Buffer; mime: string } | null;
}

export class EpubParseError extends Error { code = "EPUB_PARSE_ERROR" as const; }

export async function parseEpub(buffer: Buffer): Promise<EpubMetadata>;
```

Implementation outline (no snippet — straight zip-then-xml walk): load buffer with `JSZip.loadAsync`, read `META-INF/container.xml`, parse with `fast-xml-parser` (configure `attributeNamePrefix: "@_"`, `ignoreAttributes: false`), extract `rootfile`'s `full-path` attribute → load the OPF entry → parse → extract `dc:title`, `dc:creator`, `dc:identifier` filtered for ISBN scheme → discover cover (see Critical Implementation Details). All "missing" cases yield `null` rather than throwing; only structurally-invalid zip / missing-OPF / unparseable-XML throw `EpubParseError`. Phase 1 lands the happy-path code; Phase 2 will exercise the null and throw paths.

#### 6. Drive library-folder helper

**File**: `src/lib/drive/library-folder.ts` (new)

**Intent**: One call site for "give me the folder ID where books live for this operator." Lazy-create on first miss; cache in-process.

**Contract**:
- `getOrCreateLibraryFolder(drive: drive_v3.Drive, email: string): Promise<string>` — returns the Drive folder ID.
- Module-level `Map<string, string>` cache keyed by email.
- Cache miss → `drive.files.list({q: "name='Bookshelf' and mimeType='application/vnd.google-apps.folder' and trashed=false", fields: 'files(id)'})` → if `files[0]?.id` set the cache and return; else `drive.files.create({requestBody: {name: 'Bookshelf', mimeType: 'application/vnd.google-apps.folder'}, fields: 'id'})`, cache and return.
- File starts with `import "server-only";`.

#### 7. Drive uploader

**File**: `src/lib/drive/upload.ts` (new)

**Intent**: One call: given a folder ID, a target filename, and the file bytes, upload to Drive and return the new fileId. Stays decoupled from naming policy and collision logic (Phase 2 owns those at the call site).

**Contract**:
- `uploadBookToDrive(drive: drive_v3.Drive, folderId: string, filename: string, buffer: Buffer): Promise<string>` — returns the new fileId.
- Calls `drive.files.create({requestBody: {name: filename, parents: [folderId]}, media: {mimeType: 'application/epub+zip', body: Readable.from(buffer)}, fields: 'id'})`.
- No error catching — caller decides what to do on failure.
- File starts with `import "server-only";`.

#### 8. Import server action

**File**: `src/app/actions/import-epub.ts` (new)

**Intent**: Orchestrates the full flow: validate auth → read FormData → parse epub → get folder → upload → resolve user_id → INSERT → return status. Mirrors the shape of `checkDriveAction`.

**Contract**:
```ts
export type ImportEpubState =
  | null
  | { ok: true; title: string; author: string | null }
  | { ok: false; message: string };

export async function importEpubAction(
  _prev: ImportEpubState,
  formData: FormData
): Promise<ImportEpubState>;
```

Behavior:
1. `await auth()` — if missing, redirect to `/signin`.
2. Read `formData.get('file')` as a `File`; if absent or empty, return `{ok: false, message: 'No file provided'}`.
3. Convert to `Buffer` via `Buffer.from(await file.arrayBuffer())`.
4. `parseEpub(buffer)` — Phase 1 assumes happy-path success; Phase 2 will wrap in try/catch.
5. `getDriveClient()` and `getOrCreateLibraryFolder(drive, session.user.email)`.
6. Compose target filename via a `composeFilename(author, title)` helper local to this file: `<sanitized-author> — <sanitized-title>.epub`. Phase 1 happy-path version assumes both are non-null. Sanitization function may also live here (small enough — no need for a dedicated module).
7. `uploadBookToDrive(drive, folderId, filename, buffer)` → `fileId`.
8. `getUserIdByEmail(session.user.email!)` → `userId`.
9. Try `db.insertInto('books').values({...}).execute()`; on catch, call `drive.files.delete({fileId})` inside a swallowed try/catch (log to console.error); re-throw.
10. Return `{ok: true, title, author}`.
11. Catch `DriveAuthError` at the top level → `signOut({redirect: false})` → `redirect('/signin?expired=1')` (mirror of `checkDriveAction`).
12. File starts with `"use server";`.

#### 9. Dropzone client component

**File**: `src/app/components/import-dropzone.tsx` (new)

**Intent**: Single labeled drop region that also opens the file picker on click. Renders inline success/failure messages via `useActionState`.

**Contract**:
- `"use client";` directive.
- Uses `useActionState<ImportEpubState, FormData>(importEpubAction, null)`.
- Visible copy: "Drop an epub here, or click to pick".
- Hidden `<input type="file" accept=".epub,application/epub+zip">` with a `ref`; click-to-pick triggers the input.
- `onDrop` / `onDragOver` handlers on the wrapping label/div; on file drop, set the input's `files` and submit the surrounding form.
- Disabled (visual + functional) while `isPending`.
- Render `{state?.ok === true && <p>Imported: {state.title} by {state.author ?? "Unknown"}</p>}` and `{state?.ok === false && <p className="text-red-600">{state.message}</p>}` below the dropzone.

#### 10. Home-page wiring

**File**: `src/app/page.tsx`

**Intent**: Render the dropzone in the existing card layout. Keep the check-drive button and sign-out for now (useful smoke-test surfaces).

**Contract**: Add `<ImportDropzone />` inside the card, above `<CheckDriveButton />`. Import from `@/app/components/import-dropzone`. No other changes.

### Success Criteria:

#### Automated Verification:

- `npm install` succeeds; `package.json` lists `jszip` and `fast-xml-parser` under `dependencies`.
- `npm run lint` passes with no new warnings or errors.
- `npm run build` succeeds (catches body-limit syntax errors, type errors, missing imports).
- `npm run db:migrate` is a no-op (no new migrations in this slice) and exits 0.

#### Manual Verification:

- After sign-in, `/` shows the dropzone with placeholder copy.
- Clicking the dropzone opens the OS file picker filtered to `.epub`.
- Picking a clean, well-formed epub triggers an upload; within a few seconds, the page shows `Imported: <title> by <author>` inline.
- The `Bookshelf/` folder appears in Drive root via the Drive web UI; the imported `.epub` is inside, named `<author> — <title>.epub`.
- A new `books` row exists in the DB with `title`, `author`, `isbn`, `cover_bytes` (non-empty), `cover_mime`, `drive_file_id`, `user_id` populated and `trashed_at` null.
- A `users` row exists for the operator's email (created at sign-in).
- A second sign-in (sign out + sign in) creates no second `users` row (upsert idempotent).
- Dragging the same epub onto the dropzone (instead of clicking) also imports successfully.
- Importing while the refresh token is revoked (revoke via Google account settings) redirects to `/signin?expired=1`.

**Implementation Note**: After Phase 1's automated checks pass, pause for manual verification of the happy path before starting Phase 2.

---

## Phase 2: Edge cases and robustness

### Overview

Make import survive bad inputs and incomplete data. Add the filename-collision numeric suffix so re-imports succeed cleanly. Add the filename fallback when `<dc:title>` is missing. Wrap the parser call in error handling so malformed or non-epub files surface clean inline errors. End state: nothing about the import flow can produce a silent failure or a confusing user-facing error.

### Changes Required:

#### 1. Collision-aware filename composition

**File**: `src/lib/drive/upload.ts`

**Intent**: Add a sibling function that, given a desired filename, returns a guaranteed-non-colliding variant within the folder.

**Contract**:
- `findAvailableFilename(drive: drive_v3.Drive, folderId: string, desired: string): Promise<string>` — returns `desired` if not present, else `desired` with ` (2)`, ` (3)`, ... inserted before the `.epub` extension until a free name is found.
- Implementation: query `drive.files.list({q: "'<folderId>' in parents and name = '<candidate>' and trashed=false", fields: 'files(id)'})`; if `files[0]` exists, increment counter and retry. Escape single quotes in the candidate string before interpolating into the Drive query (Drive query language escapes single quotes with `\'`).
- Hard upper bound at 100 retries — beyond that, throw an Error with a clear message. (Indicates either a programming bug or a runaway loop; user-visible message handled by the action.)

#### 2. Wire collision check into the action

**File**: `src/app/actions/import-epub.ts`

**Intent**: Call `findAvailableFilename` after composing the desired filename, before uploading.

**Contract**: Between step 6 (compose) and step 7 (upload) in the Phase 1 outline, insert `const finalName = await findAvailableFilename(drive, folderId, composedName);` and pass `finalName` to `uploadBookToDrive`.

#### 3. Missing-title fallback

**File**: `src/app/actions/import-epub.ts`

**Intent**: When `parseEpub` returns `title: null`, derive the title from the original filename (minus the `.epub` extension). Always produce a non-empty title.

**Contract**: In the action's step 4 → step 5 transition, after `parseEpub` returns: if `metadata.title` is null/empty, set `title` from `file.name.replace(/\.epub$/i, '').trim()`. If that's also empty, use the literal string `"Untitled"`. The derived title is what goes into both the DB row and the Drive filename. Author may remain null (sanitization will substitute `unknown` for the Drive filename's author segment).

#### 4. Malformed-epub and missing-author handling

**File**: `src/app/actions/import-epub.ts`

**Intent**: Catch `EpubParseError` from `parseEpub` and surface as a clean inline error. Don't upload to Drive. No DB write.

**Contract**: Wrap `parseEpub(buffer)` in try/catch. On `EpubParseError`, return `{ok: false, message: 'This file does not look like a valid epub.'}`. On any other error from the parser, re-throw (signals a bug worth crashing on).

#### 5. Top-level error envelope

**File**: `src/app/actions/import-epub.ts`

**Intent**: Anything that gets past the parser-catch but throws — Drive 4xx/5xx, DB insert failure (after rollback delete already ran), unexpected — surfaces as a single generic inline error without leaking stack details.

**Contract**: Wrap the body of the action (after the `auth()` check and FormData read) in a top-level try/catch. On `DriveAuthError`: keep the existing redirect path. On any other error: log via `console.error` (so Render logs capture it) and return `{ok: false, message: 'Import failed. Please try again.'}`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npm run build` succeeds.

#### Manual Verification:

- Importing the same epub twice in a row produces two `books` rows and two Drive files; the second file's name ends in ` (2).epub`.
- Importing it a third time produces a ` (3).epub`.
- Importing an epub whose OPF has no `<dc:title>` succeeds; the resulting title is the filename minus `.epub`; the Drive filename uses that derived title.
- Importing an epub with no `<dc:creator>` succeeds; the author is null in the DB; the Drive filename has `unknown` as the author segment.
- Importing a `.txt` file renamed to `.epub` (or any zip that isn't a valid epub) shows `"This file does not look like a valid epub."` inline; no Drive file is created; no `books` row is inserted.
- Importing a totally non-epub file (e.g., a `.pdf` renamed to `.epub`) produces the same clean inline error.
- Simulating a Drive failure (e.g., temporarily revoke the user's allow-list entry on the Drive side and reload) yields a generic inline error; no orphaned Drive file remains; no `books` row remains. (Hard to simulate exactly — substitute by temporarily breaking the `upload.ts` to throw mid-flight if needed; revert after.)

**Implementation Note**: After Phase 2's automated checks pass, pause for manual verification of each edge case above before declaring the slice done.

---

## Testing Strategy

No test framework is configured in this repo (CLAUDE.md: "No test framework is configured yet. Don't fabricate test commands"). Verification is `npm run lint`, `npm run build`, manual exercise of the dropzone, and DB/Drive inspection. If a test runner lands later, the natural seam is `src/lib/epub/parse.ts` (pure function, takes a Buffer, returns a structured result) — that's the highest-value unit-test target.

### Manual Testing Steps:

1. Sign in as the allow-listed Google account.
2. Drop a clean epub. Verify the inline success message names the right title and author.
3. Open Google Drive in a browser. Verify `Bookshelf/<author> — <title>.epub` exists.
4. Connect to the Postgres DB. Verify the `books` row's columns match the file's metadata.
5. Drop the same epub again. Verify the second Drive file has ` (2).epub` suffix and a second `books` row exists.
6. Drop a malformed file (e.g., a `.txt` with `.epub` extension). Verify the inline error appears and no Drive write or DB row happened.
7. Drop an epub with deliberately stripped metadata (use Sigil or Calibre to clear `<dc:title>`). Verify the title falls back to the filename.

## Performance Considerations

- **Memory**: the full file lives in memory between FormData read and Drive upload. At the 20MB body limit, this is acceptable for a single-user app on Render. If the user routinely imports multi-tens-of-MB epubs, revisit by switching to a route handler with streaming.
- **Library-folder cache**: one extra `files.list` per cold-start per email. Negligible. The cache is a `Map` keyed by email so future multi-user thinking doesn't require a rewrite.
- **Drive collision check (Phase 2)**: O(N) Drive calls where N = number of existing copies of the same desired name. Capped at 100; in practice N = 0 or 1 for an actual user. Acceptable.

## Migration Notes

No schema migrations in this slice — F-02 already shipped the full library schema. Production deploys of this slice run the existing migrations (no-op on a previously-migrated DB) and start serving.

A production deploy of Phase 1 will, for any existing signed-in session, NOT bootstrap a `users` row until the operator signs out and back in (the signIn callback only fires on actual sign-in). Manual verification step: clear cookies + sign in fresh after the first deploy. If the operator forgets, the first import will throw at the `getUserIdByEmail` SELECT — the top-level error catch (Phase 2) renders a generic failure; remedy is to sign out and back in.

## References

- Roadmap: `context/foundation/roadmap.md` (S-01)
- PRD: `context/foundation/prd.md` (US-01, FR-001, FR-002, FR-005)
- F-01 plan: `context/changes/drive-oauth-and-client/plan.md` (Drive client surface, scope, DriveAuthError)
- F-02 plan: `context/changes/library-data-schema/plan.md` (books / users schema, users-upsert handoff)
- Action pattern: `src/app/actions/check-drive.ts`
- Action consumer pattern: `src/app/components/check-drive-button.tsx`
- Drive client: `src/lib/drive/client.ts:7-19`
- Next 16 body-limit config: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Happy-path import end-to-end

#### Automated

- [x] 1.1 `npm install` succeeds; `package.json` lists `jszip` and `fast-xml-parser` under `dependencies`
- [x] 1.2 `npm run lint` passes with no new warnings or errors
- [x] 1.3 `npm run build` succeeds
- [x] 1.4 `npm run db:migrate` is a no-op and exits 0

#### Manual

- [ ] 1.5 After sign-in, `/` shows the dropzone with placeholder copy
- [ ] 1.6 Clicking the dropzone opens the OS file picker filtered to `.epub`
- [ ] 1.7 Picking a clean, well-formed epub triggers an upload and shows `Imported: <title> by <author>` inline
- [ ] 1.8 The `Bookshelf/` folder and the imported `.epub` (named `<author> — <title>.epub`) appear in Drive
- [ ] 1.9 A new `books` row exists in the DB with `title`, `author`, `isbn`, `cover_bytes`, `cover_mime`, `drive_file_id`, `user_id` populated and `trashed_at` null
- [ ] 1.10 A `users` row exists for the operator's email (created at sign-in)
- [ ] 1.11 A second sign-in creates no second `users` row
- [ ] 1.12 Dragging the same epub onto the dropzone (instead of clicking) also imports successfully
- [ ] 1.13 Importing while the refresh token is revoked redirects to `/signin?expired=1`

### Phase 2: Edge cases and robustness

#### Automated

- [x] 2.1 `npm run lint` passes
- [x] 2.2 `npm run build` succeeds

#### Manual

- [ ] 2.3 Importing the same epub twice produces two `books` rows; the second Drive file's name ends in ` (2).epub`
- [ ] 2.4 A third import of the same epub produces ` (3).epub`
- [ ] 2.5 An epub with no `<dc:title>` imports with the filename (minus `.epub`) as title
- [ ] 2.6 An epub with no `<dc:creator>` imports with author null in DB and `unknown` in the Drive filename author segment
- [ ] 2.7 A `.txt` file renamed to `.epub` produces the clean `"This file does not look like a valid epub."` inline error; no Drive write; no DB row
- [ ] 2.8 A `.pdf` renamed to `.epub` produces the same clean inline error
- [ ] 2.9 A simulated Drive failure produces a generic inline error; no orphaned Drive file; no DB row
