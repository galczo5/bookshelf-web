# Notes Durability + Tag-Rename Atomicity Tests — Plan Brief

> Full plan: `context/changes/testing-notes-and-tag-rename-integrity/plan.md`

## What & Why

Rollout Phase 2 of `context/foundation/test-plan.md`. Add server-action-layer
integration tests that defend **Risk #6** (a notes save silently drops
content) and **Risk #4** (a global tag rename half-applies, leaving books
split between old and new tags). Both are data-integrity guardrail risks with
no automated coverage today.

## Starting Point

Phase 1 stood up Vitest + a Docker-Postgres integration harness
(`tests/helpers/db.ts`, reference test `rename-on-edit.test.ts`). The notes
and tag-rename actions/libs are built and shipped, but untested. The merge
path carries a load-bearing, comment-documented invariant (INSERT before
DELETE) that nothing currently guards.

## Desired End State

Two new green integration files — `notes.test.ts` and `rename-tag.test.ts` —
plus shared `seedBook`/`seedSecondUser` harness helpers. The tag-merge test is
proven non-tautological by a manual mutation check. Cookbook §6 reflects the
new patterns; the orchestrator can mark §3 Phase 2 `complete`.

## Key Decisions Made

| Decision                   | Choice                                       | Why (1 sentence)                                                                      | Source               |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------- |
| Tag-merge atomicity signal | Union-preservation through the action only   | Catches the exact INSERT/DELETE CASCADE-ordering regression with zero fault injection | Plan                 |
| Notes durability scope     | Test what exists (explicit-save round-trip)  | The code has no autosave/debounce; testing a timer would be fiction                   | Plan                 |
| Harness seeding            | Add shared `seedBook` + `seedSecondUser`     | Reused by both files and future phases; kills inline duplication                      | Plan                 |
| Ownership cases            | Cover cross-user denial here                 | It's data-integrity (#4/#6), distinct from Phase 3's session-less #7                  | Plan                 |
| Test layer                 | Server actions, read back via real lib reads | Matches §3 "action layer" and the Phase 1 cookbook pattern                            | Frame (test-plan §3) |

## Scope

**In scope:** notes create/update/delete round-trips + failure-surface +
cross-user denial; tag rename/merge union-preservation, confirm-gate,
no-op, validation, cross-user denial; shared seed helpers; cookbook note.

**Out of scope:** autosave/timer tests (unimplemented), fault-injection
rollback tests, session-less/expired-session sweep (Risk #7 → Phase 3), lib
mocking, schema changes, Drive/OpenAI fakes.

## Architecture / Approach

Call the server actions directly with `FormData` (no HTTP), mocking only
`@/auth` and `next/cache` per `rename-on-edit.test.ts`. Build fixtures through
the real lib (`addTagToBook`, `applyTagsToBooks`) and read state back through
real reads (`listBookNotes`, `listBookTags`, `listUserTagsWithCount`) so
assertions check persisted rows, not action return values. Land notes first
(exercises the new helpers), then tag-rename, then housekeeping.

## Phases at a Glance

| Phase                              | What it delivers                              | Key risk                                                          |
| ---------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| 1. Helpers + notes tests           | `seedBook`/`seedSecondUser` + `notes.test.ts` | Asserting on return value instead of persisted row                |
| 2. Tag-rename tests + housekeeping | `rename-tag.test.ts` + cookbook note          | Union test passing tautologically — guarded by the mutation check |

**Prerequisites:** Phase 1 harness (done); Docker Postgres reachable for `npm run test:integration`.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- The merge transaction's rollback guarantee is Postgres's; the test targets
  the _code_ regression (ordering), not the DB engine — accepted by the
  union-preservation decision.
- Cross-user cases assume `seedSecondUser` uses a distinct fixed UUID that
  won't collide with `TEST_USER`.

## Success Criteria (Summary)

- A saved note is provably readable back; a rejected save persists nothing.
- A confirmed tag merge lands every source book on the surviving tag (deduped)
  and removes the old tag; the confirm gate mutates nothing.
- The atomicity test demonstrably fails when the merge ordering is reversed.
