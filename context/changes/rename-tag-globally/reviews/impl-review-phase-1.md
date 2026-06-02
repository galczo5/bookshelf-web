<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rename Tag Globally

- **Plan**: context/changes/rename-tag-globally/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-06-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 3 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated ✓; manual 1.3–1.12 pending) |

## Findings

### F1 — countBookTags has no userId ownership guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/tags.ts:124
- **Detail**: countBookTags(tagId) queries book_tags with no user_id check. Both current call sites pass tagIds already validated against userId, so no active IDOR. But the exported API is misleading — any future caller can silently count books under a tag they don't own.
- **Fix**: Add a userId parameter and join through tags: `SELECT count(bt.book_id) FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.tag_id = $tagId AND t.user_id = $userId`. Update both call sites in actions/tags.ts accordingly.
- **Decision**: FIXED — added userId parameter + ownership join; updated both call sites in actions/tags.ts

### F2 — Missing early return when sourceTag is not found

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/actions/tags.ts:130
- **Detail**: When sourceTag is null (stale tagId, or race with a delete), the `if (sourceTag && ...)` guard is false and execution falls through to findCollidingTag and then renameOrMergeTag, which throws "Source tag not found" — caught by the generic catch. Correct in effect, but an extra unnecessary DB round-trip happens before the throw. The intent is obscured: a missing tag should fail fast, not silently continue.
- **Fix**: After the sourceTag lookup, add: `if (!sourceTag) return { ok: false, kind: "error", message: "Tag not found." };` Then simplify the no-op guard to remove the `sourceTag &&`.
- **Decision**: FIXED — added early return; simplified no-op guard to remove sourceTag &&

### F3 — Direct db import in server action breaks data-layer separation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/app/actions/tags.ts:14
- **Detail**: The action imports db directly to fetch sourceTag for the no-op check (lines 130–135). Every other action file treats src/lib/* as the only DB-access layer and never holds a raw Kysely reference. This is the only exception.
- **Fix A ⭐ Recommended**: Extract `getTagById(userId, tagId): Promise<Tag | null>` in src/lib/tags.ts. Remove the db import from the action.
  - Strength: Matches every sibling action file; makes the action testable without Kysely mocks.
  - Tradeoff: ~10 extra lines in tags.ts for a one-liner function.
  - Confidence: HIGH — the pattern is consistent across all other action files.
  - Blind spot: None significant.
- **Fix B**: Keep as-is, document the exception with a comment.
  - Strength: Zero code change; the behavior is correct.
  - Tradeoff: Pattern divergence compounds over time.
  - Confidence: MEDIUM — acceptable for a single-user app.
  - Blind spot: Future action authors may not notice the pattern has been broken.
- **Decision**: FIXED via Fix A — extracted getTagById to tags.ts; removed db import from action

### F4 — Transaction ordering has an implicit correctness dependency

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/tags.ts:193
- **Detail**: The INSERT (migrate book_tags to target) must precede the DELETE (remove source tag) because ON DELETE CASCADE on tags.id would cascade-delete not-yet-migrated source book_tags rows if order were reversed. The ordering is correct but the invariant is invisible.
- **Fix**: Add a single-line comment above the DELETE explaining the ordering constraint.
- **Decision**: FIXED — added ordering comment above the DELETE in the merge transaction

### F5 — mergedNotice rendered as `<li>` inside `<ul>`, plan said outside

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/(app)/tags/tags-manager.tsx:127
- **Detail**: Plan specified "render it OUTSIDE the .map() as a banner-styled list item above or below the tag list." Implementation renders it as a `<li>` inside the same `<ul>` (before the .map() loop). Functionally identical — notice appears above all tag rows and disappears after 3s.
- **Fix**: Either accept as-is (DOM difference invisible to users) or move outside `<ul>` as a `<div>` sibling for strict plan conformance.
- **Decision**: SKIPPED — DOM structure is invisible to users; functionally correct

### F6 — Extra DB round-trip in no-op guard not specified in plan

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/actions/tags.ts:130
- **Detail**: The plan's no-op short-circuit implied the current tag name was available without a round-trip; the implementation does a SELECT to fetch it. Correct and necessary. Absorbed by F2/F3 fixes.
- **Fix**: No standalone fix needed — absorbed by F2 and F3 fixes.
- **Decision**: SKIPPED — absorbed by F2 and F3 fixes
