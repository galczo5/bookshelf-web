<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Soft-delete a book to a Drive trash directory

- **Plan**: context/changes/soft-delete-book/plan.md
- **Scope**: All phases (Phase 1 + Phase 2)
- **Date**: 2026-06-03
- **Verdict**: NEEDS ATTENTION → APPROVED after triage fixes
- **Findings**: 0 critical | 3 warnings | 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Promise.all with drive.files.get outside Drive-error try-catch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/actions/books.ts:68-71 (pre-fix)
- **Detail**: The Promise.all calling findAvailableFilename + drive.files.get sat outside the try-catch for Drive errors. A permanently-deleted file causes drive.files.get to throw a 404 that propagated uncaught to the client as an unhandled throw instead of { ok: false, message: "..." }.
- **Fix Applied**: Separated drive.files.get into its own try-catch with explicit 404 → DB-only early return (consistent with moveDriveFile 404 handling). findAvailableFilename runs sequentially after, only when the file is confirmed to exist.
- **Decision**: FIXED via Fix A — commit 0ca189b

### F2 — Stale trash-folder cache not evicted on Drive errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/drive/library-folder.ts:5
- **Detail**: trashFolderCache never evicted. If the user manually deletes the Trash folder in Drive, the cache returns a stale ID. The action handles 404 from moveDriveFile gracefully. Consistent with pre-existing folderCache behaviour.
- **Fix Applied**: Added one-line comment above trashFolderCache documenting best-effort caching.
- **Decision**: FIXED — commit 0ca189b

### F3 — Rollback rename intent undocumented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/actions/books.ts:114, 124 (post-fix line numbers)
- **Detail**: The rollback calls moveDriveFile(..., originalName) to restore the pre-move filename. Without a comment a future editor could misread it as redundant and remove it.
- **Fix Applied**: Added "// restore original filename — forward move renamed file to finalName in Trash" at both rollback call sites.
- **Decision**: FIXED — commit 0ca189b

### F4 — trashed_at returned as `as Date` cast without validation

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/lib/books.ts:120
- **Detail**: sql`NOW()` bypasses the ColumnType; row.trashed_at cast as Date. Safe while schema is stable.
- **Decision**: SKIPPED

### F5 — Concurrent double-trash race condition

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/app/actions/books.ts
- **Detail**: Two concurrent requests could both pass the preflight and interact. Acceptable in a single-user app; WHERE trashed_at IS NULL provides DB-level idempotency.
- **Decision**: SKIPPED

### F6 — Escape key silently no-ops while pending

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/app/(app)/books/[id]/trash-book-control.tsx:52
- **Detail**: handleClose returns early when isPending, so Escape is swallowed. Consistent with notes-section.tsx identical pattern.
- **Decision**: SKIPPED

### F7 — Back-button stale view

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/books/[id]/trash-book-control.tsx:31-33
- **Detail**: router.push("/") on success; browser back could hit a cached book detail page. Mitigated by revalidatePath(`/books/${bookId}`) in the action.
- **Decision**: SKIPPED
