# Rename Tag Globally — Plan Brief

> Full plan: `context/changes/rename-tag-globally/plan.md`

## What & Why

A basic global rename already ships at `/tags` (single-row UPDATE → propagates via `book_tags.tag_id` join). This change hardens the surface: when a rename would collide case-insensitively with an existing tag, detect it before the write and offer a transactional merge inline, with specific error copy for the predictable validation failures. The product motivation is dedupe — the biggest user-visible reason to rename a tag is "I have `Fiction` and `fiction`; collapse them."

## Starting Point

- `src/lib/tags.ts:102-113` — `renameTag` is a plain UPDATE; collisions against `UNIQUE(user_id, name)` raise Postgres `23505` and fall into the action's bare catch.
- `src/app/actions/tags.ts:97-117` — `renameTagAction` trims + non-empty checks, returns a generic `"Could not rename tag. Please try again."` on any failure.
- `src/app/(app)/tags/page.tsx` + `tags-manager.tsx` — `/tags` lists tags via `listUserTagsWithCount` and offers inline edit with Save/Cancel + Enter/Escape.
- Schema (per `library-data-schema`): `tags(id PK, user_id FK, name)` UNIQUE on `(user_id, name)`; `book_tags(book_id, tag_id)` PK on the pair, FK CASCADE on both.
- Tagging is now also possible from the library (per `tag-a-book`); `/tags`'s empty-state copy is slightly stale.

## Desired End State

Renaming to a fresh name: same as today. Renaming to a name that case-insensitively matches another existing tag (after trimming): inline edit row swaps Save/Cancel for `Merge into "Target" (N books)` / `Cancel`. Confirm runs one transaction that union-merges `book_tags` from source → target and deletes the source; row disappears; a brief `Merged into "Target" — M books` notice sits in its place for ~3s. No-op renames (same name modulo case/whitespace) silently exit edit mode. Names > 50 chars and empty names are rejected with specific copy on both client and server. Schema unchanged.

## Key Decisions Made

| Decision                              | Choice                                                                                    | Why (1 sentence)                                                                                       | Source |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| Scope shape                           | Merge-on-collision + hardening                                                            | Collision is the biggest user-visible hole and the schema is already set up for the fix                | Plan   |
| Collision detection rule              | Case-insensitive (trimmed), storage stays case-sensitive                                  | Catches the dedupe motivation without committing to a `citext` migration                               | Plan   |
| Confirm-flow UX                       | Inline confirm inside the edit row (swap Save → `Merge into "X" (N books)`)               | Matches existing inline-edit ergonomics; no new modal/toast primitives                                 | Plan   |
| Post-merge feedback                   | Refreshed list + ~3s transient inline `Merged into "X" — M books` notice                  | Confirms the outcome without blocking the next interaction, no toast infra                             | Plan   |
| Validation rules                      | Trim + non-empty + 50-char cap (client + server, with specific copy)                      | Cheap, defensive, mirrors `addTagToBook`'s trim+non-empty plus a length guard                          | Plan   |
| Race handling                         | Re-detect inside the merge transaction; if target vanished, fall through to plain rename  | Resilient without an extra round-trip; single-user app makes the race effectively impossible          | Plan   |
| Error-copy granularity                | Specific for empty / too-long / no-op-same-name; generic catch-all for the rest           | Useful feedback on predictable mistakes without copy bloat for unreachable paths                       | Plan   |
| Phase count                           | One phase                                                                                 | Data layer and UI are tightly coupled; the new return shape is meaningless without UI to consume it    | Plan   |

## Scope

**In scope:**
- Replace `renameTag` → `renameOrMergeTag` in `src/lib/tags.ts` (single transaction, branch on collision).
- Add `findCollidingTag` + `countBookTags` exports for the action's pre-confirm detection (no duplicate predicates).
- Extend `renameTagAction` with validation rules (specific error copy), collision pre-check, `confirmedMerge` form field, discriminated `RenameTagActionState` result.
- Rebuild `TagsManager` to consume the new state: edit → needs_confirm → confirm → merged (transient notice).
- Client-side 50-char cap mirroring the server.
- Update the `/tags` empty-state copy to acknowledge library-side tagging.

**Out of scope:**
- Case-insensitive *storage* (no `citext`, no functional UNIQUE on `lower(name)`, no backfill).
- Filter-URL stability (`?tags=name` → `?tags=<id>`) — accepted stale behavior per `filter-by-tag`.
- Tag delete affordance.
- Harmonizing `addTagAction`'s validation with rename's 50-char cap.
- Audit log / undo / merge restore.
- Toast / global notification infra.
- Modal-based confirm.

## Architecture / Approach

```
User clicks Save in /tags inline edit
   │
   ▼
renameTagAction(formData, confirmedMerge='0')
   │
   ├── validate (trim, non-empty, ≤50, no-op-same-after-normalize)
   │
   ├── findCollidingTag(userId, tagId, newName)
   │       │
   │       ├── null  → renameOrMergeTag → 'renamed' branch (UPDATE) → { ok: true, kind: 'renamed' }
   │       │
   │       └── Tag   → countBookTags(source) + countBookTags(target)
   │                  → { ok: false, kind: 'needs_confirm', target, *Counts }
   │                  (NO db write)
   │
   ▼
TagsManager renders confirm sub-state (buttons swap)
   │
   ▼
User clicks "Merge into ..." → renameTagAction(formData, confirmedMerge='1')
   │
   ├── re-validate
   ├── renameOrMergeTag → transaction:
   │     1. re-select source
   │     2. re-select target (collision predicate)
   │     3. INSERT book_tags SELECT … ON CONFLICT DO NOTHING
   │     4. DELETE FROM tags WHERE id = source  (CASCADE cleans book_tags)
   │     5. SELECT COUNT(*) FROM book_tags WHERE tag_id = target
   │   → { kind: 'merged', target, mergedBookCount }
   │
   ▼
TagsManager: set mergedNotice → router.refresh() → setTimeout fade
```

The transaction-side detection is the source of truth (the pre-check exists only to give the UI material for the confirm prompt). If the target vanishes between the pre-check and the confirm, the transaction falls through to a plain rename — single-user mode makes this race effectively impossible, but the code is correct anyway.

## Phases at a Glance

| Phase                                                  | What it delivers                                                                                                                                              | Key risk                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Merge-on-collision + hardening for rename           | Replaces `renameTag` with transactional `renameOrMergeTag`; action returns discriminated state; `TagsManager` renders confirm + transient post-merge notice    | The two-step (pre-check → confirm → commit) state machine in `TagsManager` is the trickiest part — easy to leave `pendingMerge` stuck after a generic error |

**Prerequisites:** All tag data layer, action, and UI plumbing already exist (`tag-a-book` shipped). No new packages, no env vars, no DB migration.
**Estimated effort:** One session.

## Open Risks & Assumptions

- **Pre-existing case-variant duplicates are not migrated.** If the DB already has `Fiction` and `fiction` (rows that pre-date this change), they stay. The policy is "no new case-variant duplicates via *rename*", not "no case-variant duplicates ever". `addTagAction` is intentionally not harmonized (separate change). A user who wants the legacy duplicates collapsed must rename one through this flow.
- **Counts shown in the confirm prompt are per-tag, not the post-merge union.** Computing the exact union pre-confirm would require a real INTERSECT or a sub-select against `book_tags` — cheap, but the UI sticks to "source: 3 books, target: 5 books" wording instead of "8 books after merge" to dodge the overlap arithmetic and the surprise when the union is < sum due to books carrying both tags. The post-merge notice shows the actual `mergedBookCount` (true union count).
- **Confirm-state cleanup after generic error.** If the second action call throws inside the transaction, the user sees the generic error but `pendingMerge` is still set in the component. The error handler must clear `pendingMerge` (or leave it so the user can retry the merge); the plan chooses to keep `pendingMerge` set on error so a retry is one click — verify in manual step 1.11.
- **The transient `Merged into …` notice survives `router.refresh()`.** It's rendered outside the `.map(initialTags)` (as a standalone list item keyed by `sourceTagId`), so the source row's actual removal during refresh doesn't cancel the timer. If the user navigates away within 3s, the notice is lost; acceptable.

## Success Criteria (Summary)

- A user can rename `essays` → `FICTION` and have the merge happen in one transaction, with the confirm prompt showing both tags' book counts and the post-merge state showing the true union.
- A user who types a 51-char name sees the specific length error inline before any server round-trip.
- A user who renames `Fiction` → ` fiction ` (different only by case/whitespace) silently exits edit mode with no DB write.
- A forced error mid-merge leaves the DB consistent (no half-moved `book_tags`).
