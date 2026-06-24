# Drive Sync Status Implementation Plan

## Overview

Add a Drive sync check that compares the `Bookshelf/` folder on Google Drive against confirmed DB books. Detects two issue types: untracked epubs (files on Drive with no DB record) and missing Drive files (confirmed books whose `drive_file_id` no longer exists in Drive). Results are cached in a new `drive_sync_checks` DB table and refreshed on library page load with a 24-hour cooldown. Users see a dismissible library-page banner when issues exist; full detail and actions (import, mark-as-broken) live in a new Settings card.

## Current State Analysis

The app stores working copies of books in `Bookshelf/` root on Drive, originals in `Bookshelf/Original files/`, and trashed files in `Bookshelf/Trash/`. Each confirmed book in the `books` table has a `drive_file_id` pointing to its working copy. The sync gap: nothing currently lists the Drive folder contents and cross-references with the DB. Users who manually add epubs to Drive, or whose Drive files are externally deleted, see no feedback.

Existing patterns to reuse:

- `BackupTrigger` client component pattern (`useEffect` → fetch) — extended here to include `router.refresh()` after the fetch resolves (`src/app/components/backup-trigger.tsx`)
- Backup 24h cooldown in `run-backup.ts` (module-level in-progress guard + DB timestamp check)
- `backups` table shape (user_id, timestamps, jsonb content) — paralleled by `drive_sync_checks`
- `getDriveClient()` + `getOrCreateLibraryFolder()` — reused directly (`src/lib/drive/client.ts`, `src/lib/drive/library-folder.ts`)

## Desired End State

When the user visits the library page:

1. A background trigger fires a Drive scan (skipped if last scan < 24h old)
2. When the scan completes, `router.refresh()` re-renders the server components from fresh DB state
3. If the scan finds issues, a dismissible banner appears with a count and a link to Settings
4. The Settings page has a "Drive Sync" card showing: last-checked time, a list of untracked Drive files (each with an Import button), and a list of books with missing Drive files (each with a Mark as broken button)
5. Clicking Import downloads the epub from Drive, creates a draft via the existing review flow, and the source Drive file is deleted on successful confirm
6. Clicking Mark as broken clears the `drive_file_id` on the book record, removing it from future sync warnings

### Key Discoveries

- `drive.files.list` with `q: "'<folderId>' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'"` returns only non-folder files directly in the specified folder — not recursive (`src/lib/drive/library-folder.ts:16-19`)
- `confirm-review.ts` uploads fresh bytes as working copy + original then deletes the draft — it never references a pre-existing Drive file (`src/app/actions/confirm-review.ts:63-120`). Adding `source_drive_file_id` to `book_drafts` and a post-confirm delete is the minimal extension point.
- `importFromDriveAction` mirrors `import-epub.ts` but downloads bytes via `drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })` instead of reading from FormData
- Settings page is an async server component that queries the DB directly — the new card follows the same pattern as the Backups card (`src/app/(app)/settings/page.tsx:42-55`)

## What We're NOT Doing

- Not scanning `Original files/`, `Trash/`, or `Backups/` subfolders — root Bookshelf folder only
- Not auto-resolving any sync issues — all actions are explicit user decisions
- Not paginating Drive results beyond 1000 files (Drive API default)
- Not adding automated tests in this change — test plan files will be updated separately
- Not detecting sync issues for trashed books (`trashed_at IS NOT NULL`)

## Implementation Approach

DB table stores scan results (avoids a Drive API call on every page load). Library page reads the cached result at render time — one cheap DB query alongside existing fetches. A client-side trigger fires in the background and calls `router.refresh()` when done, surfacing updated results without a manual reload. Server actions in Settings provide the actionable path. The confirm-review action is minimally extended to clean up imported source files.

## Critical Implementation Details

- **Source file orphan prevention**: when importing a Drive file, the user's `Bookshelf/` root retains the original file until confirm-review completes successfully. `source_drive_file_id` on `book_drafts` enables post-confirm cleanup (best-effort delete; non-fatal if it fails). The sync-check query must also exclude pending drafts' `source_drive_file_id` values from the untracked list, preventing false positives during the review window.
- **Kysely jsonb typing**: `DriveSyncFile[]` and `string[]` columns on `DriveSyncChecksTable` need `ColumnType<T, T, T>` — follow the `EnrichmentProposals` pattern in `BookDraftsTable` (`src/lib/db.ts:61-65`).
- **`getOrCreateLibraryFolder` takes email, not userId**: the folder cache is keyed by email. All scan functions that call it need to receive email (from session) alongside userId (for DB queries).

---

## Phase 1: DB Foundation

### Overview

Add the `drive_sync_checks` table and extend `book_drafts` with `source_drive_file_id`. Update Kysely types and add DB query helpers.

### Changes Required

#### 1. Migration 0009

**File**: `src/lib/db/migrations/0009_drive_sync_checks.mts`

**Intent**: Create `drive_sync_checks` table (stores scan results per user with a checked_at timestamp used for the 24h cooldown) and add `source_drive_file_id` to `book_drafts` (enables post-confirm cleanup of the source Drive file).

**Contract**: Up migration creates the table and index, down migration drops both:

```sql
-- up
CREATE TABLE drive_sync_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT NOW(),
  untracked_files jsonb NOT NULL DEFAULT '[]',
  missing_book_ids jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX drive_sync_checks_user_checked ON drive_sync_checks (user_id, checked_at DESC);
ALTER TABLE book_drafts ADD COLUMN source_drive_file_id text;

-- down
DROP TABLE drive_sync_checks;
ALTER TABLE book_drafts DROP COLUMN source_drive_file_id;
```

Follow the `.mts` migration file pattern from `0008_backups.mts` (Kysely `sql` template tag, explicit up/down exports).

#### 2. DB type definitions

**File**: `src/lib/db.ts`

**Intent**: Add `DriveSyncFile` export type, `DriveSyncChecksTable` interface, extend `BookDraftsTable` with `source_drive_file_id`, and register the new table in `Database`.

**Contract**:

```typescript
export interface DriveSyncFile {
  id: string;
  name: string;
}

export interface DriveSyncChecksTable {
  id: Generated<string>;
  user_id: string;
  checked_at: Generated<Date>;
  untracked_files: ColumnType<DriveSyncFile[], DriveSyncFile[], DriveSyncFile[]>;
  missing_book_ids: ColumnType<string[], string[], string[]>;
}
// BookDraftsTable gains: source_drive_file_id: string | null
// Database gains: drive_sync_checks: DriveSyncChecksTable
```

#### 3. DB query helpers

**File**: `src/lib/drive-sync-db.ts`

**Intent**: Isolated DB interface for the sync check feature — keeps scan logic and DB reads/writes out of each other.

**Contract**:

- `getLatestSyncCheck(userId: string)` — returns the most recent row for the user (`null` if none)
- `insertSyncCheckResult(userId: string, untrackedFiles: DriveSyncFile[], missingBookIds: string[])` — inserts a new row

#### 4. `book-drafts.ts` — surface source_drive_file_id

**File**: `src/lib/book-drafts.ts`

**Intent**: Extend `createDraft` to accept an optional `sourceDriveFileId` param and store it. Extend `getDraftWithBook` return type to include `sourceDriveFileId: string | null`.

**Contract**: `createDraft` signature gains `options?: { sourceDriveFileId?: string }`. `getDraftWithBook` selects `source_drive_file_id` from the `book_drafts` join and maps it to `sourceDriveFileId`.

### Success Criteria

#### Automated Verification

- Migration applies cleanly: `npm run db:migrate`
- Down migration applies cleanly: `npm run db:migrate:down`
- TypeScript compiles: `npm run build`

#### Manual Verification

- `drive_sync_checks` table exists in DB with correct columns and index
- `book_drafts` table has `source_drive_file_id` nullable column
- `getLatestSyncCheck` returns `null` for a user with no prior scan rows

**Implementation Note**: Pause here before proceeding to Phase 2.

---

## Phase 2: Drive Scan Logic + API Route

### Overview

Implement the core scan (list Drive root files, compare with DB, return issue lists), the 24h-cooldown orchestrator, and the API route the client trigger will call.

### Changes Required

#### 1. Drive scan function

**File**: `src/lib/drive/sync-check.ts`

**Intent**: Pure scan — takes a Drive client, email (for folder cache), and userId (for DB queries); lists non-folder files in the Bookshelf root; compares against confirmed books and excludes pending-draft source files; returns the two issue lists.

**Contract**:

```typescript
export type SyncCheckResult = { untrackedFiles: DriveSyncFile[]; missingBookIds: string[] };
export async function checkDriveSync(
  drive: drive_v3.Drive,
  email: string,
  userId: string
): Promise<SyncCheckResult>;
```

Drive query: `q: "'${libraryFolderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'"`, `fields: 'files(id,name)'`, `pageSize: 1000`.

DB queries needed:

- Confirmed non-trashed books with non-null `drive_file_id` (for both comparison sets)
- Pending drafts' `source_drive_file_id` values (to exclude from untracked list)

#### 2. Run-sync-check orchestrator

**File**: `src/lib/drive/run-sync-check.ts`

**Intent**: Two exported functions sharing the same underlying logic — the 24h-cooldown variant (used by the auto-trigger) and the force variant (used by the "Refresh now" action). A module-level in-progress guard (`Promise | null`) prevents concurrent scans — mirrors `run-backup.ts`.

**Contract**:

- `runSyncCheckIfStale(userId: string, email: string): Promise<SyncCheckResult>` — checks `getLatestSyncCheck`, returns cached result if `checked_at` is within 24h; otherwise scans and inserts
- `runSyncCheckNow(userId: string, email: string): Promise<SyncCheckResult>` — always scans and inserts (used for forced refresh)

#### 3. API trigger route

**File**: `src/app/api/drive-sync/trigger/route.ts`

**Intent**: POST endpoint for the client trigger. Authenticates, resolves userId, calls `runSyncCheckIfStale`. Handles `DriveAuthError` with a 401 response (not a redirect — the client fetch can't follow server-side redirects meaningfully).

**Contract**: `POST /api/drive-sync/trigger` → `200 { ok: true }` or `401 { ok: false }` on Drive auth failure. Follow `src/app/api/backup/trigger/route.ts` as the structural template.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- `POST /api/drive-sync/trigger` returns `{ ok: true }` with valid Drive credentials
- After the trigger, a row appears in `drive_sync_checks` with a current `checked_at`
- Untracked files list contains the file IDs and names of any epubs manually placed in the Bookshelf Drive root
- Missing book IDs list contains IDs of confirmed DB books whose `drive_file_id` no longer exists in Drive
- Second trigger within 24h returns `{ ok: true }` without inserting a new row
- Trigger with expired Drive credentials returns `401`

**Implementation Note**: Pause here before proceeding to Phase 3.

---

## Phase 3: Library Page Integration

### Overview

Add the auto-trigger client component (fires on mount, calls `router.refresh()` on completion) and the dismissible banner component. Wire both into the library page server component alongside the existing book-fetching calls.

### Changes Required

#### 1. DriveSyncTrigger client component

**File**: `src/app/components/drive-sync-trigger.tsx`

**Intent**: Fires a POST to `/api/drive-sync/trigger` on mount and calls `router.refresh()` when done so the server-rendered page re-reads the now-updated DB without a manual reload. The key difference from `BackupTrigger` is the `.then(() => router.refresh())` chain.

**Contract**: `"use client"`. Uses `useEffect` + `useRouter`. Returns `null`. Fire-and-forget (errors caught and ignored).

#### 2. DriveSyncBanner client component

**File**: `src/app/components/drive-sync-banner.tsx`

**Intent**: Dismissible warning banner for the library page. Shows a count of total issues and a link to `/settings`. Renders nothing when both counts are zero. Uses the existing `Alert` component.

**Contract**: `"use client"`. Props: `{ untrackedCount: number; missingCount: number }`. Dismiss state via `useState<boolean>`. Renders `null` when dismissed or when both counts are 0.

#### 3. Library page — sync check query + components

**File**: `src/app/(app)/page.tsx`

**Intent**: Fetch the latest sync check result (one cheap DB query) alongside the existing `listConfirmedBooks` and `listUserTags` calls. Pass issue counts to `DriveSyncBanner`. Render `DriveSyncTrigger` unconditionally.

**Contract**: Add `getLatestSyncCheck(userId)` call (can run in parallel with existing fetches via `Promise.all`). Derive counts from the result (default to 0 if null). Render `<DriveSyncTrigger />` and `<DriveSyncBanner untrackedCount={...} missingCount={...} />` in the JSX.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- Library page loads without error when no sync check exists yet (null result)
- After page load, the trigger fires (a row appears in `drive_sync_checks`)
- After `router.refresh()` resolves, the banner appears if issues exist
- Banner shows a correct count and links to `/settings`
- Dismiss button hides the banner; it reappears on next hard reload if issues persist
- No banner when both counts are 0

**Implementation Note**: Pause here before proceeding to Phase 4.

---

## Phase 4: Settings Drive Sync Card + Server Actions

### Overview

Add three server actions (force rescan, import from Drive, mark as broken) and a Drive Sync card in the Settings page that surfaces the cached scan results with actionable controls per item.

### Changes Required

#### 1. Server actions

**File**: `src/app/actions/drive-sync.ts`

**Intent**: Three `"use server"` actions covering all user-initiated operations in the Settings Drive Sync card.

- `runSyncCheckNowAction()` — gets session + userId, calls `runSyncCheckNow(userId, email)`, calls `revalidatePath("/settings")`.
- `importFromDriveAction(formData: FormData)` — gets `fileId` and `fileName` from form; gets Drive client; downloads bytes via `drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })`; converts to `Buffer`; calls `parseEpub(buffer)` (same function as `import-epub.ts`); calls `createDraft(..., { sourceDriveFileId: fileId })`; calls `redirect(\`/review/${bookId}\`)`. Handle `DriveAuthError` by signing out.
- `markDriveFileMissingAction(formData: FormData)` — gets `bookId` from form; verifies the book belongs to the current user; sets `drive_file_id = null` and `drive_file_name = null` on the book record; calls `revalidatePath("/settings")`.

#### 2. Settings page — Drive Sync card

**File**: `src/app/(app)/settings/page.tsx`

**Intent**: Add a Drive Sync card (after the Backups card) showing last-check time, untracked files with Import buttons, missing books with Mark as broken buttons, and a Refresh now button.

**Contract**:

- Fetch `getLatestSyncCheck(userId)` alongside the existing backups query (wrap in try/catch — not fatal).
- If missing book IDs exist, fetch titles: `db.selectFrom("books").select(["id", "title"]).where("id", "in", missingBookIds).execute()`.
- Card header: "Drive Sync"; description: last-checked time via `formatRelativeTime` (reuse existing helper) or "Not yet scanned".
- "Refresh now": `<form action={runSyncCheckNowAction}><button>Refresh now</button></form>`.
- Each untracked file row: filename + `<form action={importFromDriveAction}><input name="fileId" value={file.id} hidden /><input name="fileName" value={file.name} hidden /><button>Import</button></form>`.
- Each missing book row: book title + `<form action={markDriveFileMissingAction}><input name="bookId" value={book.id} hidden /><button>Mark as broken</button></form>`.
- When both lists are empty: "No sync issues detected."

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- Settings page renders the Drive Sync card without error
- "Refresh now" triggers a fresh scan and updates the card content
- An untracked Drive file appears by filename with an Import button
- Clicking Import redirects to `/review/[id]` with epub metadata pre-filled
- A book with a missing Drive file appears by title with a Mark as broken button
- Clicking Mark as broken clears its `drive_file_id`; book disappears from the list on refresh
- After resolving all issues, card shows "No sync issues detected."
- Expired Drive credentials: Import action handles `DriveAuthError` and redirects to sign-in

**Implementation Note**: Pause here before proceeding to Phase 5.

---

## Phase 5: Confirm-Review Source File Cleanup

### Overview

Extend `confirm-review.ts` to delete the source Drive file after a successful import-from-Drive confirmation. This prevents the originally untracked file from re-appearing in subsequent sync checks.

### Changes Required

#### 1. Confirm-review — post-confirm source file deletion

**File**: `src/app/actions/confirm-review.ts`

**Intent**: After `confirmDraft` succeeds, if the draft had a `source_drive_file_id`, delete that file from Drive root. Best-effort: log on failure, do not propagate the error to the user.

**Contract**: After the `confirmDraft(...)` call succeeds (still inside the try block, before the final `redirect("/")`):

```typescript
if (draft.sourceDriveFileId) {
  try {
    await drive.files.delete({ fileId: draft.sourceDriveFileId });
  } catch (e) {
    console.error("Could not delete source Drive file after import:", e);
  }
}
```

The existing rollback block (catch) must NOT attempt to delete `sourceDriveFileId` — leave the source file intact if the confirm itself failed so the user can retry.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- Confirm a book imported via the Settings Drive Sync card
- Verify the original Drive file is gone from `Bookshelf/` root in Google Drive
- Trigger a fresh sync check — confirm the file no longer appears as untracked
- End-to-end: manually add epub to Bookshelf Drive folder → library page banner appears → navigate to Settings → Import → review → confirm → Drive file cleaned up → banner gone on next page load

---

## Testing Strategy

### Manual Testing Steps

1. Manually add an epub file to the Google Drive `Bookshelf/` root folder (outside the app)
2. Load the library page — verify trigger fires and `router.refresh()` follows; banner appears with untracked count
3. Click the Settings link in the banner; verify Drive Sync card lists the file by name
4. Click "Import" — verify redirect to `/review/[id]` with epub metadata pre-filled
5. Confirm the review — verify the book appears in the library and the source Drive file is deleted
6. Trigger sync check via "Refresh now" — verify no untracked files remain
7. Manually delete a confirmed book's Drive file via Google Drive UI
8. Click "Refresh now" in Settings — verify the book appears in the missing-files list
9. Click "Mark as broken" — verify `drive_file_id` is null in DB; book disappears from missing list

## Migration Notes

Migration `0009` is additive only — no data backfill needed. `source_drive_file_id` is nullable with no default (null for all existing draft rows). `drive_sync_checks` starts empty; the first library page load populates it.

## References

- Related change (import flow): `context/changes/epub-import-to-drive/`
- Related change (backup pattern): `context/changes/db-backup/`
- Drive folder listing: `src/lib/drive/library-folder.ts`
- Existing trigger pattern: `src/app/components/backup-trigger.tsx`
- Import flow entry point: `src/app/actions/import-epub.ts`
- Confirm-review (extension point): `src/app/actions/confirm-review.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB Foundation

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:migrate` — 4a712b9
- [x] 1.2 Down migration applies cleanly: `npm run db:migrate:down` — 4a712b9
- [x] 1.3 TypeScript compiles: `npm run build` — 4a712b9

#### Manual

- [ ] 1.4 `drive_sync_checks` table exists in DB with correct columns and index
- [ ] 1.5 `book_drafts` table has `source_drive_file_id` nullable column
- [ ] 1.6 `getLatestSyncCheck` returns `null` for a user with no prior scan rows

### Phase 2: Drive Scan Logic + API Route

#### Automated

- [x] 2.1 TypeScript compiles: `npm run build` — 7339d4c
- [x] 2.2 Lint passes: `npm run lint` — 7339d4c

#### Manual

- [ ] 2.3 `POST /api/drive-sync/trigger` returns `{ ok: true }` with valid Drive credentials
- [ ] 2.4 After the trigger, a row appears in `drive_sync_checks` with a current `checked_at`
- [ ] 2.5 Untracked files list contains epubs manually placed in the Bookshelf Drive root
- [ ] 2.6 Missing book IDs list contains IDs of confirmed DB books whose Drive file is gone
- [ ] 2.7 Second trigger within 24h returns without inserting a new row
- [ ] 2.8 Trigger with expired Drive credentials returns `401`

### Phase 3: Library Page Integration

#### Automated

- [x] 3.1 TypeScript compiles: `npm run build` — aad22bc
- [x] 3.2 Lint passes: `npm run lint` — aad22bc

#### Manual

- [ ] 3.3 Library page loads without error when no sync check exists yet
- [ ] 3.4 After page load, the trigger fires and a new `drive_sync_checks` row appears
- [ ] 3.5 After `router.refresh()` resolves, banner appears if issues exist
- [ ] 3.6 Banner shows a correct issue count and links to `/settings`
- [ ] 3.7 Dismiss button hides the banner; it reappears on next hard reload if issues persist
- [ ] 3.8 No banner when both counts are 0

### Phase 4: Settings Drive Sync Card + Server Actions

#### Automated

- [x] 4.1 TypeScript compiles: `npm run build` — 470a8ad
- [x] 4.2 Lint passes: `npm run lint` — 470a8ad

#### Manual

- [ ] 4.3 Settings page renders the Drive Sync card without error
- [ ] 4.4 "Refresh now" triggers a fresh scan and updates the card content
- [ ] 4.5 Untracked Drive file appears by filename with an Import button
- [ ] 4.6 Clicking Import redirects to `/review/[id]` with epub metadata pre-filled
- [ ] 4.7 Missing book appears by title with a Mark as broken button
- [ ] 4.8 Mark as broken clears `drive_file_id`; book disappears from list on refresh
- [ ] 4.9 After resolving all issues, card shows "No sync issues detected."
- [ ] 4.10 Expired Drive credentials: Import action handles `DriveAuthError` gracefully

### Phase 5: Confirm-Review Source File Cleanup

#### Automated

- [x] 5.1 TypeScript compiles: `npm run build` — 9baecb2
- [x] 5.2 Lint passes: `npm run lint` — 9baecb2

#### Manual

- [ ] 5.3 Confirming a Drive-imported book deletes the source file from Drive root
- [ ] 5.4 Fresh sync check after confirm shows no untracked files
- [ ] 5.5 Full end-to-end: add epub to Drive → banner → import via Settings → confirm → file cleaned up → banner gone
