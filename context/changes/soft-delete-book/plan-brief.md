# Soft-delete a book — Plan Brief

> Full plan: `context/changes/soft-delete-book/plan.md`

## What & Why

Give the user a way to remove a book from the library without losing the file. FR-006 calls for a recoverable trash state — relocate the epub to a dedicated area in cloud storage, hide it from the library list, leave it restorable later. This is roadmap slice S-09; restore (S-10) is the follow-up.

## Starting Point

The schema and queries are already trash-aware: `books.trashed_at TIMESTAMPTZ` exists, and both `listConfirmedBooks` and `getConfirmedBook` already filter `WHERE trashed_at IS NULL` (`src/lib/books.ts:31, 80`). The Drive client is well-abstracted (`getDriveClient`, `getOrCreateLibraryFolder`) and the import flow at `src/app/actions/confirm-review.ts:101-133` already demonstrates the Drive-first / DB-second / Drive-rollback-on-DB-failure pattern. A `radix-ui` `Dialog` is already in use at `src/app/(app)/books/[id]/notes-section.tsx:140-172`. What's missing: a Drive-move helper, a `Bookshelf/Trash/` folder concept, a server action, and a UI control on the single-book page.

## Desired End State

From `/books/[id]`, the user clicks "Move to trash", confirms in a modal, and the book disappears from the library: the epub is now in `Bookshelf/Trash/` in Drive, `books.trashed_at` is set, and they're back at `/` without the book in the list. If Drive fails mid-operation, neither DB nor Drive is left in a half-state.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Trash directory location | `Bookshelf/Trash/` subfolder, lazy-created | Keeps the entire library under one app-managed root; human-navigable per the PRD guardrail; mirrors the existing `getOrCreateLibraryFolder` pattern. | Plan |
| Ordering & failure handling | Drive first → DB second → roll Drive back on DB failure | Mirrors the established `confirm-review.ts` pattern; library row stays the source of truth for visibility. | Plan |
| Drive 404 / no `drive_file_id` | Flag in DB anyway, log warning | A book whose file vanished externally must still be removable; the library row drives visibility, not the file. | Plan |
| Confirmation UX | Modal dialog ("Move to Trash?") using radix `Dialog` | Stronger destructive-action affordance than inline state; the `Dialog` primitive is already in use in `notes-section.tsx`. | Plan |
| Where the control lives | Single-book view only (`/books/[id]`) | Matches FR-006 literally; small surface; bulk-trash can come later if real demand appears. | Plan |
| Draft-book trash | Out of scope — `review_state = 'confirmed'` only | FR-006 is about the library; review queue owns its own rejections. | Plan |
| Schema migration | None | `trashed_at` already exists in `0002_library_schema.mts`. | Research |

## Scope

**In scope:**
- New Drive helpers: `getOrCreateTrashFolder`, `moveDriveFile`
- New DB function: `trashConfirmedBook(bookId, userId)`
- New server action: `trashBookAction(bookId)` with Drive-first/DB-second/rollback semantics
- New client component: `TrashBookControl` with radix `Dialog` confirm modal
- Mount on `/books/[id]`
- `revalidatePath` of `/` and the book detail page on success
- Graceful handling of Drive 404 / null `drive_file_id` (proceed DB-only with warning)

**Out of scope:**
- Restore (S-10)
- Permanent purge / "empty trash"
- Bulk-trash
- Library-list overflow menu entry point
- Trash for draft / pending / rejected books
- Schema migration
- Toast / undo system
- Test framework setup

## Architecture / Approach

```
Book detail page (/books/[id])
  └── TrashBookControl (client)
        ↓ click "Move to trash" → opens Dialog
        ↓ confirm
        ↓ useTransition → server action
              trashBookAction(bookId)
                1. auth, fetch book row (drive_file_id, title, author)
                2. getDriveClient → getOrCreateLibraryFolder → getOrCreateTrashFolder
                3. Read current Drive filename (for rollback safety)
                4. findAvailableFilename in Trash/
                5. moveDriveFile(library → Trash/)         ← Drive 404 → skip, log
                6. trashConfirmedBook (UPDATE trashed_at)  ← on throw, move file back
                7. revalidatePath("/")
        ↓ on { ok: true } → router.push("/")
        ↓ on { ok: false } → Alert inside Dialog
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Drive trash helpers + DB trash function | `getOrCreateTrashFolder`, `moveDriveFile`, `trashConfirmedBook` — pure backend, no UI | Helpers without callers; only typecheck/lint to verify in isolation |
| 2. Server action + book-detail trash control with confirm modal | `trashBookAction` + `TrashBookControl` mounted on `/books/[id]` | Drive rollback is best-effort — a double-failure leaves the book in a stuck state we surface but don't auto-repair |

**Prerequisites:** S-03 `library-and-book-view` (single-book view) and F-01 `drive-oauth-and-client` — both already implemented.
**Estimated effort:** Small — one focused session across the two phases.

## Open Risks & Assumptions

- **Best-effort rollback.** If the rollback move also fails after a DB error, the book ends up with the file in `Trash/` and DB row still active. We log loudly but don't retry automatically. Mitigation: the user retries; a future S-09-followup could add a reconciliation pass.
- **`drive.files.update` move semantics.** Assumes the Drive API treats `addParents` + `removeParents` as atomic from the user's perspective. This is documented behavior for `files.update`, but worth verifying once during Phase 1 by reading the response's `parents` field.
- **No tests.** Phase 2 has manual-only verification. The change is intentionally small enough to make this acceptable; the planned `testing-harness-and-import-integrity` work can backfill coverage.

## Success Criteria (Summary)

- User can trash a confirmed book from `/books/[id]`, with a modal confirmation gate, and the book vanishes from the library while the file lands in `Bookshelf/Trash/` in Drive.
- A book whose Drive file is already missing can still be trashed (DB flag lands; warning logged).
- A mid-operation failure never leaves DB and Drive in disagreement under the single-failure case (Drive succeeds and DB fails → rollback; Drive fails → nothing changes).
