# Rename Tag Globally — Hardening Implementation Plan

## Overview

The basic global rename is already shipped: `renameTag` is a single-row UPDATE, the `/tags` route lists every user tag with a book count, and an inline-edit row lets the user save / cancel a rename. This change hardens that surface — adds case-insensitive collision detection, transactional merge with inline confirm, specific error copy for the predictable validation failures, and a client-side length cap. No schema migration; no UX paradigm shift.

## Current State Analysis

- `src/lib/tags.ts:102-113` — `renameTag(userId, tagId, newName)` is a 4-line `UPDATE tags SET name = ? WHERE id = ? AND user_id = ?`. A collision against `UNIQUE(user_id, name)` raises Postgres `23505` and falls into the action's generic catch.
- `src/app/actions/tags.ts:97-117` — `renameTagAction` trims input, rejects empty, calls `renameTag`, returns `{ ok: false, message: "Could not rename tag. Please try again." }` on any failure.
- `src/app/(app)/tags/page.tsx` + `tags-manager.tsx` — `/tags` lists tags via `listUserTagsWithCount`. The `TagsManager` client component holds `editingId` + `editValue` + `error` in `useState`, binds Enter/Escape to the input, and `router.refresh()`-es after success.
- Schema (per `context/changes/library-data-schema/plan-brief.md`): `tags(id UUID PK, user_id FK, name, created_at)` with `UNIQUE(user_id, name)`. `book_tags(book_id FK, tag_id FK, added_at, PK(book_id, tag_id))` with ON DELETE CASCADE on both FKs.
- Filter URLs (per `context/changes/filter-by-tag/plan-brief.md`): carry tag *names* in `?tags=fiction&tags=philosophy`. A rename of a referenced tag silently produces zero matches. Already-accepted tradeoff; this plan does not revisit it.
- `src/lib/tags.ts:57-79` `addTagToBook` and `src/lib/tags.ts:115-148` `applyTagsToBooks` are the established patterns for transactional tag writes — `db.transaction()` + `onConflict((oc) => oc.columns([…]).doNothing())`.

## Desired End State

- Renaming to a non-colliding name behaves exactly as today (inline edit → Save → tag updated → row refreshes).
- Renaming to a name that case-insensitively matches one of the user's other tags (after trimming) is detected before any DB write — the inline edit row swaps Save/Cancel for `Merge into "Target" (N books)` / `Cancel`. Confirming runs a single transaction that union-merges `book_tags` from source into target and deletes the source tag. The list refreshes and the source row's space briefly shows `Merged into Target — M books` before fading.
- Renaming to the same name modulo case/whitespace is a silent no-op (no DB write, edit mode exits).
- Names > 50 characters are rejected client-side and server-side with `Tag name is too long (50 characters max).`.
- Empty / whitespace-only names are rejected with `Tag name cannot be empty.`.
- Any other failure surfaces the existing generic copy.
- The `/tags` empty-state message acknowledges that books can now be tagged from the library too.

### Key Discoveries:

- `src/lib/tags.ts:57-79` `addTagToBook` already uses the exact `db.transaction()` + `onConflict.doNothing()` pattern this plan needs for the merge branch — no new primitives.
- `src/lib/tags.ts:18-39` `listUserTagsWithCount` is the canonical book-count read. The action will reuse the underlying `book_tags` join shape (single target only, no need for the full list) so the confirm UI can render counts without a second round-trip.
- Schema constraint `UNIQUE(user_id, name)` is case-sensitive (Postgres `TEXT`); detection must lowercase both sides. Pre-existing case-variant duplicates (e.g. `Fiction` + `fiction` both present from before this change) are not migrated — the policy is "no new case-variant duplicates created via rename or add (rename only this change)", not "no case-variant duplicates ever".
- `book_tags` has `ON DELETE CASCADE` from `tag_id`; deleting the source tag will cascade-delete any source `book_tags` rows that survive the union-INSERT. The DELETE on `book_tags` is therefore optional for correctness — but keeping it explicit makes the transaction order clear and avoids relying on cascade for the common path.
- `tags-manager.tsx:33-58` `handleRename` is the only call site of `renameTagAction`. No other clients to update.

## What We're NOT Doing

- Changing `tags.name` storage to `citext` or adding a functional `UNIQUE` on `lower(name)` (case-insensitive detection only; storage stays case-sensitive).
- Backfilling existing tag-name casing or normalizing pre-existing case-variant duplicates.
- Adding a tag delete affordance to `/tags` (separate change).
- Migrating filter URLs to be rename-safe (`?tags=name` → `?tags=<id>` or `?tags=<slug>`). Stale-URL behavior remains as accepted in `filter-by-tag/plan-brief.md`.
- Harmonizing `addTagAction` validation with rename's new 50-char cap (rule divergence acknowledged; separate change).
- Audit log, undo, or restore-after-merge.
- Toast / global-notification infrastructure.
- Modal-based confirm flow — confirmation stays inside the inline edit row.
- Server-action plumbing for a separate "preview merge" round-trip — collision detection happens inside `renameTagAction`'s first call.

## Implementation Approach

Single phase. The data layer and the UI are tightly coupled (the new return shape is meaningless without UI that consumes it), so shipping them together avoids a half-finished checkpoint on `main`.

Replace `renameTag` with `renameOrMergeTag` in `src/lib/tags.ts`. Extend `renameTagAction` to (a) own input validation with specific error messages, (b) detect collision upfront and return `needs_confirm` when the form field `confirmedMerge !== '1'`, (c) re-detect inside the transaction and merge when `confirmedMerge === '1'`. Extend `TagsManager` to consume the new discriminated result: edit → needs_confirm (swapped buttons) → confirm → merged (transient inline notice + refresh). Add a client-side length cap mirroring the server.

## Critical Implementation Details

- **Detection-vs-storage policy.** Collision detection uses `LOWER(TRIM(name))`; storage keeps the user's exact casing. The DB still enforces `UNIQUE(user_id, name)` byte-exact. The application is the only place that prevents new case-variant duplicates via rename — pre-existing ones (if any) remain. This is intentional per the scope decision.
- **Transaction shape.** The merge runs as a single `db.transaction()`. Order: (1) re-select source by `(id, user_id)`; (2) re-select target by `(id, user_id, LOWER(TRIM(name)) = LOWER(TRIM(newName)), id != sourceId)` — if the target has vanished between the first action call and the confirm, fall through to a plain rename instead of failing; (3) `INSERT INTO book_tags(book_id, tag_id) SELECT book_id, <targetId> FROM book_tags WHERE tag_id = <sourceId> ON CONFLICT (book_id, tag_id) DO NOTHING`; (4) `DELETE FROM tags WHERE id = <sourceId> AND user_id = <userId>` (the `book_tags` FK cascade handles cleanup of any source rows still attached). If anything throws, the transaction aborts and the user sees the generic error; no half-merged state lands.

---

## Phase 1: Merge-on-collision + hardening for rename

### Overview

Replace the rename data-layer function with a merge-aware version, extend the server action to validate + return a discriminated state, and rebuild the inline-edit UX to handle the confirm sub-state and the post-merge transient notice.

### Changes Required:

#### 1. Replace `renameTag` with `renameOrMergeTag`

**File**: `src/lib/tags.ts`

**Intent**: Replace the 4-line `renameTag` UPDATE with a function that branches on case-insensitive collision against the user's other tags. The non-collision branch is a plain UPDATE. The collision branch runs a single transaction that union-merges `book_tags` from source into target and deletes the source tag. Callers receive a discriminated result that carries enough metadata (target tag + merged book count) for the UI to render the confirmation without a second round-trip.

**Contract**:
- Replaces the existing `renameTag(userId, tagId, newName): Promise<void>` export.
- New signature: `renameOrMergeTag(userId: string, tagId: string, newName: string): Promise<RenameOutcome>`.
- `RenameOutcome = { kind: "renamed"; tag: Tag } | { kind: "merged"; target: Tag; mergedBookCount: number }`.
- Collision predicate (used internally and by the action's pre-check): the user's other tag where `LOWER(TRIM(name)) = LOWER(TRIM(newName)) AND id != tagId AND user_id = userId`. Returns at most one row because `UNIQUE(user_id, name)` already prevents byte-exact duplicates and the lowercased+trimmed comparison can only group those.
- Non-collision branch: `UPDATE tags SET name = ? WHERE id = ? AND user_id = ?` (current behavior); return `{ kind: "renamed", tag: { id, name: newName.trim() } }`.
- Collision branch: `db.transaction().execute(async (trx) => …)`:
  1. Re-select source row by `(id, user_id)`; if missing, throw — caller maps to generic error.
  2. Re-select target row by the collision predicate above (using `trx`); if missing, fall through to non-collision branch inside the same transaction (race with concurrent delete; treat as a plain rename).
  3. `INSERT INTO book_tags (book_id, tag_id) SELECT book_id, <targetId> FROM book_tags WHERE tag_id = <sourceId> ON CONFLICT (book_id, tag_id) DO NOTHING` (use Kysely's `insertInto(...).columns(...).expression(eb => eb.selectFrom(...))` shape, mirroring nothing currently in the codebase — closest analog is `applyTagsToBooks`).
  4. `DELETE FROM tags WHERE id = <sourceId> AND user_id = <userId>` — the `book_tags` FK cascade cleans up any unmoved source rows.
  5. `SELECT COUNT(*) FROM book_tags WHERE tag_id = <targetId>` for `mergedBookCount`.
  6. Return `{ kind: "merged", target, mergedBookCount: Number(count) }`.
- Add a separately-exported helper `findCollidingTag(userId: string, tagId: string, newName: string): Promise<Tag | null>` and `countBookTags(tagId: string): Promise<number>` so the action can do the pre-confirm detection without duplicating the predicate. Both are thin wrappers over the join above.
- Delete the old `renameTag` export; update the single import in `src/app/actions/tags.ts`.

#### 2. Extend `renameTagAction` with validation, collision pre-check, and discriminated result

**File**: `src/app/actions/tags.ts`

**Intent**: Move validation rules into the action with specific error copy, detect collisions before any write, return a discriminated state that tells the UI whether to render the plain success, the confirm prompt, the merged-success notice, or an error. Accept a `confirmedMerge` form field that gates the destructive branch.

**Contract**:
- Replace `TagActionState` reuse for rename with a new dedicated state type:
  ```ts
  export type RenameTagActionState =
    | { ok: true; kind: "renamed"; tag: { id: string; name: string } }
    | { ok: true; kind: "merged"; target: { id: string; name: string }; mergedBookCount: number }
    | { ok: false; kind: "needs_confirm"; target: { id: string; name: string }; targetBookCount: number; sourceBookCount: number }
    | { ok: false; kind: "error"; message: string };
  ```
- Form fields: existing `tagId`, `newName`; new optional `confirmedMerge` (`"0"` | `"1"`, default `"0"`).
- Validation order (each returns `{ ok: false, kind: "error", message: <specific> }`):
  1. Auth → `redirect("/signin")` (unchanged).
  2. `tagId` non-empty after trim → "Missing tag id" (unchanged copy).
  3. `newName` non-empty after trim → "Tag name cannot be empty."
  4. trimmed `newName` length ≤ 50 → "Tag name is too long (50 characters max)."
- No-op short-circuit: if the trimmed+lowercased `newName` equals the trimmed+lowercased current name of the source tag (look up by `(tagId, userId)`), return `{ ok: true, kind: "renamed", tag: <existing> }` without writing — the UI treats this as a silent edit-mode exit.
- Collision pre-check when `confirmedMerge !== "1"`:
  - Call `findCollidingTag(userId, tagId, newName)`. If null → call `renameOrMergeTag` (it will hit the non-collision branch); return `{ ok: true, kind: "renamed", tag }`.
  - If non-null → call `countBookTags(target.id)` and `countBookTags(sourceTagId)` (two cheap queries). Return `{ ok: false, kind: "needs_confirm", target, targetBookCount, sourceBookCount }` without touching the data.
- Confirm path (`confirmedMerge === "1"`): call `renameOrMergeTag`. Map `kind: "merged"` → `{ ok: true, kind: "merged", target, mergedBookCount }`. Map `kind: "renamed"` (race fell through to plain rename) → `{ ok: true, kind: "renamed", tag }`.
- Catch-all: generic `{ ok: false, kind: "error", message: "Could not rename tag. Please try again." }` for any thrown exception during the writes (preserves existing error copy).
- Update the type imports in `tags-manager.tsx` to consume `RenameTagActionState` instead of `TagActionState`.

#### 3. Inline confirm UX + transient post-merge notice in `TagsManager`

**File**: `src/app/(app)/tags/tags-manager.tsx`

**Intent**: Extend the inline-edit state machine to add a merge-confirm sub-state and a transient post-merge notice. After Save returns `needs_confirm`, the row swaps Save/Cancel for `Merge into "Target" (N books)` / `Cancel`. Confirm re-submits the same form with `confirmedMerge=1`. On `merged`, the source row briefly shows `Merged into Target — M books` before `router.refresh()` removes it from the list.

**Contract**:
- New state fields alongside `editingId` and `editValue`:
  - `pendingMerge: { target: { id: string; name: string }; targetBookCount: number; sourceBookCount: number } | null` — non-null when the current edit row is in the confirm sub-state.
  - `mergedNotice: { sourceTagId: string; target: { id: string; name: string }; mergedBookCount: number } | null` — non-null for ~3s after a successful merge; rendered in place of the source row's normal content until fade.
- `handleRename(tag)`:
  - Client-side length check: `if (newName.length > 50) { setError("Tag name is too long (50 characters max)."); return; }`.
  - Build `formData` with `tagId`, `newName`, `confirmedMerge: pendingMerge ? "1" : "0"`.
  - Dispatch through `useTransition`; on result:
    - `kind: "renamed"` → close edit (`editingId = null`, `pendingMerge = null`), `router.refresh()`.
    - `kind: "needs_confirm"` → set `pendingMerge` from the response; keep `editingId` and `editValue` as-is; clear `error`.
    - `kind: "merged"` → set `mergedNotice`, clear `editingId` and `pendingMerge`; `router.refresh()`; schedule `setTimeout(() => setMergedNotice(null), 3000)` (clean up the timer on unmount with `useEffect`).
    - `ok: false, kind: "error"` → `setError(message)`.
- `cancelEdit()` resets `pendingMerge` in addition to its current cleanup.
- Render branching inside the row:
  - When `editingId === tag.id && !pendingMerge` → existing input + Save/Cancel.
  - When `editingId === tag.id && pendingMerge` → input becomes read-only (or stays editable; recommend read-only to make the confirm gesture explicit); buttons become `Merge into "${pendingMerge.target.name}" (${pendingMerge.targetBookCount} books)` (calls `handleRename`) + `Cancel`. Show a small explanatory line above the buttons: `“${editValue}” will merge with the existing tag, combining their ${pendingMerge.sourceBookCount + pendingMerge.targetBookCount /* approximate, may double-count overlaps; OK for display */} books.` — purely informational. Alternative: show `${pendingMerge.sourceBookCount}` and `${pendingMerge.targetBookCount}` separately and skip the sum to avoid the overlap caveat. Pick the per-tag counts to dodge the overlap arithmetic.
  - When `mergedNotice && mergedNotice.sourceTagId === tag.id` → render the source row's space with `Merged into "${target.name}" — ${mergedBookCount} books` in a green/zinc tone matching the design vocabulary; ignore the `router.refresh()`-induced row removal until the timeout clears the notice (since `initialTags` is server-rendered, refresh re-fetches and the source disappears — to keep the notice visible, render it OUTSIDE the `.map()` as a banner-styled list item above or below the tag list, keyed by `sourceTagId`).
- Empty-state copy update: `"No tags yet. Add tags to books from the book detail page."` → `"No tags yet. Add tags from a book’s detail page or from the library."` (acknowledges `QuickTagPopover` + selection-mode bulk add shipped in `tag-a-book`).

### Success Criteria:

#### Automated Verification:

- TypeScript + Next.js production build passes: `npm run build`
- ESLint passes: `npm run lint`

#### Manual Verification:

- Plain rename (no collision): edit a tag, type a brand-new name, Save → tag is renamed in the list, row closes, no error.
- Case-insensitive collision detected: with two tags `Fiction` and `essays`, rename `essays` → `FICTION` → inline edit row swaps to `Merge into "Fiction" (N books)` / `Cancel`, no DB write yet.
- Merge confirmed: from the previous state, click `Merge into "Fiction" (…)` → `essays` row disappears, `Fiction`'s book count is now the union of both tags' books (any book that carried both `essays` and `Fiction` is counted once, not twice), and the source row's slot briefly shows `Merged into "Fiction" — M books` for ~3s before fading.
- Merge cancelled: trigger collision → click `Cancel` → returns to inline edit state with the typed name intact (or exits edit mode entirely; both are acceptable but document which behavior shipped); no DB write.
- No-op self-rename: rename `Fiction` → ` fiction ` (or ` FICTION `) → silently exits edit mode, no DB write, list unchanged.
- Length validation client-side: type a 51-char name, Save → inline error `Tag name is too long (50 characters max).`, no server roundtrip.
- Length validation server-side: bypass client (e.g. via React DevTools) and submit a 51-char name → action returns the same specific error; no DB write.
- Empty-name validation: clear the input, Save → inline error `Tag name cannot be empty.`, no DB write.
- Generic-error path: forcibly throw inside `renameOrMergeTag` (or temporarily break the DB connection) → inline error `Could not rename tag. Please try again.` and no half-merged state in `book_tags` (transaction aborts cleanly).
- Downstream propagation: after a successful rename and a successful merge, navigate to `/` (library) — each previously-tagged book shows the new tag name on its card, and any active `?tags=<old-name>` URL goes to zero matches as expected per the accepted stale-URL tradeoff.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before closing out the change.

---

## Testing Strategy

### Unit Tests:

No test framework is configured in this repo (`CLAUDE.md` traps section). Do not introduce one for this change. Manual verification covers the behavior matrix.

### Integration Tests:

Same — not in scope. Manual verification.

### Manual Testing Steps:

Use the 10-item manual checklist above. Important ordering:

1. Run the plain-rename test first — it verifies the non-collision branch still works.
2. Run the case-insensitive collision test next — it verifies detection.
3. Run the merge confirm test third — it verifies the transaction.
4. Run the cancel-from-confirm test fourth — it verifies the state machine.
5. Run the validation tests (length client, length server, empty) — they verify the error-copy contract.
6. Run the generic-error test — verifies transaction atomicity (no orphan rows).
7. Run the downstream propagation test last — verifies the rename + merge cleanly translate to the library/book detail/filter surfaces.

After test #3, query the DB directly (`psql` or the `mcp__render__query_render_postgres` tooling against a dev DB) to spot-check `SELECT COUNT(*) FROM book_tags WHERE tag_id = <merged_target_id>` matches the UI's reported `mergedBookCount`.

## Performance Considerations

The collision pre-check is a single indexed lookup (`tags` is keyed on `(user_id, name)` via UNIQUE, plus the PK on `id`). The merge transaction is bounded by the source tag's book_tags row count, which in the single-user app is at most "a few hundred" in realistic scenarios — far below any threshold that would warrant batching. No memoization or caching needed.

## Migration Notes

None. Schema is unchanged. No data backfill.

## References

- Current rename data layer: `src/lib/tags.ts:102-113`
- Current rename action: `src/app/actions/tags.ts:97-117`
- Current rename UX: `src/app/(app)/tags/tags-manager.tsx`
- Transactional tag write pattern (mirror this): `src/lib/tags.ts:57-79` (`addTagToBook`) and `src/lib/tags.ts:115-148` (`applyTagsToBooks`)
- Schema decisions for tag identity: `context/changes/library-data-schema/plan-brief.md` ("Tag identity" row in Key Decisions)
- Accepted stale-URL tradeoff on rename: `context/changes/filter-by-tag/plan-brief.md` ("Open Risks & Assumptions" → "Tag-rename bookmark fragility")
- Tagging surfaces that now exist beyond `/books/[id]`: `context/changes/tag-a-book/plan-brief.md` (QuickTagPopover + bulk selection)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Merge-on-collision + hardening for rename

#### Automated

- [x] 1.1 TypeScript + Next.js production build passes: `npm run build` — 653ed1b
- [x] 1.2 ESLint passes: `npm run lint` — 653ed1b

#### Manual

- [ ] 1.3 Plain rename (no collision) updates the tag and closes the row
- [ ] 1.4 Case-insensitive collision swaps Save for `Merge into "Target" (N books)` without writing
- [ ] 1.5 Confirm merge moves all source books to target (union, no double-count), source row disappears, transient `Merged into "Target" — M books` notice appears for ~3s
- [ ] 1.6 Cancel from the confirm sub-state returns to edit mode without writing
- [ ] 1.7 No-op self-rename (same trimmed+lowercased name) silently exits edit mode with no DB write
- [ ] 1.8 Client-side length cap rejects 51-char names with `Tag name is too long (50 characters max).` before any roundtrip
- [ ] 1.9 Server-side length cap rejects 51-char names submitted via DevTools with the same specific copy
- [ ] 1.10 Empty / whitespace-only name rejected with `Tag name cannot be empty.`, no DB write
- [ ] 1.11 Forced error during merge leaves `book_tags` in a consistent state (transaction aborts cleanly) and surfaces the generic copy
- [ ] 1.12 Downstream propagation: library cards and book detail show the new tag name; stale `?tags=<old-name>` URLs filter to zero (accepted)
