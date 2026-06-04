# Restore a trashed book — Plan Brief

> Full plan: `context/changes/restore-trashed-book/plan.md`

## What & Why

Build the inverse of S-09 (soft-delete): a place where the user sees their trashed books, and a control to put any of them back. FR-007 explicitly calls for restore — without it, S-09's recoverable trash is half-finished from the user's perspective. This is roadmap slice S-10; it closes Stream E (Trash lifecycle).

## Starting Point

S-09 just landed and the plumbing is reusable end-to-end. `books.trashed_at` is already nullable and queryable; `moveDriveFile` (`src/lib/drive/trash.ts:4`) and `getOrCreateLibraryFolder` / `getOrCreateTrashFolder` (`src/lib/drive/library-folder.ts:8, 39`) are direction-agnostic; `trashBookAction` (`src/app/actions/books.ts:19-138`) is the structural template for restore. What's missing: a query for trashed books (`listConfirmedBooks` filters them out — there is no surface anywhere in the app where a trashed book is visible today), a `restoreTrashedBook` DB function, a `restoreBookAction` server action, a `/trash` route, a sidebar link, a `RestoreBookControl` modal, and read-only branching on `/books/[id]` so trashed books are reachable for restore.

## Desired End State

A new "Trash" sidebar entry routes to `/trash`, which lists trashed books (cover, title, author, when-trashed) with a Restore button per row. Clicking Restore opens a confirmation modal mirroring the S-09 trash modal; confirming moves the file from `Bookshelf/Trash/` back to `Bookshelf/` (with collision-resolved filename), sets `trashed_at = NULL`, and the book reappears at `/`. Visiting `/books/[id]` for a trashed book renders a fully read-only variant — tags as static chips, notes via the existing read-only `NoteReader`, no tag picker / no suggestions / no notes editor — with a small "This book is in trash" banner near the top and a Restore button in the bottom action slot where `TrashBookControl` sits for confirmed books.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Trash IA | Dedicated `/trash` page + sidebar link | Clean separation from the library list; matches FR-007's "back into the library" framing; easy to evolve (purge, batch) later. | Plan |
| Restore UX | Modal confirmation (mirror trash) | Symmetry with the trash flow; the user explicitly chose this over one-click despite restore being non-destructive. | Plan |
| Detail view for trashed books | Yes — read-only at the same `/books/[id]` route | Stable URLs across trash/restore; user can review notes/tags before deciding to restore. | Plan |
| Detail page route detection | Same route, branch on `book.trashedAt` (no query param) | One URL per book; pasting a URL Just Works regardless of trashed state. | Plan |
| What stays interactive in read-only detail | Only "Restore" — tags, notes, suggestions all read-only / hidden | Smallest surface; clearest "frozen archive" mental model. | Plan |
| Restore button placement on detail view | Symmetric with trash — single low-emphasis button at the bottom of the page | Mirrors `TrashBookControl`'s slot; minimal layout change; banner near the top supplies context. | Plan |
| Trash list ordering | Most recently trashed first (`trashed_at DESC`) | Matches the "I just deleted X, where is it?" use case. | Plan |
| Drive failure handling | Mirror S-09 — 404 / null `drive_file_id` → DB-only with warn-log; other Drive errors → fail without touching DB; DB failure → best-effort Drive rollback | Established pattern; users expect symmetric semantics. | Plan |
| `getConfirmedBook` callers | Add a new `getOwnedBook` for the detail page; leave `getConfirmedBook` alone for `tag-suggestions.ts` | Tag suggestions for an archived book are meaningless; minimal blast radius. | Plan |
| Schema migration | None | `trashed_at` already nullable. | Research |

## Scope

**In scope:**
- New DB functions: `listTrashedBooks`, `getOwnedBook`, `restoreTrashedBook`
- `BookDetail.trashedAt: Date | null` field
- New server action: `restoreBookAction(bookId)` with Drive-first / DB-second / rollback semantics
- New `/trash` route (server component) listing trashed books
- New client component: `RestoreBookControl` with radix `Dialog` confirm modal
- New sidebar nav item linking to `/trash`
- Read-only detail variant on `/books/[id]` triggered by `book.trashedAt != null`
- Promote `NoteReader` from internal helper to exported component (for reuse in read-only detail)
- `revalidatePath` of `/`, `/trash`, and `/books/[id]` on successful restore
- Graceful handling of Drive 404 / null `drive_file_id` (proceed DB-only with warn-log)

**Out of scope:**
- Permanent purge / "empty trash"
- Bulk restore
- Search / filter / tag controls on `/trash`
- Editing tags / notes inside the read-only detail variant
- URL canonicalization / `?trashed=1` query param
- Trash-count badge in the sidebar
- Schema migration
- Test framework setup

## Architecture / Approach

```
/trash (server)
  └── listTrashedBooks(userId)
       │
       ▼
  row → RestoreBookControl (client)
        ↓ click "Restore" → opens Dialog
        ↓ confirm
        ↓ useTransition → server action
              restoreBookAction(bookId)
                1. auth, fetch trashed row (drive_file_id, title, author)
                2. getDriveClient → getOrCreateLibraryFolder → getOrCreateTrashFolder
                3. Read current Drive filename (for rollback safety)
                4. findAvailableFilename in Bookshelf/   ← collision-resolve
                5. moveDriveFile(Trash → Library)         ← 404 → skip, log
                6. restoreTrashedBook (UPDATE trashed_at = NULL) ← on throw, move back
                7. revalidatePath("/"), "/trash", "/books/[id]"
        ↓ on { ok: true } → router.refresh() → row vanishes
        ↓ on { ok: false } → Alert inside Dialog

/books/[id] (server) — getOwnedBook(id, userId)
  └── isTrashed = book.trashedAt != null
        ├── if trashed: banner + read-only chips + NoteReader list + RestoreBookControl
        └── if confirmed: render unchanged (TagPicker / SuggestionsPanel / NotesSection / TrashBookControl)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend primitives + restore server action | `listTrashedBooks`, `getOwnedBook`, `restoreTrashedBook`, `restoreBookAction` — pure backend, no UI | Server action without UI callers; only static checks verify it in isolation |
| 2. Trash page, sidebar link, restore control, read-only detail variant | `/trash` page + `RestoreBookControl` + sidebar link + read-only branch on `/books/[id]` | Drive rollback is best-effort — double-failure leaves a stuck state we surface but don't auto-repair (identical risk shape to S-09) |

**Prerequisites:** S-09 `soft-delete-book` — landed at `e76c91a` + `ab1a374`. Drive OAuth (F-01) and library-and-book-view (S-03) already in place.
**Estimated effort:** Small — one focused session across the two phases; smaller than S-09 because the Drive helpers are already in place.

## Open Risks & Assumptions

- **Best-effort Drive rollback.** Identical to S-09: if both the forward DB UPDATE fails and the Drive rollback move also fails, the book ends up with the file in `Bookshelf/` but DB still shows `trashed_at` set. We log loudly; the user retries.
- **Library folder may have been deleted in Drive between trash and restore** (the roadmap-flagged risk). `getOrCreateLibraryFolder` handles this — it lazy-creates `Bookshelf/` if absent — so the restored file lands in a fresh folder. No special-case code needed in the action.
- **Read-only branching adds branches to `/books/[id]`'s render tree.** Risk of subtly diverging styling between the confirmed and trashed branches. Mitigation: the trashed branch reuses the same outer layout, same cover block, same heading block — only the interactive children differ.
- **`NoteReader` becomes a public surface.** Promoting it from internal helper to exported component means future edits to `notes-section.tsx` must respect that contract. Acceptable cost; the component is small and stable.
- **No tests.** Phase 2 has manual-only verification. Same shape and same acceptable cost as S-09.

## Success Criteria (Summary)

- A user can restore a trashed book from `/trash` (with a modal confirmation gate), and the book reappears in the library while the file moves from `Bookshelf/Trash/` back to `Bookshelf/`.
- A trashed book is reachable via `/books/[id]` as a fully read-only view with a Restore button; a confirmed book renders exactly as before.
- A book whose Drive file is already missing (404 or null `drive_file_id`) can still be restored (DB flag clears; warning logged).
- A mid-operation failure never leaves DB and Drive in disagreement under the single-failure case (Drive succeeds and DB fails → rollback; Drive fails → nothing changes).
