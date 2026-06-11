# Dual-copy import with structured file naming and series/part metadata — Plan Brief

> Full plan: `context/changes/book-structured-file-naming/plan.md`

## What & Why

Today an imported epub is uploaded once to `Bookshelf/` as `Author — Title.epub` and is never renamed when its metadata changes. This change keeps a **pristine copy** of every import in a new `Bookshelf/Original files/` folder, and gives the **working copy** a structured, always-current name — `Author - Series - Part - Title.epub` — that auto-updates whenever those fields change. It also introduces **series** and **part** as first-class metadata.

## Starting Point

Single upload in `confirmReviewAction`; one `drive_file_id` per book; `composeFilename(author, title)` (em-dash) shared by import/trash/restore; metadata edits (`applyMetadataAction` → `updateBookMetadata`) touch only the DB. No series/part anywhere. The rename primitive (`moveDriveFile`) and folder find-or-create pattern (`getOrCreateTrashFolder`) already exist.

## Desired End State

Each import lands two Drive files (renameable working copy + pristine original). Editing author/series/part/title renames the working copy on Drive; the original is never touched. If a Drive rename fails, the metadata still saves and a persisted `rename_pending` flag drives a warning banner + Retry button on the book page. Existing books converge to the new name format lazily on their next edit.

## Key Decisions Made

| Decision                   | Choice                                          | Why                                                              | Source |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- | ------ |
| Empty series/part in name  | Skip empty segments                             | Avoid dangling separators; name varies cleanly by fields present | Plan   |
| Separator                  | `-` (ASCII hyphen)                              | Matches the requested spec literally                             | Plan   |
| Pristine copy name         | Original upload filename, never renamed         | Truly preserves the source file                                  | Plan   |
| Rename-on-edit failure     | Save metadata, flag + Retry button              | Never lose an edit; DB is source of truth                        | Plan   |
| series / part types        | Both free text, nullable                        | Handles "1.5", "II", "Book Two"                                  | Plan   |
| Part vs series             | Independent fields                              | Simplest rule                                                    | Plan   |
| Trash/restore              | Move only the working copy                      | Smallest change; original stays archived                         | Plan   |
| Edit surface               | Detail-page panel only                          | One edit path; import flow untouched                             | Plan   |
| Existing books             | Null columns; lazy rename on next edit          | No risky bulk Drive ops; no backfill possible                    | Plan   |
| Sync tracking              | Store `drive_file_name` + `rename_pending` flag | Explicit state; no per-render Drive lookup                       | Plan   |
| Import dual-upload failure | Roll back both copies                           | No half-imported books                                           | Plan   |

## Scope

**In scope:** series/part columns; `Original files/` folder + dual upload; structured `composeFilename`; auto-rename on edit; rename-pending flag + warning/Retry UI; trash/restore name parity.

**Out of scope:** per-author/series subfolders; backfilling original copies; bulk renaming existing files; series/part in the import/review flow or in AI enrichment; numeric validation of part; moving the pristine copy on trash.

## Architecture / Approach

Bottom-up. Phase 1: migration `0007` + Kysely types + new `composeFilename({author,series,part,title})` (skip-empty) and `sanitizeOriginalFilename`, with the three callers (import/trash/restore) fixed and unit-tested. Phase 2: `getOrCreateOriginalFilesFolder` + dual upload in `confirmReviewAction` with both-copy rollback, persisted via `confirmDraft`. Phase 3: store gains series/part + `setWorkingCopyFilename`; new `renameWorkingCopy` Drive helper; `applyMetadataAction` saves-then-renames; `retryRenameAction` for the failure path. Drive calls stay in the action layer — `src/lib/books.ts` remains Drive-free. Phase 4: series/part inputs in the edit panel + detail page, warning banner + `RenameRetryControl`.

## Phases at a Glance

| Phase                     | What it delivers                                   | Key risk                                       |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| 1. Schema & filename core | Columns, types, structured composer, fixed callers | Signature change ripples to trash/restore      |
| 2. Dual-copy import       | Pristine copy + both file ids, atomic rollback     | Partial upload leaving orphans                 |
| 3. Rename-on-edit & retry | Auto-rename + `rename_pending` + retry action      | Keeping Drive calls out of the store; ordering |
| 4. UI                     | series/part fields + warning/Retry                 | Wiring new fields through panel + page         |

**Prerequisites:** Docker Postgres for migrate/tests; Drive OAuth for manual verification.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- `book_drafts.filename` reliably holds the original upload filename for the pristine copy (verified at `src/lib/book-drafts.ts:55`).
- Old + new filename styles coexist until each existing book is next edited (accepted).
- Drive rename collisions resolved via the existing `findAvailableFilename` ` (2)` suffixing.

## Success Criteria (Summary)

- Importing yields a renameable working copy plus a pristine `Original files/` copy.
- Changing author/series/part/title renames the working copy; the original never changes.
- A failed rename never loses the metadata edit and is recoverable via Retry.
