# Restore a trashed book — Implementation Plan

## Overview

Build the inverse of S-09 (soft-delete): give the user a place to see the books they've trashed, and a control to restore any of them. From a new `/trash` route the user clicks "Restore" on a row; a confirmation modal (mirroring the trash flow) confirms; on confirm the file moves from `Bookshelf/Trash/` back to `Bookshelf/` and `books.trashed_at` is set to `NULL`. The book reappears in the library. The single-book detail view becomes state-aware: visiting `/books/[id]` for a trashed book renders a read-only variant (only "Restore" is actionable). Drive coordination uses the established Drive-first → DB-second → roll back on DB failure pattern.

## Current State Analysis

S-09 (soft-delete-book) just landed — the Drive plumbing this change needs is already in place. What's missing is the symmetric DB query, the symmetric server action, and the UI surface where trashed books are reachable.

- `books.trashed_at TIMESTAMPTZ` exists (`src/lib/db.ts:27`; migration `src/lib/db/migrations/0002_library_schema.mts:29`). No schema change.
- `listConfirmedBooks` and `getConfirmedBook` already filter `trashed_at IS NULL` (`src/lib/books.ts:31, 80`). Today no query returns trashed rows.
- `trashConfirmedBook` exists (`src/lib/books.ts:104-121`) — its inverse must be added.
- Drive helpers all exist and are direction-agnostic: `moveDriveFile` (`src/lib/drive/trash.ts:4`), `getOrCreateLibraryFolder` (`src/lib/drive/library-folder.ts:8`), `getOrCreateTrashFolder` (`src/lib/drive/library-folder.ts:39`).
- `composeFilename` + `findAvailableFilename` work against any folder (`src/lib/drive/upload.ts:13, 17`).
- Server-action pattern lives in `src/app/actions/books.ts` — `trashBookAction` (`src/app/actions/books.ts:19-138`) is the structural template; restore is a near-mirror with the parent IDs swapped.
- The book detail page `src/app/(app)/books/[id]/page.tsx` calls `getConfirmedBook` (`page.tsx:5, 26`). A trashed book URL today returns `notFound()` via that filter.
- `getConfirmedBook` is also called from `src/app/actions/tag-suggestions.ts:31` — that path must continue to filter trashed books out (tag suggestions for an archived book are meaningless).
- Sidebar nav has Library + Tags only (`src/app/components/app-sidebar.tsx:19-22`). The `Trash2` icon is available from `lucide-react`.
- `radix-ui`'s `Dialog` confirm-modal pattern is in use in `src/app/(app)/books/[id]/trash-book-control.tsx:52-88` — `RestoreBookControl` will mirror it.
- Notes-section read-only rendering already exists internally: `NoteReader` at `src/app/(app)/books/[id]/notes-section.tsx:17-29` uses `useEditor({ editable: false })` with the TipTap + Markdown stack. It is not currently exported.
- No test framework. Verification is manual + `npm run lint` + `npx tsc --noEmit` + `npm run build`, same as S-09.

### Key Discoveries

- The Drive + DB rollback contract is fully established in `trashBookAction:108-133` — restore reuses the same scaffolding with `fromFolderId` and `toFolderId` swapped.
- `getOrCreateLibraryFolder` is idempotent and lazy — if the user deleted `Bookshelf/` in Drive between trash and restore, it will be recreated (this is the S-10 risk flagged in `context/foundation/roadmap.md`).
- Filename collisions in the library folder on restore are real: the user can import a new book with the same author/title while another is in trash. Reuse `findAvailableFilename` against the library folder before moving.
- `getConfirmedBook` has exactly two callers (`/books/[id]/page.tsx` and `tag-suggestions.ts`). The detail page must switch to a non-filtering variant; tag suggestions must keep filtering. → add a new `getOwnedBook` rather than altering `getConfirmedBook`.
- `BookDetail` does not currently expose `trashed_at`. The detail page needs the field to branch its rendering — extend the type for the new function.
- `NoteReader` already exists and works; promoting it from an internal helper to an exported component avoids duplicating the TipTap + Markdown read-only setup in the trashed-book branch.

## Desired End State

- A new sidebar entry "Trash" routes to `/trash`. The page lists every confirmed book with `trashed_at IS NOT NULL`, ordered by `trashed_at DESC`. Each row shows cover, title, author, when-trashed, and a "Restore" button.
- Clicking "Restore" opens a modal asking "Restore <title>?". Confirming runs `restoreBookAction(bookId)`. On success the modal closes, the row vanishes from `/trash` (which also revalidates `/`), and the book reappears at `/`. On Drive error the modal stays open with an inline `Alert`.
- Visiting `/trash` with no trashed books shows an empty-state message ("No books in trash.").
- Visiting `/books/[id]` for a trashed book renders a read-only detail view: cover, title, author, ISBN, tags (as static chips), and notes (rendered via `NoteReader`) are all visible. `TagPicker`, `SuggestionsPanel`, the notes editor, and `TrashBookControl` are not rendered. A small low-emphasis banner near the top reads "This book is in trash" and links back to `/trash`. The bottom-of-page action slot renders `RestoreBookControl` instead of `TrashBookControl`.
- Drive failure modes mirror trash:
  - Drive 404 (file already gone from `Bookshelf/Trash/`) → proceed DB-only, log warning, succeed.
  - Drive move fails for other reasons → nothing in DB or Drive changes; error surfaces to the user.
  - DB UPDATE fails after Drive succeeds → best-effort Drive rollback (move file back to `Trash/` with its original name); error surfaces to the user.
- `books.trashed_at` is set to `NULL` only when both the Drive move (or its 404 fallback) and the DB UPDATE complete.

Verifiable by running `npm run dev`, trashing a book from `/books/[id]`, navigating to `/trash`, clicking Restore, confirming the modal, and watching the book reappear at `/` while disappearing from `/trash` and from `Bookshelf/Trash/` in Drive.

## What We're NOT Doing

- **No permanent purge / "empty trash" mechanism.** Out of scope; books accumulate in `Bookshelf/Trash/` until a future purge change.
- **No bulk restore.** One book at a time. FR-007 is singular.
- **No search / filter / tag controls on the `/trash` page.** Flat list ordered by trash date.
- **No editing inside the read-only detail variant.** Tags, notes, and suggestions are all view-only; the only mutating control is "Restore".
- **No URL canonicalization or `?trashed=1` query param.** A trashed book stays at `/books/[id]`; the page branches internally on `book.trashedAt`.
- **No banner-only top affordance for restore.** The Restore button lives at the bottom of the detail page (symmetric with `TrashBookControl`); the top banner is informational, not interactive.
- **No tag-suggestions or other side-effects on restore.** Restore is a pure inverse of trash — tag rows and notes rows are untouched (they were untouched on trash too).
- **No schema migration.** `trashed_at` is already nullable.
- **No automated tests.** No test harness in the repo; verification is static + manual.

## Implementation Approach

Two phases.

**Phase 1** lands all backend pieces — three small DB functions and the server action — with no UI wiring. Each piece is independently reviewable; the action exercises every backend dependency end-to-end in a real Drive call once the UI lands in Phase 2.

**Phase 2** wires the action to UI: a new `/trash` route, a sidebar link, a `RestoreBookControl` modal, and the read-only branching on `/books/[id]`. Mounting the action in Phase 2 (not Phase 1) means a half-merged Phase 1 cannot inadvertently expose restore through the UI.

The Drive coordination mirrors `trashBookAction` exactly with the parent IDs swapped: read the current name in Drive (for rollback safety), collision-resolve the target name in the library folder, move file Trash → Library, set `trashed_at = NULL`. On DB failure, attempt to move it back to Trash/ with its original name. The `findAvailableFilename` call protects against the realistic case where the user imported a new book with the same author/title while another was in trash.

## Critical Implementation Details

- **`getOrCreateLibraryFolder` is idempotent.** If the user deleted `Bookshelf/` in Drive between trash and restore, the helper will recreate it on first call. The restored file then lands in a fresh library folder. No special-case handling needed in the action.
- **Filename collision on restore.** Reuse `findAvailableFilename(drive, libraryFolderId, composeFilename(author, title))` before the move; the restored file may land with a `(2)` suffix if a name-clashing book was imported while it was in trash. This is the same shape `trashBookAction` uses for `Trash/`.
- **`getConfirmedBook` has two callers — only the detail page changes.** Add `getOwnedBook(bookId, userId)` as a new function rather than relaxing `getConfirmedBook`. `tag-suggestions.ts` must keep filtering trashed books out (suggesting tags for an archived book is meaningless).
- **`BookDetail` gains `trashedAt: Date | null`.** Both `getConfirmedBook` (always returns `null`) and `getOwnedBook` (may return a date) populate it. The detail page branches on this field.
- **`drive_file_id` may be null** (edge case from import races). Treat null the same way `trashBookAction` does: skip the Drive move, log a warning, proceed DB-only.
- **Drive rollback is best-effort.** If `restoreTrashedBook` throws and the rollback move also fails, the file ends up in `Bookshelf/` and the DB row still has `trashed_at` set. Log loudly; the user retries from `/trash`.
- **Revalidation set.** On successful restore, revalidate `/`, `/trash`, AND `/books/${bookId}`. The detail page changes from read-only to editable; the library list gains a row; the trash list loses one.

## Phase 1: Backend primitives + restore server action

### Overview

Add three DB functions and one server action. Pure server-side; no UI wiring yet.

### Changes Required

#### 1. `BookDetail.trashedAt` field

**File**: `src/lib/books.ts`

**Intent**: Add `trashedAt` to the `BookDetail` interface so the detail page can branch on the field returned from `getOwnedBook` (added below). `getConfirmedBook` continues to filter out trashed rows and returns `trashedAt: null`.

**Contract**: `interface BookDetail extends BookSummary { isbn: string | null; coverMime: string | null; trashedAt: Date | null }`. Update `getConfirmedBook`'s return shape to include `trashedAt: null` (the column is filtered to null by the WHERE clause, so the literal is fine).

#### 2. `listTrashedBooks` — list trashed books for the trash page

**File**: `src/lib/books.ts`

**Intent**: Mirror `listConfirmedBooks` but for the trash surface — return confirmed books whose `trashed_at IS NOT NULL`, ordered by `trashed_at DESC`. Include `trashedAt` on each row so the trash page can render relative timestamps.

**Contract**: `listTrashedBooks(userId: string): Promise<TrashedBookSummary[]>` where `TrashedBookSummary` extends `BookSummary` with `trashedAt: Date`. Query is structurally identical to `listConfirmedBooks` except (a) `where("trashed_at", "is not", null)` instead of `where("trashed_at", "is", null)`, (b) `orderBy("trashed_at", "desc")` instead of `orderBy("created_at", "desc")`, and (c) the trashed_at column is selected and surfaced. Tag fetch via `book_tags` join behaves the same way (trashed books keep their tag rows; we still show them as static chips on the detail view).

#### 3. `getOwnedBook` — fetch a book regardless of trashed state

**File**: `src/lib/books.ts`

**Intent**: A variant of `getConfirmedBook` that does NOT filter `trashed_at`. Used by the detail page so it can show a read-only view for trashed books. Still scoped to `user_id` and `review_state = 'confirmed'` — drafts and other users' books must never leak through.

**Contract**: `getOwnedBook(bookId: string, userId: string): Promise<BookDetail | null>`. Query mirrors `getConfirmedBook` line-for-line except the `where("trashed_at", "is", null)` clause is dropped, and the `trashed_at` column is selected and surfaced as `trashedAt` on the return value.

#### 4. `restoreTrashedBook` — DB-only restore function

**File**: `src/lib/books.ts`

**Intent**: The inverse of `trashConfirmedBook`. Clears `trashed_at` for a confirmed, owned, currently-trashed book. Optional transaction handle so the server action can call it inside a wrapper that handles Drive rollback. Returns `null` if no row matched (book missing, not owned, not confirmed, or not currently trashed) so the action can detect the "race lost" case and roll back the Drive move.

**Contract**: `restoreTrashedBook(bookId: string, userId: string, trx?: Kysely<Database>): Promise<{ restored: true } | null>`. Uses `(trx ?? db).updateTable("books").set({ trashed_at: null }).where("id", "=", bookId).where("user_id", "=", userId).where("review_state", "=", "confirmed").where("trashed_at", "is not", null).returning("id").executeTakeFirst()`. Return `null` when no row matched; otherwise `{ restored: true }`.

#### 5. `restoreBookAction` — server action

**File**: `src/app/actions/books.ts` (extend existing module)

**Intent**: Orchestrate the restore operation: authenticate, fetch the book's `drive_file_id` + `title` + `author` + `trashed_at`, resolve trash + library folder IDs, collision-resolve the target filename in the library folder, move the file Trash → Library, then clear `trashed_at`. On DB failure, roll the Drive move back to `Trash/`. Treat null `drive_file_id` and Drive 404 as DB-only paths with a warning log. Revalidate `/`, `/trash`, and `/books/${bookId}`.

**Contract**: `restoreBookAction(bookId: string): Promise<{ ok: true } | { ok: false; message: string }>`. Steps in order, mirroring `trashBookAction:22-137` with the move direction reversed:

1. `const session = await auth();` — `redirect("/signin")` if no email.
2. `const userId = await getUserIdByEmail(session.user.email);`
3. Fetch `drive_file_id, title, author` from `books` where `id = bookId AND user_id = userId AND review_state = 'confirmed' AND trashed_at IS NOT NULL`. If not found: `{ ok: false, message: "Book is not in trash." }`.
4. If `drive_file_id` is null: warn-log, call `restoreTrashedBook(bookId, userId)`, revalidate paths, return `{ ok: true }` (or `{ ok: false }` if the DB function returned `null`).
5. `const drive = await getDriveClient();` — `DriveAuthError` handling mirrors `trashBookAction:50-59` exactly (sign out + redirect to `/signin?expired=1`).
6. `const libraryFolderId = await getOrCreateLibraryFolder(drive, session.user.email);`
7. `const trashFolderId = await getOrCreateTrashFolder(drive, libraryFolderId);`
8. `const nameRes = await drive.files.get({ fileId: drive_file_id, fields: "name" });` — on 404, warn-log and short-circuit to the DB-only path (step 4). On any other error, return `{ ok: false, message: "Drive file lookup failed: <reason>" }`. Capture `originalName` for rollback safety.
9. `const desired = composeFilename(book.author, book.title);` then `const finalName = await findAvailableFilename(drive, libraryFolderId, desired);` — handles collisions in the library folder.
10. `await moveDriveFile(drive, drive_file_id, trashFolderId, libraryFolderId, finalName);` — on 404, warn-log and short-circuit to the DB-only path. On any other error, return `{ ok: false, message: "Drive move failed: <reason>" }`.
11. Call `restoreTrashedBook(bookId, userId)`. On `null` return or thrown error, attempt `moveDriveFile(drive, drive_file_id, libraryFolderId, trashFolderId, originalName)` to roll back; log any rollback failure but do not retry. Return `{ ok: false, message: "Could not restore book. Please try again." }`.
12. `revalidatePath("/")`, `revalidatePath("/trash")`, `revalidatePath(\`/books/\${bookId}\`)`.
13. Return `{ ok: true }`.

Notes for the implementer:
- Steps 8–11 follow the structural template at `src/app/actions/books.ts:70-133` (the `originalName` read + try/finally rollback). The diff is mechanical: swap `libraryFolderId` ↔ `trashFolderId` for `moveDriveFile`'s `fromFolderId`/`toFolderId` arguments, and swap `trashConfirmedBook` for `restoreTrashedBook`.
- Use the same `console.warn` / `console.error` message shape as `trashBookAction` for grep-ability.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification

- (None for Phase 1 — no user-facing surface yet. The action is exercised end-to-end in Phase 2.)

**Implementation Note**: After completing this phase and all automated verification passes, proceed directly to Phase 2 — there is no manual verification for this phase.

---

## Phase 2: Trash page, sidebar link, restore control, read-only detail variant

### Overview

Wire Phase 1 into the UI. Three coordinated surfaces:
1. A new `/trash` route lists trashed books with restore controls.
2. The sidebar gains a "Trash" link.
3. `/books/[id]` switches from `getConfirmedBook` to `getOwnedBook` and renders a read-only variant when `book.trashedAt` is set.

### Changes Required

#### 1. Restore control client component

**File**: `src/app/(app)/trash/restore-book-control.tsx` (new file)

**Intent**: Mirror `trash-book-control.tsx`. Renders a small "Restore" button; clicking opens a radix `Dialog` asking "Restore <title>?". Confirming calls `restoreBookAction` via `useTransition`; while pending, both buttons are disabled and the confirm button shows a loading state. On `{ ok: true }` the modal closes and `router.refresh()` is called (the trash row vanishes via the revalidation in Phase 1 step 12). On `{ ok: false }`, the modal stays open and the error renders inside the dialog via the existing `Alert` component.

**Contract**: Default export `RestoreBookControl({ bookId, title }: { bookId: string; title: string })`. Uses the same `Dialog.Root / Portal / Overlay / Content` structure as `trash-book-control.tsx:52-88` but with a non-destructive blue confirm button instead of the red destructive one (this is an undo action, not a destructive one). The trigger is a small text button styled consistently with the row's other affordances.

#### 2. Trash page (server component)

**File**: `src/app/(app)/trash/page.tsx` (new file)

**Intent**: Server-render the list of trashed books. Auth, resolve `userId`, call `listTrashedBooks(userId)`, render a list (one row per book). Each row shows cover thumbnail (from `/api/books/${id}/cover`), title (linking to `/books/${id}`), author, when-trashed (formatted as a short date or relative-time string), and a `RestoreBookControl`. Empty state when `books.length === 0`: "No books in trash."

**Contract**: `export default async function TrashPage()` returning a `<main>` block mirroring the structure of `src/app/(app)/page.tsx:28-50` (max-width container, header section, content section). Layout: simple vertical list (not grid) — emphasizes archive-shaped surface, not browsing. Each row renders cover at the same 14×10 dimensions used by the list-variant `BookCard`, then a column of (title, author, trashed-at), then the `RestoreBookControl` aligned to the right. Cover img tag uses the same `next/image-eslint-disabled` pattern as `page.tsx:43-46` for consistency.

Trashed-at display: prefer the absolute date (`book.trashedAt.toLocaleDateString()`) in small zinc text — a relative-time string would require either a client component or a date library; absolute is fine for v1.

#### 3. Sidebar link

**File**: `src/app/components/app-sidebar.tsx`

**Intent**: Add a third `navItems` entry pointing at `/trash` using the `Trash2` icon from `lucide-react`.

**Contract**: Append `{ href: "/trash", label: "Trash", icon: Trash2 }` to the `navItems` array (`src/app/components/app-sidebar.tsx:19-22`). Add `Trash2` to the `lucide-react` import. No other changes to this file.

#### 4. Read-only detail variant on `/books/[id]`

**File**: `src/app/(app)/books/[id]/page.tsx`

**Intent**: Switch the data fetch from `getConfirmedBook` to `getOwnedBook` so trashed books are reachable. Branch the render based on `book.trashedAt`. In the trashed branch: render a low-emphasis banner near the top ("This book is in trash" + "Back to trash" link), render cover + title + author + ISBN as today, render tags as static chips (not via `TagPicker`), render notes via the read-only `NoteReader`, and replace `TrashBookControl` in the bottom slot with `RestoreBookControl`. In the confirmed branch: render exactly as today.

**Contract**: Top of file — swap import `getConfirmedBook` → `getOwnedBook`. Update destructuring to expect `trashedAt` on `book`. After `if (!book) notFound();`, branch:

```
const isTrashed = book.trashedAt != null;
```

Then in JSX, gate `<TagPicker>` + `<SuggestionsPanel>` + `<NotesSection>` behind `!isTrashed`, and render a read-only mirror when `isTrashed`. In the trashed branch, the existing notes/tags are needed in read-only form — see #5 below for the helper that lists notes.

The bottom-section slot conditionally renders `<TrashBookControl bookId={book.id} title={book.title} />` when not trashed and `<RestoreBookControl bookId={book.id} title={book.title} />` when trashed.

Tags-as-static-chips: render `book.tags.map(t => <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{t.name}</span>)` — same chip styling as `book-card.tsx:188-194`.

Top banner: a single `<div>` with a yellow-or-zinc tint and a small `Link href="/trash"` styled like the existing "← Library" link at the top of the detail page (`page.tsx:35-37`).

#### 5. Promote `NoteReader` for reuse in the read-only branch

**File**: `src/app/(app)/books/[id]/notes-section.tsx`

**Intent**: Export `NoteReader` (currently an internal helper at lines 17-29) so the trashed branch of the detail page can render notes read-only without duplicating the TipTap + Markdown setup.

**Contract**: Change `function NoteReader(...)` to `export function NoteReader(...)` — no other change to the file. The trashed branch in `page.tsx` imports `NoteReader` from `./notes-section` and maps over `notes`, rendering each in a static block ordered the same way `NotesSection` orders them today (which the implementer will confirm by reading `NotesSection`'s effective render order — likely `notes` as fetched by `listBookNotes`).

#### 6. Refactor `getConfirmedBook` to surface `trashedAt: null`

**File**: `src/lib/books.ts`

**Intent**: Match the new `BookDetail` shape. `getConfirmedBook` always returns `trashedAt: null` because of its existing WHERE clause; explicitly setting the literal keeps types consistent without a runtime cost.

**Contract**: In the return statement of `getConfirmedBook` (currently `src/lib/books.ts:92-101`), add `trashedAt: null` to the returned object. No query change.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification

- Trashing a book (via the S-09 flow on `/books/[id]`) and then visiting `/trash` shows the book in the list, with cover, title, author, and a date.
- Clicking "Restore" on a trash row opens the modal; confirming restores the book — it disappears from `/trash`, reappears at `/`, and the file is back in `Bookshelf/` in Drive (no longer in `Bookshelf/Trash/`).
- The modal's Cancel button leaves the book in trash; no DB change, no Drive change.
- Visiting `/books/[id]` for a trashed book renders the read-only variant: tags appear as static chips, notes are visible but not editable, the suggestions panel is gone, the "This book is in trash" banner is visible, and the bottom-of-page button reads "Restore" instead of "Move to trash".
- Visiting `/books/[id]` for a confirmed book renders exactly as before (tag picker editable, notes editable, suggestions panel present, "Move to trash" button at the bottom).
- Importing a new book with the same author/title as a trashed one, then restoring the trashed one — the restored file lands in `Bookshelf/` with a `(2)` suffix; the library list shows both books distinctly.
- Triggering offline state during the restore-modal confirm shows a "Drive move failed" message inside the modal; the book stays in trash, Drive state unchanged. After reconnecting, retrying restore succeeds.
- Manually deleting the trashed file from Drive UI (outside the app), then clicking Restore in the app: the book leaves `/trash`, reappears at `/`, server log records the 404, DB row has `trashed_at = NULL`.
- The sidebar "Trash" link is visible on every authenticated route and routes correctly to `/trash`.
- With no trashed books, `/trash` shows the empty-state message.
- The trash list orders books with the most-recently-trashed at the top.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

No automated test framework is configured (per `CLAUDE.md`). Verification is:

- **Static**: `npm run lint` + `npx tsc --noEmit` + `npm run build`.
- **Manual** (Phase 2): the Manual Verification list above, exercised against `npm run dev` with a real Google Drive account.

If/when `testing-harness-and-import-integrity` lands, post-hoc unit tests for `listTrashedBooks`, `getOwnedBook`, `restoreTrashedBook`, and a happy-path mock for `restoreBookAction` would be cheap to add — all four are pure functions or have mockable boundaries.

## Performance Considerations

- The restore operation is single-book and synchronous from the user's perspective. Cost is one Drive `files.get` (read original name), one `files.list` (collision check in library folder), one `files.update` (move), one DB UPDATE, plus revalidation. Well under any interactive latency budget.
- `/trash` page does one query (`listTrashedBooks`) + one tag join. Same query shape as `listConfirmedBooks`; bounded by trash count, which is small for the single-user persona.
- `getOwnedBook` is the same cost as `getConfirmedBook` (no extra WHERE).
- Folder caches in `library-folder.ts:4, 6` continue to short-circuit repeat trash/restore operations within a single server process.

## Migration Notes

None. `trashed_at` already exists, is already nullable, and existing rows already have it set to either `NULL` (confirmed library) or a timestamp (already-trashed during S-09 verification). The first deploy of this feature simply enables the column to be written back to `NULL`.

## References

- Predecessor change: `context/changes/soft-delete-book/plan.md` (S-09) — the structural template for this change.
- Predecessor brief: `context/changes/soft-delete-book/plan-brief.md`
- Predecessor implementation review: `context/changes/soft-delete-book/reviews/impl-review.md`
- Roadmap entry: `context/foundation/roadmap.md` — S-10 `restore-trashed-book`
- PRD: FR-007 (restore a previously trashed book), Success Criteria guardrail (app-independent library)
- Drive + DB rollback precedent: `src/app/actions/books.ts:19-138` (`trashBookAction`)
- Drive helpers: `src/lib/drive/library-folder.ts`, `src/lib/drive/trash.ts`, `src/lib/drive/upload.ts`, `src/lib/drive/errors.ts`
- DB trash inverse: `src/lib/books.ts:104-121` (`trashConfirmedBook`)
- Library queries that filter trash: `src/lib/books.ts:31, 80`
- Sidebar nav: `src/app/components/app-sidebar.tsx:19-22`
- Existing radix Dialog usage: `src/app/(app)/books/[id]/trash-book-control.tsx:52-88`, `src/app/(app)/books/[id]/notes-section.tsx:140-172`
- Existing read-only TipTap helper: `src/app/(app)/books/[id]/notes-section.tsx:17-29` (`NoteReader`)
- Tag-suggestions caller of `getConfirmedBook` (must keep filtering trashed): `src/app/actions/tag-suggestions.ts:31`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend primitives + restore server action

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Build succeeds: `npm run build`

### Phase 2: Trash page, sidebar link, restore control, read-only detail variant

#### Automated

- [ ] 2.1 Type checking passes: `npx tsc --noEmit`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Build succeeds: `npm run build`

#### Manual

- [ ] 2.4 Trashing a book (via the S-09 flow on `/books/[id]`) and then visiting `/trash` shows the book in the list, with cover, title, author, and a date.
- [ ] 2.5 Clicking "Restore" on a trash row opens the modal; confirming restores the book — it disappears from `/trash`, reappears at `/`, and the file is back in `Bookshelf/` in Drive (no longer in `Bookshelf/Trash/`).
- [ ] 2.6 The modal's Cancel button leaves the book in trash; no DB change, no Drive change.
- [ ] 2.7 Visiting `/books/[id]` for a trashed book renders the read-only variant: tags appear as static chips, notes are visible but not editable, the suggestions panel is gone, the "This book is in trash" banner is visible, and the bottom-of-page button reads "Restore" instead of "Move to trash".
- [ ] 2.8 Visiting `/books/[id]` for a confirmed book renders exactly as before (tag picker editable, notes editable, suggestions panel present, "Move to trash" button at the bottom).
- [ ] 2.9 Importing a new book with the same author/title as a trashed one, then restoring the trashed one — the restored file lands in `Bookshelf/` with a `(2)` suffix; the library list shows both books distinctly.
- [ ] 2.10 Triggering offline state during the restore-modal confirm shows a "Drive move failed" message inside the modal; the book stays in trash, Drive state unchanged. After reconnecting, retrying restore succeeds.
- [ ] 2.11 Manually deleting the trashed file from Drive UI (outside the app), then clicking Restore in the app: the book leaves `/trash`, reappears at `/`, server log records the 404, DB row has `trashed_at = NULL`.
- [ ] 2.12 The sidebar "Trash" link is visible on every authenticated route and routes correctly to `/trash`.
- [ ] 2.13 With no trashed books, `/trash` shows the empty-state message.
- [ ] 2.14 The trash list orders books with the most-recently-trashed at the top.
