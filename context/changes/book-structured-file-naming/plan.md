# Dual-copy import with structured file naming and series/part metadata — Implementation Plan

## Overview

Today an imported epub is uploaded **once** to the `Bookshelf/` root folder, named `Author — Title.epub`, and is **never renamed** on Drive when its metadata later changes. This change:

1. Adds two metadata fields — **series** and **part** (both free text, nullable).
2. Imports each epub into **two** Drive locations: a renameable **working copy** in `Bookshelf/` root, and a **pristine copy** under a new `Bookshelf/Original files/` folder (kept under its original upload filename, never renamed).
3. Names the working copy with a **structured format**: `Author - Series - Part - Title.epub`, skipping empty segments, joined by `-` (ASCII hyphen, space-hyphen-space).
4. **Auto-renames the working copy** whenever author/series/part/title changes via the metadata-edit flow. When the Drive rename fails, the metadata edit still saves; a persisted `rename_pending` flag drives a warning banner + a retry button on the book page.

## Current State Analysis

- **Single upload at import**: `confirmReviewAction` (`src/app/actions/confirm-review.ts:57-71`) calls `composeFilename(author, title)` → `findAvailableFilename` → `uploadBookToDrive`, stores one `drive_file_id`. On error it deletes that one file (rollback).
- **`composeFilename(author, title)`** (`src/lib/drive/upload.ts:16-18`) → `"${sanitizeSegment(author)} — ${sanitizeSegment(title)}.epub"` (em-dash). `sanitizeSegment` (lines 5-14) strips `/\:*?"<>|`, collapses whitespace, trims dots, caps at 100 chars, falls back to `"unknown"`.
- **`composeFilename` has three callers**: import (`confirm-review.ts:60`), trash (`src/app/actions/books.ts:58`), restore (`src/app/actions/books.ts:178,196`). Any signature change ripples to all three.
- **Metadata edits never touch Drive**: `applyMetadataAction` (`src/app/actions/enrich-metadata.ts:54-100`) → `updateBookMetadata` (`src/lib/books.ts:239-273`), DB only.
- **Rename primitive exists**: `moveDriveFile` (`src/lib/drive/trash.ts:4-18`) uses `drive.files.update` with `addParents`/`removeParents` + optional `name`. A same-folder rename only needs `files.update({ fileId, requestBody: { name } })`.
- **Folder helper pattern exists**: `getOrCreateTrashFolder` (`src/lib/drive/library-folder.ts:39-69`) — find-or-create a named subfolder of the library folder, cached by parent id. `getOrCreateOriginalFilesFolder` mirrors it exactly.
- **Schema**: `books` table typed in `src/lib/db.ts:28-50`; migrations are sequential `NNNN_*.mts` with `up`/`down` (`src/lib/db/migrations/0004_book_metadata_fields.mts` is the reference for `alterTable…addColumn`). Latest is `0006`; next is `0007`.
- **Draft carries the original filename**: `book_drafts.filename` holds the user's uploaded filename (`src/lib/book-drafts.ts:45-77`), returned by `getDraftWithBook` as `draft.filename` — this is the source name for the pristine copy.
- **Edit UI**: `EnrichMetadataPanel` (`src/app/(app)/books/[id]/enrich-metadata-panel.tsx`) holds title/author/isbn/publisher/language/publishedDate/description + cover, builds a FormData in `handleApply`, calls `applyMetadataAction`, then `router.refresh()`.
- **Book page**: `src/app/(app)/books/[id]/page.tsx` renders metadata and passes `current` to the panel; `getOwnedBook` (`src/lib/books.ts:177-225`) feeds it.

## Desired End State

- Importing an epub creates two Drive files: `Bookshelf/<structured name>.epub` and `Bookshelf/Original files/<original upload name>.epub`. The book row stores both file ids plus the working copy's current Drive filename.
- Setting/changing series, part, author, or title from the edit panel renames the working copy on Drive to the new structured name. The pristine copy is untouched.
- If a rename fails, the metadata still saves; the book page shows a warning ("File name is out of date on Drive") with a **Retry rename** button that completes the rename.
- Trashing moves only the working copy into `Trash/` (unchanged behavior, but the name it carries reflects series/part).
- Existing books keep their current Drive names until their next metadata save, which renames them to the new format. No bulk rename, no original-copy backfill.

### Key Discoveries

- `composeFilename` is shared by import/trash/restore — change signature once, fix three callers (`confirm-review.ts:60`, `books.ts:58,178,196`).
- The rename-on-edit orchestration must live in the **action layer** (it needs the Drive client/auth); `src/lib/books.ts` is `server-only` DB code and must stay Drive-free.
- `moveDriveFile` already renames; a same-folder rename is a one-line `files.update` — add a small `renameDriveFile` helper rather than overloading `moveDriveFile` with a "same parent" case.
- `book_drafts.filename` (`src/lib/book-drafts.ts:55`) is the pristine copy's source name — no need to reconstruct it.

## What We're NOT Doing

- **No per-author/per-series subfolder nesting** for working copies — the only new folder is `Original files/`. Structure is encoded in the filename.
- **No backfill** of pristine copies for existing books (original bytes are not retained).
- **No bulk rename** of existing working copies on migrate — renames happen lazily on next edit.
- **No series/part inputs in the import/review flow** — they are edited only on the detail page; new imports start with null series/part.
- **No series/part in enrichment proposals** — these fields are manual-entry only.
- **No moving the pristine copy** on trash/restore — only the working copy moves.
- **No numeric/decimal validation** on part — it is free text ("1", "1.5", "II", "Book Two").
- **No change to the em-dash → hyphen styling of already-uploaded files** except as a side effect of a later edit.

## Implementation Approach

Build bottom-up: schema + the pure filename function first (with its callers fixed and unit-tested), then the dual-copy upload at import, then the rename-on-edit + retry orchestration with its store/Drive support, and finally the UI that exposes series/part and the rename warning. Each phase is independently verifiable; the DB is the source of truth and Drive operations are best-effort with explicit flags, mirroring the existing 404-tolerant trash/restore style.

## Critical Implementation Details

- **Rename orchestration ordering** (Phase 3): in `applyMetadataAction`, write metadata to the DB **first** (source of truth, always succeeds for an owned confirmed book), then attempt the Drive rename. On success persist the new `drive_file_name` and clear `rename_pending`; on failure set `rename_pending = true` and leave `drive_file_name` unchanged. Never block or revert the metadata save on a Drive failure.
- **Drive-free store layer**: keep all `drive.*` calls out of `src/lib/books.ts`. The store gets two new pure functions (`updateBookMetadata` extended with series/part; new `setWorkingCopyFilename`); the action layer owns the Drive client.
- **Dual-upload rollback** (Phase 2): track `workingFileId` and `originalFileId` separately; the existing catch block must delete whichever file ids already exist, not just one.

## Phase 1: Schema, types & filename core

### Overview

Add the new columns, extend the Kysely types, and replace the filename composer with the structured format — fixing all three callers so the build stays green.

### Changes Required:

#### 1. Migration

**File**: `src/lib/db/migrations/0007_book_structured_naming.mts` (new)

**Intent**: Add the five new columns to `books` so imports and edits can track series/part, both Drive copies, the working copy's current name, and the rename-sync flag.

**Contract**: `up` adds `series` text null, `part` text null, `drive_file_name` text null, `original_drive_file_id` text null, and `rename_pending` boolean NOT NULL default `false`. `down` drops them in reverse. Follow the `alterTable("books").addColumn(...)` style of `0004_book_metadata_fields.mts`.

#### 2. Kysely types

**File**: `src/lib/db.ts`

**Intent**: Reflect the new columns on `BooksTable`.

**Contract**: Add to `BooksTable` — `series: string | null`, `part: string | null`, `drive_file_name: string | null`, `original_drive_file_id: string | null`, `rename_pending: Generated<boolean>`.

#### 3. Filename composer

**File**: `src/lib/drive/upload.ts`

**Intent**: Replace the two-arg em-dash composer with a structured, skip-empty composer, and add a sanitizer for the pristine copy's original filename that preserves the `.epub` extension.

**Contract**:

- `composeFilename(fields: { author: string | null; series: string | null; part: string | null; title: string }): string` — sanitize each present (non-empty) field via `sanitizeSegment`, join the present ones in order author, series, part, title with `" - "`, append `.epub`. Title always present. Empty/null series and part are omitted (no dangling separators). Part is included whenever present, independent of series.
- `sanitizeOriginalFilename(filename: string): string` — split base/`.epub` ext (case-insensitive; default `.epub` if absent), run the base through the existing sanitize rules, re-append `.epub`.
- Keep `sanitizeSegment`, `findAvailableFilename`, `uploadBookToDrive` as-is.

#### 4. Fix callers

**Files**: `src/app/actions/confirm-review.ts`, `src/app/actions/books.ts`

**Intent**: Adapt the three `composeFilename` call sites to the object signature; trash/restore must pass series/part so the name they compute matches the structured working-copy name.

**Contract**: `confirm-review.ts:60` → `composeFilename({ author: author || null, series: null, part: null, title })`. In `books.ts`, add `series` and `part` to the `db.selectFrom("books").select([...])` lists in both `trashBookAction` and `restoreBookAction`, and update the `composeFilename(book.author, book.title)` calls (`:58`, `:178`, `:196`) to `composeFilename({ author: book.author, series: book.series, part: book.part, title: book.title })`.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly: `npm run db:migrate`
- [ ] Migration down/up replays cleanly: `npm run test:migrate-replay`
- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] `composeFilename` unit tests pass (`npm test`): no series/part → `Author - Title.epub`; series only → `Author - Dune Saga - Dune.epub`; part only → `Author - 2 - Title.epub`; both → `Author - Dune Saga - 2 - Dune.epub`; null author → `unknown - Title.epub`; illegal chars sanitized. `sanitizeOriginalFilename` preserves `.epub` and sanitizes the base.

#### Manual Verification:

- [ ] The `books` table shows the five new columns with expected nullability/defaults.

---

## Phase 2: Dual-copy import

### Overview

At import confirmation, upload the working copy (as today) plus a pristine copy into `Original files/`, persist both file ids and the working copy's name, and roll back both files if anything fails.

### Changes Required:

#### 1. Original Files folder helper

**File**: `src/lib/drive/library-folder.ts`

**Intent**: Find-or-create the `Original files` subfolder of the library folder, mirroring `getOrCreateTrashFolder`.

**Contract**: `getOrCreateOriginalFilesFolder(drive, libraryFolderId): Promise<string>` — same find-or-create + cache-by-`libraryFolderId` pattern, folder name `"Original files"`.

#### 2. Confirm-review dual upload + rollback

**File**: `src/app/actions/confirm-review.ts`

**Intent**: After uploading the working copy, upload the staged bytes again into `Original files/` under the sanitized original upload filename; on any failure delete whichever copies were created; pass the new tracking fields through to `confirmDraft`.

**Contract**: Within the existing `try`, after `uploadBookToDrive` (working copy → `workingFileId`, `finalName`): get the original-files folder, compute `sanitizeOriginalFilename(draft.filename)`, `findAvailableFilename` in that folder, `uploadBookToDrive` → `originalFileId`. Then call `confirmDraft` with new fields `driveFileName: finalName` and `originalDriveFileId: originalFileId`. The `catch` rollback must delete both `workingFileId` and `originalFileId` when set (currently deletes only `fileId`).

#### 3. confirmDraft persistence

**File**: `src/lib/book-drafts.ts`

**Intent**: Persist the working copy's Drive name and the pristine copy's file id at confirmation.

**Contract**: Extend `ConfirmDraftInput` with `driveFileName: string` and `originalDriveFileId: string`. In `confirmDraft`'s `updateTable("books").set({...})`, also set `drive_file_name: confirmed.driveFileName` and `original_drive_file_id: confirmed.originalDriveFileId`. (`rename_pending` defaults to false; series/part remain null from `createDraft`.)

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] Existing import/integration tests pass: `npm run test:integration`

#### Manual Verification:

- [ ] Importing an epub produces `Bookshelf/Author - Title.epub` AND `Bookshelf/Original files/<original name>.epub` on Drive.
- [ ] The book row has `drive_file_id`, `drive_file_name`, and `original_drive_file_id` populated; `rename_pending` is false.
- [ ] Simulating a failure of the second upload leaves no orphaned working copy on Drive and no confirmed book row.

---

## Phase 3: Rename-on-edit, retry & store wiring

### Overview

Extend the store with series/part and a name-setter, add a collision-aware Drive rename helper, and wire `applyMetadataAction` to rename the working copy after saving metadata — with a `retryRenameAction` for the failure path.

### Changes Required:

#### 1. Store: metadata + filename setter + reads

**File**: `src/lib/books.ts`

**Intent**: Persist series/part on metadata updates, add a dedicated setter for the working copy's name + sync flag, and expose the new fields to callers.

**Contract**:

- Extend `UpdateBookMetadataFields` with `series?: string | null` and `part?: string | null`; in `updateBookMetadata`, set `series`/`part` when present (same `"x" in fields` guard pattern).
- Add `setWorkingCopyFilename(bookId, userId, opts: { driveFileName?: string; renamePending: boolean }): Promise<void>` — updates `rename_pending` (and `drive_file_name` when provided) for the owned confirmed book.
- Add `series`, `part`, `drive_file_name`, `rename_pending`, `drive_file_id` to the selects + returned objects in `getOwnedBook` and `getConfirmedBook`; add `series`, `part`, `renamePending`, `driveFileName` to the `BookDetail` interface.

#### 2. Drive rename helper

**File**: `src/lib/drive/rename.ts` (new) — or append to `src/lib/drive/upload.ts`

**Intent**: Rename a file in place within its current folder, resolving collisions, returning the final name.

**Contract**: `renameWorkingCopy(drive, fileId, libraryFolderId, desiredName): Promise<string>` — `findAvailableFilename(drive, libraryFolderId, desiredName)` then `drive.files.update({ fileId, requestBody: { name: finalName } })`; return `finalName`. Let Drive errors propagate to the caller.

#### 3. applyMetadataAction rename orchestration

**File**: `src/app/actions/enrich-metadata.ts`

**Intent**: Read series/part from the form, save metadata first, then best-effort rename the working copy, updating the sync flag accordingly.

**Contract**: Parse `series`/`part` from FormData (empty → null); pass to `updateBookMetadata`. After a successful save: fetch the book's `drive_file_id` + `drive_file_name` (via `getOwnedBook` or a small select); compute `desired = composeFilename({author, series, part, title})`; if `drive_file_id` is set and `desired !== drive_file_name`, get the Drive client + library folder and call `renameWorkingCopy`; on success `setWorkingCopyFilename(…, { driveFileName: finalName, renamePending: false })`, on caught error `setWorkingCopyFilename(…, { renamePending: true })`. Extend the success state to optionally carry `{ ok: true; renameWarning?: boolean }`. `DriveAuthError` keeps its existing sign-out/redirect handling.

#### 4. retryRenameAction

**File**: `src/app/actions/books.ts` (new exported action)

**Intent**: Re-attempt the working-copy rename for a book whose `rename_pending` is true.

**Contract**: `retryRenameAction(bookId): Promise<{ ok: true } | { ok: false; message: string }>` — load the owned confirmed book (author/series/part/title/`drive_file_id`); compute desired name; `renameWorkingCopy`; on success `setWorkingCopyFilename(…, { driveFileName: finalName, renamePending: false })` + `revalidatePath(\`/books/${bookId}\`)`; on `DriveAuthError`do the existing sign-out/redirect; on other failure return`{ ok: false, message }`and leave`rename_pending` true.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] Unit/integration tests pass: `npm test` and `npm run test:integration`

#### Manual Verification:

- [ ] Editing author/series/part/title on the detail page renames the `Bookshelf/` working copy to the new structured name on Drive; the `Original files/` copy is unchanged.
- [ ] Editing a non-name field (e.g. description) does not rename the file.
- [ ] With Drive made to fail the rename, the metadata still saves and `rename_pending` becomes true.
- [ ] Retry succeeds once Drive is reachable and clears `rename_pending`.

---

## Phase 4: UI — series/part fields + rename warning/retry

### Overview

Expose series/part in the edit panel and detail view, and surface the rename-pending warning with a retry button.

### Changes Required:

#### 1. Edit panel fields

**File**: `src/app/(app)/books/[id]/enrich-metadata-panel.tsx`

**Intent**: Add Series and Part inputs (plain text, no AI proposal) and include them in the apply payload.

**Contract**: Extend the `current` prop with `series: string | null` and `part: string | null`; add `series`/`part` `useState` (seeded from `current`, reset in `handleEnrich`); render two `MetaField`s with `proposal={undefined}` (or plain inputs); `fd.set("series", series)` and `fd.set("part", part)` in `handleApply`.

#### 2. Detail page: render fields + rename warning

**File**: `src/app/(app)/books/[id]/page.tsx`

**Intent**: Show series/part with the other metadata, pass them into the panel's `current`, and render a warning banner + retry control when the working-copy name is out of sync.

**Contract**: Add `series`/`part` to the `EnrichMetadataPanel current` object. Display series/part near title/author when present. When `book.renamePending` and not trashed, render a warning banner ("File name on Drive is out of date") containing the new `RenameRetryControl`.

#### 3. Retry control

**File**: `src/app/(app)/books/[id]/rename-retry-control.tsx` (new)

**Intent**: Client component that invokes `retryRenameAction` and refreshes on success, mirroring `TrashBookControl`'s shape.

**Contract**: Props `{ bookId: string }`; a button using `useTransition` that calls `retryRenameAction(bookId)`, shows pending state, surfaces the error message on failure, and `router.refresh()` on success.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`
- [ ] Production build succeeds: `npm run build`

#### Manual Verification:

- [ ] Series and Part inputs appear in the edit panel; saving them persists and (per Phase 3) renames the working copy.
- [ ] Series/Part render on the book detail page when set.
- [ ] After a forced rename failure, the warning banner + Retry button appear; clicking Retry (with Drive reachable) clears the banner and the Drive file is renamed.

---

## Testing Strategy

### Unit Tests:

- `composeFilename`: all four field-presence combinations, null author fallback, illegal-char sanitization, part-without-series, separator is `-`.
- `sanitizeOriginalFilename`: preserves `.epub`, sanitizes base, handles missing/mixed-case extension.

### Integration Tests:

- Import flow creates two Drive files and a row with both ids + `drive_file_name` (mock Drive client as existing import tests do).
- Second-upload failure rolls back the working copy and creates no confirmed book.
- Metadata edit changing a name field renames the working copy; failure sets `rename_pending`; `retryRenameAction` clears it.

### Manual Testing Steps:

1. Import an epub → verify `Bookshelf/Author - Title.epub` and `Bookshelf/Original files/<original>.epub` on Drive.
2. On the detail page set Series + Part → verify the working copy is renamed to `Author - Series - Part - Title.epub`, original untouched.
3. Clear Series → verify the working copy renames back to `Author - Title.epub`.
4. Edit an existing (pre-change) book's title → verify its old `Author — Title.epub` becomes the new hyphen format.
5. Force a rename failure (revoke Drive / network) → verify the edit saves, the warning + Retry appear, and Retry works once Drive is back.
6. Trash the book → verify only the working copy moves to `Trash/` with the structured name; the original stays in `Original files/`.

## Performance Considerations

Import adds one extra Drive upload (the pristine copy) and at most one extra folder lookup (cached). Metadata edits add one collision check + one `files.update` only when a name field actually changed. No bulk operations.

## Migration Notes

`0007` is additive: all new columns are nullable except `rename_pending` (default `false`), so existing rows are valid immediately. Existing working copies keep their em-dash names until their next metadata save renames them; existing books have no pristine copy and none is created retroactively.

## References

- Filename composer & Drive helpers: `src/lib/drive/upload.ts`, `src/lib/drive/library-folder.ts`, `src/lib/drive/trash.ts`
- Import flow: `src/app/actions/confirm-review.ts`, `src/lib/book-drafts.ts`
- Edit flow: `src/app/actions/enrich-metadata.ts`, `src/lib/books.ts`, `src/app/(app)/books/[id]/enrich-metadata-panel.tsx`, `src/app/(app)/books/[id]/page.tsx`
- Trash/restore (shared `composeFilename`): `src/app/actions/books.ts`
- Migration reference: `src/lib/db/migrations/0004_book_metadata_fields.mts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, types & filename core

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:migrate` — aa9fe70
- [x] 1.2 Migration down/up replays cleanly: `npm run test:migrate-replay` — aa9fe70
- [x] 1.3 Type checking passes: `npx tsc --noEmit` — aa9fe70
- [x] 1.4 Linting passes: `npm run lint` — aa9fe70
- [x] 1.5 `composeFilename` + `sanitizeOriginalFilename` unit tests pass: `npm test` — aa9fe70

#### Manual

- [x] 1.6 `books` table shows the five new columns with expected nullability/defaults — aa9fe70

### Phase 2: Dual-copy import

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` — 231f43c
- [x] 2.2 Linting passes: `npm run lint` — 231f43c
- [x] 2.3 Existing import/integration tests pass: `npm run test:integration` — 231f43c

#### Manual

- [x] 2.4 Import produces both the working copy and the `Original files/` pristine copy on Drive — 231f43c
- [x] 2.5 Book row has `drive_file_id`, `drive_file_name`, `original_drive_file_id`; `rename_pending` false — 231f43c
- [x] 2.6 Forced second-upload failure leaves no orphaned working copy and no confirmed book row — 231f43c

### Phase 3: Rename-on-edit, retry & store wiring

#### Automated

- [x] 3.1 Type checking passes: `npx tsc --noEmit` — f44c218
- [x] 3.2 Linting passes: `npm run lint` — f44c218
- [x] 3.3 Unit/integration tests pass: `npm test` and `npm run test:integration` — f44c218

#### Manual

- [ ] 3.4 Editing author/series/part/title renames the working copy; original untouched
- [ ] 3.5 Editing a non-name field does not rename the file
- [ ] 3.6 Forced rename failure still saves metadata and sets `rename_pending` true
- [ ] 3.7 Retry succeeds and clears `rename_pending`

### Phase 4: UI — series/part fields + rename warning/retry

#### Automated

- [x] 4.1 Type checking passes: `npx tsc --noEmit`
- [x] 4.2 Linting passes: `npm run lint`
- [x] 4.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 4.4 Series/Part inputs appear in the edit panel and persist on save
- [ ] 4.5 Series/Part render on the detail page when set
- [ ] 4.6 Warning banner + Retry appear after a forced failure; Retry clears it and renames the Drive file
