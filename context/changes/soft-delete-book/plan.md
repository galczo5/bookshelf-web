# Soft-delete a book to a Drive trash directory — Implementation Plan

## Overview

Give the user a way to move a book out of their library without losing the file. From the single-book view, a "Move to trash" control opens a confirmation modal; on confirm, the epub moves from `Bookshelf/<author> — <title>.epub` into a lazy-created `Bookshelf/Trash/` subfolder in Drive, then the `books.trashed_at` column is set to `NOW()`. The book disappears from the library list (the existing `WHERE trashed_at IS NULL` filter already handles this). Restore (S-10) is a separate change.

## Current State Analysis

The schema is already there and the library queries already exclude trashed rows — this change is almost entirely about Drive coordination and a new UI control.

- `books.trashed_at TIMESTAMPTZ` exists (`src/lib/db.ts:27`; migration `src/lib/db/migrations/0002_library_schema.mts:29`). No schema change needed.
- `listConfirmedBooks` and `getConfirmedBook` already filter `WHERE trashed_at IS NULL` (`src/lib/books.ts:31, 80`). Trashing a book makes it disappear with zero query changes.
- Drive layout is flat: `Bookshelf/<sanitized-author> — <sanitized-title>.epub`. Composition + sanitization live in `src/lib/drive/upload.ts:5-15`. Collision handling for upload is `findAvailableFilename` (`src/lib/drive/upload.ts:17-36`).
- Drive client surface: `getDriveClient()` (`src/lib/drive/client.ts:7`), `getOrCreateLibraryFolder()` with module-level cache (`src/lib/drive/library-folder.ts:6-35`). Auth errors throw `DriveAuthError` (`src/lib/drive/errors.ts`).
- No file-move helper exists yet. Moves on Drive use `drive.files.update({ fileId, addParents, removeParents })`.
- Server actions live under `src/app/actions/`. Each action authenticates via `auth()` + `getUserIdByEmail()` (e.g., `src/app/actions/confirm-review.ts:63-64`).
- Drive + DB ordering precedent: `confirm-review.ts:101-133` does Drive first, then DB; on DB failure it calls `drive.files.delete()` to roll back.
- Transactional precedent for DB-only multi-step mutations: `src/lib/tags.ts:177-213` (rename-tag-globally's `renameOrMergeTag`) — pre-check, re-check inside `db.transaction().execute()`, abort on conflict.
- Dialog/modal pattern: `radix-ui`'s `Dialog` is already in use at `src/app/(app)/books/[id]/notes-section.tsx:140-172` (Root/Portal/Overlay/Content/Title/Close). The same primitive will be used here.
- UI components available: `Button`, `Alert` (with `variant="destructive"`), `Card`, `Sheet`. No reusable confirm-dialog component yet.
- No test framework configured (per `CLAUDE.md`). Verification is manual + typecheck + lint.

### Key Discoveries

- `trashed_at` is already in the schema and already filtered in queries — zero migration work.
- The Drive `confirm-review.ts:101-133` pattern (Drive first, DB second, Drive rollback on DB failure) is the established model for Drive+DB coordination and maps 1:1 onto this change.
- `radix-ui`'s `Dialog` is already used by `notes-section.tsx:140-172`; the trash confirm modal can reuse the same primitive and styling.
- The Drive `drive.file` OAuth scope means the app only sees files it created — so any `Bookshelf/Trash/` folder it manages is guaranteed isolated from the user's other Drive content.

## Desired End State

The user can open a confirmed book at `/books/[id]`, click "Move to trash", confirm in a modal, and:

- The epub file is moved from the `Bookshelf/` folder into `Bookshelf/Trash/` in Drive (lazy-created on first trash; name-collision-resolved via `findAvailableFilename`).
- `books.trashed_at` is set to the operation's timestamp.
- The user is redirected to `/`, where the book no longer appears.
- If the Drive move succeeds but the DB UPDATE fails, the Drive file is moved back to the library folder (rollback).
- If the Drive file is already gone (`drive_file_id` is null, or Drive returns 404), the DB flag still lands and a warning is logged server-side.
- Any other Drive error (auth, network, permission, 5xx) surfaces to the user; nothing in DB or Drive changes.

Verifiable by running `npm run dev`, importing a book, opening it, clicking Move to trash, confirming, observing the book disappears from `/`, and confirming the file is in `Bookshelf/Trash/` in Drive UI.

## What We're NOT Doing

- **No restore.** That's S-10. No `/trash` listing page, no restore button.
- **No permanent purge.** Files sit in `Bookshelf/Trash/` indefinitely until S-10 or a future purge change handles them.
- **No bulk-trash.** One book at a time.
- **No library-list overflow menu.** Trash is only reachable from the single-book view.
- **No trash for draft books.** Only `review_state = 'confirmed'` is in scope; the review queue handles its own rejections.
- **No schema migration.** `trashed_at` is already on the table.
- **No new toast / undo system.** The modal IS the safeguard.
- **No retry queue or background worker for Drive failures.** Failures surface synchronously to the user.

## Implementation Approach

Two phases. Phase 1 is internal plumbing — pure server-side helpers that can be reviewed in isolation. Phase 2 wires them to a server action and a single-book-view control with a radix Dialog confirmation.

The Drive+DB ordering is **Drive first, DB second, Drive rollback on DB failure** — same shape as `confirm-review.ts:101-133`. This keeps the library list as the source of truth for visibility (a row with `trashed_at IS NULL` always points to a file in the main library folder; a row with `trashed_at` set points to a file in `Bookshelf/Trash/` or, if the user manually deleted the file, nowhere — both are coherent states).

The trash folder is lazy-created on first use, cached in memory exactly like the library folder.

## Critical Implementation Details

- **Drive rollback is best-effort.** Phase 2's `trashBookAction` rolls the Drive move back if the DB UPDATE throws, but if the rollback move itself fails the book is in a stuck state (file in `Trash/`, DB says active). Log loudly; the user will see the original action's error and can retry. We do NOT attempt a second rollback.
- **`drive_file_id` may be null** on edge-case rows (race during import, manual DB intervention). Treat null `drive_file_id` the same as a Drive 404: skip the move, log a warning, proceed with the DB flag. Restore (S-10) will inherit the "no file" state.
- **Drive 404 vs other errors.** Classify by the `googleapis` error: `error.code === 404` (or `errors[0].reason === "notFound"`) → proceed DB-only with a warning; any other Drive error → fail the action without touching DB.
- **`getOrCreateTrashFolder` mirrors `getOrCreateLibraryFolder`** (`src/lib/drive/library-folder.ts`) but is parented to the library folder, not Drive root. The module-level cache key should include both `email` and `libraryFolderId` (or just `libraryFolderId` — it's unique per user).
- **The trash filename must be collision-resolved.** Two books can share the same `<author> — <title>.epub` name in `Bookshelf/Trash/` over time (trash, restore-with-rename later, trash again). Reuse `findAvailableFilename` against the trash folder before the move.

## Phase 1: Drive trash helpers + DB trash function

### Overview

Add the three pure server-side primitives this feature needs, with no UI or action wiring. Each helper is independently reviewable.

### Changes Required

#### 1. Trash folder lookup helper

**File**: `src/lib/drive/library-folder.ts` (extend existing module)

**Intent**: Add a function that returns the Drive folder ID for `Bookshelf/Trash/`, creating it on first use, with the same module-level cache pattern as `getOrCreateLibraryFolder`.

**Contract**: `getOrCreateTrashFolder(drive: drive_v3.Drive, libraryFolderId: string): Promise<string>`. Looks up a child folder named `Trash` parented to `libraryFolderId`; if absent, creates it; caches by `libraryFolderId`. Drive query mirrors the existing one (`mimeType='application/vnd.google-apps.folder' and trashed=false`), with `'<libraryFolderId>' in parents` added.

#### 2. File-move helper

**File**: `src/lib/drive/trash.ts` (new file)

**Intent**: Wrap the Drive move API into a named, testable helper. Used by `trashBookAction` for the forward move; the action calls it again with parents swapped to perform the rollback inline.

**Contract**: `moveDriveFile(drive: drive_v3.Drive, fileId: string, fromFolderId: string, toFolderId: string, name?: string): Promise<void>`. Calls `drive.files.update({ fileId, addParents: toFolderId, removeParents: fromFolderId, requestBody: name ? { name } : undefined, fields: 'id, parents' })`. The optional `name` argument supports the rare case where the trash folder already has a file with the same name (collision-resolved before this call). On Drive 404, throws an error whose `.code === 404` so callers can distinguish.

#### 3. DB trash function

**File**: `src/lib/books.ts`

**Intent**: Add a database-only function that flips `trashed_at` for a confirmed book scoped to a user, with ownership re-validated inside the update. Phase 2's server action will call this after the Drive move succeeds, inside a transaction wrapper that also performs the rollback compensation.

**Contract**: `trashConfirmedBook(bookId: string, userId: string, trx?: Kysely<Database> | Transaction<Database>): Promise<{ trashedAt: Date } | null>`. Uses `(trx ?? db).updateTable("books").set({ trashed_at: sql\`NOW()\` }).where("id", "=", bookId).where("user_id", "=", userId).where("review_state", "=", "confirmed").where("trashed_at", "is", null).returning("trashed_at").executeTakeFirst()`. Returns `null` if no row matched (book missing, not owned, not confirmed, or already trashed). The optional `trx` parameter lets the server action run this inside a transaction it controls.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification

- (None for Phase 1 — no user-facing surface yet. Helpers are exercised in Phase 2.)

**Implementation Note**: After completing this phase and all automated verification passes, proceed directly to Phase 2 — there is no manual verification for this phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes live in `## Progress`.

---

## Phase 2: Server action + book-detail trash control with confirm modal

### Overview

Wire Phase 1's helpers into a server action and a client component on `/books/[id]`. The component renders a "Move to trash" button; clicking it opens a radix Dialog confirmation; confirming calls the action which performs Drive-first / DB-second with Drive rollback on DB failure. On success the user is redirected to `/` (where the book is gone from the list); on Drive error the modal shows the error and stays open.

### Changes Required

#### 1. Server action

**File**: `src/app/actions/books.ts` (new file)

**Intent**: Orchestrate the trash operation: authenticate, fetch the book's `drive_file_id`, resolve library + trash folder IDs, collision-resolve the filename in the trash folder, perform the Drive move, then the DB flag, then on DB failure roll the Drive move back. Classify the no-file case (null `drive_file_id` or Drive 404) and proceed DB-only with a server-side warning log. Re-validate path `/` and the book detail page on success.

**Contract**: `trashBookAction(bookId: string): Promise<{ ok: true } | { ok: false; message: string }>`. Steps in order:

1. `const session = await auth();` — redirect to `/signin` if no email (matches existing actions).
2. `const userId = await getUserIdByEmail(session.user.email)`.
3. Fetch `drive_file_id, title, author` from `books` where `id = bookId AND user_id = userId AND review_state = 'confirmed' AND trashed_at IS NULL`. If not found: `{ ok: false, message: "Book not found." }`.
4. If `drive_file_id` is null: skip the Drive move, log warning, jump to step 8 (DB flag inside its own short transaction).
5. `const drive = await getDriveClient();` (let `DriveAuthError` bubble — Next.js will catch and the page redirects to signin via the existing pattern).
6. `const libraryFolderId = await getOrCreateLibraryFolder(drive, session.user.email);`
7. `const trashFolderId = await getOrCreateTrashFolder(drive, libraryFolderId);`
8. Compute desired name `composeFilename(author, title)`; resolve via `findAvailableFilename(drive, trashFolderId, desired)`.
9. `await moveDriveFile(drive, drive_file_id, libraryFolderId, trashFolderId, finalName)`. On 404: log warning, continue as no-file case. On any other error: return `{ ok: false, message: "Drive move failed: <reason>" }` with nothing changed in DB.
10. Call `trashConfirmedBook(bookId, userId)`; if it returns null OR throws, attempt `moveDriveFile(drive, drive_file_id, trashFolderId, libraryFolderId, originalName)` to roll back (best-effort; log any rollback failure loudly). Return `{ ok: false, message: "..." }`.
11. `revalidatePath("/")` and `revalidatePath(\`/books/\${bookId}\`)`.
12. Return `{ ok: true }`.

Note: step 8's `originalName` for rollback is the file's name at the start of step 9 — fetch it before the move (`drive.files.get({ fileId: drive_file_id, fields: 'name' })`) so a rename-on-collision in the trash folder doesn't strand the rollback.

#### 2. Trash control client component

**File**: `src/app/(app)/books/[id]/trash-book-control.tsx` (new file)

**Intent**: A small client component that renders a destructive-styled "Move to trash" button. Clicking opens a radix Dialog asking "Move <title> to trash? You can restore it later." with `Cancel` and `Move to trash` buttons. The confirm button calls the server action via `useTransition`; while pending, both buttons are disabled and the confirm button shows a loading state. On `{ ok: true }`, the modal closes and the page navigates to `/`. On `{ ok: false }`, the modal stays open and the error message renders inside the dialog using the existing `Alert` component (`variant="destructive"`).

**Contract**: Default export `TrashBookControl({ bookId, title }: { bookId: string; title: string })`. Uses `radix-ui`'s `Dialog` matching the structure already in `notes-section.tsx:140-172` (Root, Portal, Overlay with `fixed inset-0 z-40 bg-black/40`, Content centered with the same styling). Uses `useRouter().push("/")` for navigation on success.

#### 3. Mount the control on the book detail page

**File**: `src/app/(app)/books/[id]/page.tsx`

**Intent**: Render `TrashBookControl` on the book detail page. Place it below the existing notes section in a low-emphasis position (this is a destructive action, not a primary one) so it doesn't compete with read/tag/note actions.

**Contract**: Import `TrashBookControl` and render `<TrashBookControl bookId={book.id} title={book.title} />` in a new `<section>` after the notes section. No other changes to this file.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification

- Importing a book and then clicking "Move to trash" on its detail page, confirming in the modal, redirects to `/` and the book no longer appears in the library list.
- In Drive UI, the trashed epub is visible inside `Bookshelf/Trash/`; the original `Bookshelf/` no longer contains it.
- Clicking "Move to trash" then "Cancel" in the modal leaves the book intact (no DB change, no Drive change).
- Importing two books with the same author/title, trashing both — second one lands in `Trash/` with a `(2)` suffix (collision-resolution works inside the trash folder).
- Triggering an offline state (e.g., disabling network) during the modal confirm shows a "Drive move failed" message inside the modal and leaves both the library row and Drive file unchanged. After reconnecting, retrying the trash succeeds.
- Manually deleting a book's file from Drive UI (outside the app), then clicking "Move to trash" in the app, succeeds: the book disappears from the library, a server log records "drive_file_id present but Drive returned 404", DB shows `trashed_at` set.
- Trashed books do NOT appear in the library list, search results, or tag filters (already enforced by existing queries; verify it still holds after the change).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

No automated test framework is configured (per `CLAUDE.md`). Verification is:

- **Static**: `npm run lint` + `npx tsc --noEmit` + `npm run build`.
- **Manual** (Phase 2 only): the Manual Verification list above, exercised against `npm run dev` with a real Google Drive account.

If/when the `testing-harness-and-import-integrity` change lands, post-hoc unit tests for `getOrCreateTrashFolder`, `moveDriveFile`, and `trashConfirmedBook` would be cheap to add — they're pure functions with mockable boundaries.

## Performance Considerations

- The trash operation is single-book and synchronous from the user's perspective. Cost is one Drive `files.list` (filename collision in trash), one Drive `files.get` (read current name for rollback safety), one Drive `files.update` (move), one DB UPDATE, plus revalidation. Well under any interactive latency budget.
- `getOrCreateTrashFolder` caches like its sibling — subsequent trash operations in the same server process skip the lookup.
- Library list responsiveness (NFR: 2 s for 1000 books) is unchanged — the `trashed_at IS NULL` filter is already in place and indexable if it ever becomes hot.

## Migration Notes

None. The `trashed_at` column already exists with no default and no existing trashed rows. The first deploy of this feature simply enables the column to be written.

## References

- Roadmap entry: `context/foundation/roadmap.md` — S-09 `soft-delete-book`
- PRD: FR-006 (move to recoverable trash state), Success Criteria guardrail (app-independent library)
- Drive + DB rollback precedent: `src/app/actions/confirm-review.ts:101-133`
- Transaction pattern: `src/lib/tags.ts:177-213` (S-08 `rename-tag-globally`)
- Existing radix Dialog usage: `src/app/(app)/books/[id]/notes-section.tsx:140-172`
- Library queries that already filter trash: `src/lib/books.ts:31, 80`
- Drive client surface: `src/lib/drive/client.ts`, `src/lib/drive/library-folder.ts`, `src/lib/drive/upload.ts`, `src/lib/drive/errors.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Drive trash helpers + DB trash function

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit` — ba711d6
- [x] 1.2 Linting passes: `npm run lint` — ba711d6
- [x] 1.3 Build succeeds: `npm run build` — ba711d6

### Phase 2: Server action + book-detail trash control with confirm modal

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` — e76c91a
- [x] 2.2 Linting passes: `npm run lint` — e76c91a
- [x] 2.3 Build succeeds: `npm run build` — e76c91a

#### Manual

- [x] 2.4 Importing a book and then clicking "Move to trash" on its detail page, confirming in the modal, redirects to `/` and the book no longer appears in the library list.
- [x] 2.5 In Drive UI, the trashed epub is visible inside `Bookshelf/Trash/`; the original `Bookshelf/` no longer contains it.
- [x] 2.6 Clicking "Move to trash" then "Cancel" in the modal leaves the book intact (no DB change, no Drive change).
- [x] 2.7 Importing two books with the same author/title, trashing both — second one lands in `Trash/` with a `(2)` suffix.
- [x] 2.8 Triggering an offline state during the modal confirm shows a "Drive move failed" message and leaves both DB and Drive unchanged; retry after reconnect succeeds.
- [x] 2.9 Manually deleting a book's file from Drive UI then clicking "Move to trash" in the app: book disappears from library, server log records the 404, DB shows `trashed_at` set.
- [x] 2.10 Trashed books do NOT appear in the library list, search results, or tag filters.
