# DB Backup to Google Drive Implementation Plan

## Overview

Add a daily automated backup of library data (books, tags, book_tags, notes) to a `Bookshelf/Backups/` folder in Google Drive. Backup runs on first page load of each day if data changed since the last successful backup. Failed backups surface a warning in Settings. Users can browse backup history in Settings and restore any backup via a wipe-and-replace flow with confirmation.

## Current State Analysis

- Settings page (`src/app/(app)/settings/page.tsx`) is a minimal server component with a single Configuration card — trivial to extend
- Google Drive folder/upload patterns are established in `src/lib/drive/` — lazy-create subfolder with module-level cache, `getDriveClient()` factory, `DriveAuthError` error class
- DB uses Kysely + PostgreSQL; 7 migration files under `src/lib/db/migrations/` with `0NNN_name.mts` naming; `db.ts` holds all table interfaces and the `Database` union
- **No scheduling infrastructure exists** — no cron, no background workers; the app is purely synchronous request/response
- App layout (`src/app/(app)/layout.tsx`) is a server component and is the right place to inject a fire-and-forget client trigger

### Key Discoveries:

- `books.cover_bytes: Buffer | null` — must be serialized as base64 in JSON export and converted back on restore
- `epub_metadata_snapshot: jsonb` — serializes naturally as JS object via pg/Kysely
- Delete order for restore: `book_tags` → `notes` → `books` → `tags` (FK constraints); insert order: `tags` → `books` → `book_tags` → `notes`
- `tags` has no `updated_at`; change detection uses `created_at` for tags and `added_at` for book_tags
- Migration uses `sql` from `kysely` for `gen_random_uuid()` and `NOW()` defaults — same pattern needed for new migration

## Desired End State

A `Bookshelf/Backups/` folder in Google Drive accumulates daily JSON snapshots (max 30). Settings page shows last backup time, last error if any, and a history list. User can click "Restore" on any history entry, confirm, and have their library replaced by that snapshot. "Back up now" button forces an immediate backup regardless of the 24h guard.

### Key Discoveries:

- All Drive folder operations must go through `getDriveClient()` to pick up the current session token
- Kysely's `db.transaction().execute(async (trx) => {...})` is the pattern for the wipe-and-replace restore
- The app layout is a server component; client-side fire-and-forget requires a small `"use client"` component added to its JSX

## What We're NOT Doing

- No backup of `auth_tokens`, `users`, or `book_drafts` tables (secrets, identity, transient state)
- No backup of the epub/kepub files themselves — those already live in Drive
- No encryption of the backup JSON (it's in the user's own Drive account)
- No incremental backup — every backup is a full snapshot
- No external cron / scheduled job — on-access trigger only
- No diff/preview before restore — wipe-and-replace with a single confirmation dialog
- No tag-rename/deletion change detection (tags lack `updated_at`; those changes get captured on the next daily run or via the daily window anyway)

## Implementation Approach

New `backups` DB table tracks each run (success or error) and stores the Drive file ID for restore. A pure-JS JSON export/import layer handles serialization without pg_dump. Auto-trigger fires from a `"use client"` component in the app layout after mount; the component calls a protected API route that runs the check and backup server-side. Settings page becomes async and surfaces the backup card. Restore is a server action with a client-side AlertDialog for confirmation.

## Critical Implementation Details

- **In-memory deduplication**: the trigger API route can be called from multiple browser tabs. Add a module-level `let _backupInProgress: Promise<void> | null` in `run-backup.ts` — if set, return early without starting a second run. Clear it on completion (success or error).
- **cover_bytes round-trip**: Kysely returns `cover_bytes` as a `Buffer` (node Buffer, not Uint8Array). Export with `.toString('base64')`; restore with `Buffer.from(str, 'base64')`. If `cover_bytes` is null, export as `null`.
- **Timestamp insertion**: Kysely/pg returns `Date` objects from DB; `JSON.stringify` converts them to ISO strings. On restore, insert them back as strings — Kysely's `ColumnType<Date, string | undefined, string>` pattern accepts strings on insert.
- **Kysely transaction scope**: `db.transaction().execute(async (trx) => {...})` — use `trx` for all queries inside, not the global `db` proxy.

---

## Phase 1: DB Migration — `backups` Table

### Overview

Add a `backups` table that tracks each backup run (successful or failed), storing the Drive file ID and name for restore lookups. Add the corresponding Kysely interface to `db.ts`.

### Changes Required:

#### 1. New migration

**File**: `src/lib/db/migrations/0008_backups.mts`

**Intent**: Create the `backups` table with all fields needed to list history and drive restore.

**Contract**: Table columns: `id` (uuid PK, gen_random_uuid()), `user_id` (uuid FK → users, cascade), `drive_file_id` (text, nullable — null on failure), `drive_file_name` (text, nullable), `backed_up_at` (timestamptz NOT NULL DEFAULT NOW()), `error` (text, nullable — null on success), `created_at` (timestamptz NOT NULL DEFAULT NOW()). Add index on `(user_id, backed_up_at)` for the history queries.

#### 2. Kysely interface

**File**: `src/lib/db.ts`

**Intent**: Register the new table so all backup queries are type-safe.

**Contract**: Add `BackupsTable` interface (matching the migration columns) and add `backups: BackupsTable` to the `Database` interface.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:migrate`
- Migration reverses cleanly: `npm run db:migrate:down` then `npm run db:migrate` again
- Type checking passes: `npx tsc --noEmit`

#### Manual Verification:

- `backups` table exists in DB with correct columns after migration

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Backup Library

### Overview

Implement the core backup logic: Drive folder creation, JSON export, JSON restore (wipe-and-replace in a transaction), and the `runBackup` / `runBackupIfNeeded` orchestrator with error recording and prune logic.

### Changes Required:

#### 1. Drive backup folder

**File**: `src/lib/drive/backup-folder.ts`

**Intent**: Lazily create `Bookshelf/Backups/` and cache the folder ID, matching the pattern of `getOrCreateTrashFolder`.

**Contract**: Export `getOrCreateBackupFolder(drive: drive_v3.Drive, libraryFolderId: string): Promise<string>`. Module-level `const backupFolderCache = new Map<string, string>()` keyed by `libraryFolderId`. Drive query: `'${libraryFolderId}' in parents and name='Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false`.

#### 2. JSON export

**File**: `src/lib/backup/export.ts`

**Intent**: Serialize the user's library tables into a self-contained JSON string for upload to Drive.

**Contract**: Export `exportLibraryToJSON(userId: string): Promise<string>`. Queries `books`, `tags`, `book_tags`, `notes` scoped to `user_id`. Output shape:

```json
{ "version": 1, "exported_at": "<ISO>", "books": [...], "tags": [...], "book_tags": [...], "notes": [...] }
```

`books[].cover_bytes` is the base64 string of the Buffer (or null). All other fields are plain values. `epub_metadata_snapshot` serializes as-is (already JSON-compatible object from pg).

#### 3. JSON restore

**File**: `src/lib/backup/restore.ts`

**Intent**: Parse a backup JSON string and replace the user's library in a single DB transaction.

**Contract**: Export `restoreLibraryFromJSON(userId: string, json: string): Promise<void>`. Parse JSON, validate `version === 1`. Inside `db.transaction().execute(async (trx) => {...})`: delete in FK order (`book_tags` → `notes` → `books` → `tags`, all scoped to `user_id` via subquery or join), then insert in FK order (`tags` → `books` → `book_tags` → `notes`). Convert `cover_bytes` from base64 string back to `Buffer` on insert. Throw a typed `BackupRestoreError` on version mismatch or structural parse failure.

#### 4. Backup orchestrator

**File**: `src/lib/backup/run-backup.ts`

**Intent**: Orchestrate a full backup run and record the result; provide a change-detection wrapper for the auto-trigger.

**Contract**:

Export `runBackup(userId: string, email: string): Promise<void>` — always runs:

1. Call `exportLibraryToJSON(userId)` → JSON string
2. Get Drive client via `getDriveClient()`; get library folder via `getOrCreateLibraryFolder(drive, email)`
3. Get/create backup folder via `getOrCreateBackupFolder(drive, libraryFolderId)`
4. Upload JSON as `backup-${UTC-timestamp}.json` (e.g. `backup-2026-06-22T143000Z.json`) using `drive.files.create()` with `mimeType: 'application/json'` and `Readable.from(Buffer.from(jsonStr))`
5. Insert success row into `backups` (`drive_file_id`, `drive_file_name`, `error: null`)
6. Prune: query all backup rows for user ordered by `backed_up_at DESC`; for each row beyond 30, call `drive.files.delete({ fileId })` then delete the DB row
7. Wrap steps 1-6 in try/catch; on error insert a failure row (`drive_file_id: null`, `error: e.message`) and return (do not rethrow)

Export `runBackupIfNeeded(userId: string, email: string): Promise<void>` — checks before running:

1. If a module-level `_backupInProgress` promise exists, return it (dedup concurrent calls)
2. Query last backup row for user (any status) ordered by `backed_up_at DESC`; if within 24h, return
3. Query last successful backup (`error IS NULL`); check if any library row has a newer timestamp (MAX of `books.updated_at`, `notes.updated_at`, `tags.created_at`, `book_tags.added_at`); if nothing is newer and a successful backup exists, return
4. Set `_backupInProgress = runBackup(userId, email)`, await it, then clear the reference

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- `npm run lint` passes

#### Manual Verification:

- Calling `runBackup(userId, email)` creates a `backup-*.json` file in `Bookshelf/Backups/` in Drive
- File is valid JSON with `version`, `exported_at`, `books`, `tags`, `book_tags`, `notes` keys
- A row appears in `backups` table with non-null `drive_file_id`
- `runBackupIfNeeded` is a no-op when called again within 24h (no new Drive file)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Auto-Trigger

### Overview

Add a fire-and-forget client component to the app layout that calls a protected API route after mount. The API route runs `runBackupIfNeeded` server-side without blocking the page render.

### Changes Required:

#### 1. Trigger API route

**File**: `src/app/api/backup/trigger/route.ts`

**Intent**: Provide an authenticated endpoint that runs the backup check server-side.

**Contract**: `export const runtime = 'nodejs'`. POST handler only. Auth check: `session = await auth()`, return `Response.json({ ok: false }, { status: 401 })` if missing. Resolve `userId` via `getUserIdByEmail(email)`. Call `await runBackupIfNeeded(userId, email)` — the function never throws. Return `Response.json({ ok: true }, { status: 200 })`. No cache headers (POST is uncached by default).

#### 2. BackupTrigger client component

**File**: `src/app/components/backup-trigger.tsx`

**Intent**: Fire-and-forget POST to the trigger route after the page mounts, once per client navigation.

**Contract**: `"use client"` component. Single `useEffect(() => { fetch('/api/backup/trigger', { method: 'POST', credentials: 'include' }).catch(() => {}) }, [])`. Returns `null` (renders nothing).

#### 3. Add trigger to app layout

**File**: `src/app/(app)/layout.tsx`

**Intent**: Mount `BackupTrigger` in every authenticated page so the daily check runs on first page load.

**Contract**: Import `BackupTrigger` and add `<BackupTrigger />` inside the layout JSX (e.g. as the last child of `SidebarInset`). No other changes to the layout.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- `npm run lint` passes

#### Manual Verification:

- Loading any app page triggers a POST to `/api/backup/trigger` (visible in browser Network tab)
- On first ever load (no prior backup), a backup file appears in Drive within ~30s
- Subsequent page loads within 24h do not create additional backup files

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Settings UI

### Overview

Make the settings page async, fetch backup state, and add a Backup card showing last run status, an error banner when the last backup failed, a "Back up now" button, and a list of recent backup history entries.

### Changes Required:

#### 1. Back-up-now server action

**File**: `src/app/actions/backup.ts`

**Intent**: Server action for the "Back up now" button that forces an immediate backup and refreshes the settings page.

**Contract**: Export `runBackupNowAction(): Promise<void>` (`"use server"`). Auth check via `auth()`; redirect to `/signin` if missing. Call `runBackup(userId, email)` (not the `IfNeeded` variant — force run). Call `revalidatePath('/settings')`. No return value needed (form action).

#### 2. Settings page with backup card

**File**: `src/app/(app)/settings/page.tsx`

**Intent**: Extend the settings page with a Backup section showing status, error state, and history.

**Contract**: Convert to `async` function. Call `auth()` and `getUserIdByEmail(email)` at the top. Query last 30 backup rows for the user ordered by `backed_up_at DESC`. Render a second Card below the existing Configuration card with:

- `CardTitle`: "Backups"
- `CardDescription`: "Daily snapshot of your library (books, tags, notes) saved to Google Drive."
- If `backups[0]?.error` is non-null: render an alert/warning callout inside the card showing the error message and the time it occurred
- Otherwise: show "Last backup: {relative time}" (or "No backups yet" if empty)
- A `<form action={runBackupNowAction}>` with a `<Button type="submit">Back up now</Button>`
- A history list: for each backup entry show timestamp, status icon (success/error), and a `RestoreButton` component (introduced in Phase 5)

For the initial implementation of the history list, render restore buttons as disabled placeholders (Phase 5 wires them up).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- `npm run lint` passes

#### Manual Verification:

- Settings page shows the Backup card with last backup time
- After a failed backup (simulate by disconnecting Drive temporarily), an error banner appears on next settings visit
- "Back up now" triggers a backup and the page refreshes with updated history
- History list shows correct timestamps and Drive file names

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Restore Flow

### Overview

Add the restore server action and a client-side confirmation dialog. Wiring up the "Restore" buttons in the history list makes the full backup cycle complete.

### Changes Required:

#### 1. Restore server action

**File**: `src/app/actions/backup.ts`

**Intent**: Download the selected backup file from Drive and restore the library in a wipe-and-replace transaction.

**Contract**: Export `restoreBackupAction(backupId: string): Promise<{ ok: false; message: string } | { ok: true }>` (`"use server"`). Auth check via `auth()`. Look up the backup row by `id` AND `user_id` (scoped to prevent cross-user access). If not found or `drive_file_id` is null, return `{ ok: false, message: "Backup not found." }`. Download JSON: `drive.files.get({ fileId: backup.drive_file_id, alt: 'media' }, { responseType: 'text' })` — the response body is the JSON string. Call `restoreLibraryFromJSON(userId, jsonStr)`. On success, call `revalidatePath('/')` and `revalidatePath('/settings')`, return `{ ok: true }`. Catch and return `{ ok: false, message: e.message }`.

#### 2. RestoreButton client component

**File**: `src/components/restore-button.tsx`

**Intent**: Client component that wraps a restore history entry in an AlertDialog for user confirmation before calling the restore action.

**Contract**: `"use client"`. Props: `backupId: string`, `backupDate: string` (formatted timestamp for display). Renders a `Button` that opens a shadcn `AlertDialog` confirming: "This will replace all books, tags, and notes with the backup from {backupDate}. Any changes since then will be lost." On confirm: call `restoreBackupAction(backupId)` via `useTransition`; on `ok: false` show an inline error message; on `ok: true` the page revalidates automatically.

#### 3. Wire restore buttons in settings

**File**: `src/app/(app)/settings/page.tsx`

**Intent**: Replace the placeholder restore buttons with the real `RestoreButton` component.

**Contract**: Import `RestoreButton`. For each backup history entry, render `<RestoreButton backupId={b.id} backupDate={formatDate(b.backed_up_at)} />` (disabled if `b.drive_file_id === null`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- `npm run lint` passes

#### Manual Verification:

- Clicking "Restore" on a backup entry opens the confirmation dialog
- Confirming restore replaces the library with the backup's data
- Books/notes/tags from before the backup date are removed; restored content is visible immediately
- Restore on a backup with a null `drive_file_id` (error row) is disabled
- A cross-user restore attempt (crafted `backupId`) is rejected

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `exportLibraryToJSON` — mock DB, verify cover_bytes is base64, verify structure matches schema
- `restoreLibraryFromJSON` — mock DB transaction, verify delete order, verify Buffer conversion
- Version mismatch in restore JSON → `BackupRestoreError` thrown

### Integration Tests:

- Full backup round-trip against the test DB: export → serialize → deserialize → restore → verify row counts match

### Manual Testing Steps:

1. Import a book with a cover image; trigger backup; open the Drive file and verify cover_bytes is present as base64
2. Add a note, tag a book, wait (or force via "Back up now"); verify new backup row appears in history
3. Delete all books; restore a backup; verify books, tags, notes are all back
4. Disconnect network/Drive token; load the app; verify error appears in Settings on next visit without crashing the page
5. Create 31+ backups (via repeated "Back up now"); verify only 30 remain in Drive and DB

## Migration Notes

No existing data migrations needed — the `backups` table starts empty; history accumulates from first run.

## References

- Drive folder pattern: `src/lib/drive/library-folder.ts`
- Server action pattern: `src/app/actions/books.ts`
- Kysely migration pattern: `src/lib/db/migrations/0002_library_schema.mts`
- DB interface: `src/lib/db.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB Migration — `backups` Table

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:migrate` — 2f26298
- [x] 1.2 Migration reverses cleanly: `npm run db:migrate:down` then `npm run db:migrate` again — 2f26298
- [x] 1.3 Type checking passes: `npx tsc --noEmit` — 2f26298

#### Manual

- [x] 1.4 `backups` table exists in DB with correct columns after migration — 2f26298

### Phase 2: Backup Library

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` — 5c36830
- [x] 2.2 `npm run lint` passes — 5c36830

#### Manual

- [x] 2.3 Calling `runBackup` creates a `backup-*.json` file in `Bookshelf/Backups/` in Drive — 5c36830
- [x] 2.4 File is valid JSON with `version`, `exported_at`, `books`, `tags`, `book_tags`, `notes` keys — 5c36830
- [x] 2.5 A row appears in `backups` table with non-null `drive_file_id` — 5c36830
- [x] 2.6 `runBackupIfNeeded` is a no-op when called again within 24h — 5c36830

### Phase 3: Auto-Trigger

#### Automated

- [x] 3.1 Type checking passes: `npx tsc --noEmit` — cf5a7c8
- [x] 3.2 `npm run lint` passes — cf5a7c8

#### Manual

- [x] 3.3 Loading any app page triggers a POST to `/api/backup/trigger` (Network tab) — cf5a7c8
- [x] 3.4 On first ever load, a backup file appears in Drive within ~30s — cf5a7c8
- [x] 3.5 Subsequent page loads within 24h do not create additional backup files — cf5a7c8

### Phase 4: Settings UI

#### Automated

- [x] 4.1 Type checking passes: `npx tsc --noEmit` — b2bc4c6
- [x] 4.2 `npm run lint` passes — b2bc4c6

#### Manual

- [x] 4.3 Settings page shows the Backup card with last backup time — b2bc4c6
- [x] 4.4 Error banner appears after a failed backup — b2bc4c6
- [x] 4.5 "Back up now" triggers a backup and the page refreshes with updated history — b2bc4c6
- [x] 4.6 History list shows correct timestamps and Drive file names — b2bc4c6

### Phase 5: Restore Flow

#### Automated

- [x] 5.1 Type checking passes: `npx tsc --noEmit`
- [x] 5.2 `npm run lint` passes

#### Manual

- [x] 5.3 "Restore" confirmation dialog appears before any action is taken
- [x] 5.4 Confirming restore replaces the library with the backup's data
- [x] 5.5 Restored content is visible immediately after confirmation
- [x] 5.6 Restore on an error row (null `drive_file_id`) is disabled
- [x] 5.7 Cross-user restore attempt is rejected
