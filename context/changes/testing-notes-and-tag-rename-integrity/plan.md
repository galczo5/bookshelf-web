# Notes Durability + Tag-Rename Atomicity Tests — Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`. Add integration tests
at the **server-action layer** that defend two risks against the real
Postgres harness stood up in Phase 1:

- **Risk #6 — Notes save silently drops content.** Prove an explicit note
  save survives a write → re-read round-trip, and that a failed save surfaces
  as `{ ok: false }` while persisting nothing partial.
- **Risk #4 — Tag rename non-atomicity.** Prove a global rename/merge either
  fully re-points every affected book to the surviving tag (deduped) and
  removes the old tag, or leaves the source untouched — never an in-between.
  The `needs_confirm` gate must mutate nothing.

## Current State Analysis

What exists today (verified by reading the source, not inferred):

- **Notes action layer** — `src/app/actions/notes.ts` exposes
  `createNoteAction`, `updateNoteAction`, `deleteNoteAction`. Each resolves
  `userId` from the NextAuth session (`auth()` → `getUserIdByEmail`),
  validates required fields + non-empty body, calls the lib, and on any lib
  error returns `{ ok: false, message }`. Session-less calls `redirect("/signin")`.
- **Notes lib** — `src/lib/notes.ts`: `createNote` checks the book belongs to
  the user before inserting; `updateNote` / `deleteNote` gate on an `exists()`
  subquery over `books.user_id` and **throw** `"Note not found or access denied"`
  when the row isn't owned. `listBookNotes(bookId, userId)` is the read-back
  surface (ordered by `created_at asc`).
- **There is NO autosave/debounce anywhere** — saves are explicit FormData
  round-trips. The PRD's "5s persistence / autosave" NFR is unimplemented;
  Phase 2 tests **what exists** (the explicit-save round-trip), not a timer.
- **Tag rename action** — `renameTagAction` (`src/app/actions/tags.ts:120`)
  is a discriminated-union state machine: validates name (non-empty, ≤50),
  short-circuits a same-name-modulo-case no-op to `renamed`, and when a
  collision exists **without** `confirmedMerge=1` returns
  `{ ok:false, kind:"needs_confirm", … }` **without mutating**. With
  `confirmedMerge=1` (or no collision) it calls `renameOrMergeTag`.
- **Tag rename/merge lib** — `renameOrMergeTag` (`src/lib/tags.ts:142`):
  no collision → single `UPDATE tags SET name` (atomic by nature);
  collision → a `db.transaction()` that **INSERTs** `book_tags` re-pointing
  source's books to the target (`onConflict … doNothing` dedupes), **then
  DELETEs** the source tag. Load-bearing invariant at `src/lib/tags.ts:201`:
  _"INSERT must precede DELETE — CASCADE on tags.id drops unmigrated
  book_tags rows if reversed."_ This ordering is the exact atomicity
  regression Risk #4 must catch.
- **Phase 1 harness** — `tests/helpers/db.ts`: `resetDb()` truncates
  `notes, book_tags, book_drafts, books, tags, users` and re-seeds the single
  `TEST_USER`; `seedDraft`, `readState` exist. `tests/integration/rename-on-edit.test.ts`
  is the reference action-test pattern: `vi.mock("@/auth")`,
  `vi.mock("next/cache")`, per-test `vi.mocked(auth).mockResolvedValue(...)`,
  and an **inline** `seedConfirmedBook` helper. There is **no shared helper**
  for a confirmed/library book or a second user yet.
- **Vitest** is configured (`vitest.config.ts`, `npm run test:integration`
  scoped to `tests/integration`) against the Docker Postgres.

## Desired End State

Two new integration test files — `tests/integration/notes.test.ts` and
`tests/integration/rename-tag.test.ts` — pass against the Docker Postgres via
`npm run test:integration`, plus shared `seedBook` / `seedSecondUser` helpers
in `tests/helpers/db.ts`. The test-plan §3 Phase 2 row reads `complete` once
the change's Progress is fully checked, and cookbook §6 reflects the notes +
tag-rename patterns. The atomicity test is proven non-tautological by a
manual mutation check (reverse the INSERT/DELETE ordering → union test goes red).

### Key Discoveries:

- Merge atomicity lives in `src/lib/tags.ts:189-206`; the regression that
  matters is reversing INSERT/DELETE, which the **union-preservation**
  assertion catches without any fault injection.
- `renameTagAction` gates merge behind `confirmedMerge=1`
  (`src/app/actions/tags.ts:146`) — the merge path is reachable from the
  action layer, so atomicity can be tested through the action (per §3 "action
  layer") while also covering the confirm gate.
- Notes ownership is enforced by `exists()` subqueries
  (`src/lib/notes.ts:58-66`, `83-91`); cross-user mutation throws → action
  returns `{ ok:false }`. This is the cheap, real signal for the per-user
  WHERE clauses.
- `resetDb` only seeds `TEST_USER`; cross-user tests need a second user +
  a book owned by them — the reason for `seedSecondUser`.

## What We're NOT Doing

- **No autosave/debounce/timer tests** — that behavior does not exist in the
  code (explicit-save only). Not flagging it as a backlog item here either;
  the divergence belongs to the test-plan/PRD, not this change.
- **No fault-injection rollback test** (temporary triggers, mocked trx). The
  union-preservation assertion is the higher-signal, cheaper proof; a generic
  "Postgres rolls back on throw" test mostly re-tests Postgres.
- **No session-less / expired-session sweep** — that is Risk #7, rollout
  Phase 3. Phase 2 covers ownership _within a valid session_ only.
- **No lib mocking for the notes failure path** — "test what exists" uses the
  real error paths (ownership failure, empty body, missing id) that already
  return `{ ok:false }` without persisting.
- **No new tables, migrations, or schema changes.** Tests only.
- **No Drive / OpenAI fakes** — notes and tags never touch external services.

## Implementation Approach

Test through the **server actions** (call them directly with `FormData`, no
HTTP layer), mocking only `@/auth` (session) and `next/cache`
(`revalidatePath`) per the established `rename-on-edit.test.ts` pattern.
Read state back through the real lib read functions (`listBookNotes`,
`listBookTags`, `listUserTagsWithCount`) so assertions verify persisted rows,
not the action's return value alone. Extend the shared harness with
`seedBook` and `seedSecondUser` so both files (and future phases) seed library
state in one call. Land notes first (it exercises the new helpers), then
tag-rename, then housekeeping.

## Phase 1: Shared seed helpers + Notes durability tests (Risk #6)

### Overview

Add the confirmed-book and second-user seed helpers to the shared harness,
then write the notes integration tests that consume them.

### Changes Required:

#### 1. Shared seed helpers

**File**: `tests/helpers/db.ts`

**Intent**: Give every Phase 2+ test a one-call way to seed a confirmed
library book (for `TEST_USER` or any user) and a second user, so cross-user
ownership cases are cheap and `resetDb`'s single-user seed isn't duplicated
inline per file.

**Contract**: Add `seedBook(opts?: { userId?: string; title?: string; author?: string | null }): Promise<string>` —
inserts a `books` row with `review_state: "confirmed"`, sensible drive
placeholders (`drive_file_id`/`drive_file_name`), returns the new book id;
`userId` defaults to `TEST_USER.id`. Add
`seedSecondUser(): Promise<{ id: string; email: string }>` — inserts a second
fixed-UUID user and returns it. Both reuse the existing `db` import and must
be safe to call after `resetDb()`. Do not change `resetDb`'s truncate list
(it already CASCADEs the new rows).

#### 2. Notes durability + ownership tests

**File**: `tests/integration/notes.test.ts` (new)

**Intent**: Prove notes saves round-trip durably, failed saves persist
nothing, and a note owned by another user cannot be mutated within a valid
session.

**Contract**: Follow `rename-on-edit.test.ts` conventions —
`vi.mock("@/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }))`,
`vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))`, `beforeEach`
does `resetDb()` + `vi.mocked(auth).mockResolvedValue({ user: { email: TEST_USER.email } })`.
Call actions with `(null, formData)`. Read back through `listBookNotes`.
Cases to cover:

- **create round-trip**: `createNoteAction` → `{ ok:true }`; `listBookNotes`
  returns the note with the exact body.
- **update round-trip**: seed a note, `updateNoteAction` with new body →
  `{ ok:true }`; re-read shows the new body and `updatedAt > createdAt`.
- **delete**: `deleteNoteAction` → `{ ok:true }`; `listBookNotes` no longer
  returns it.
- **empty body rejected, nothing persisted**: `createNoteAction` / `updateNoteAction`
  with blank body → `{ ok:false }`; note count unchanged (no orphan/empty row).
- **missing ids rejected**: blank `bookId` / `noteId` → `{ ok:false }`.
- **cross-user denial**: with the active session = `TEST_USER`, attempt to
  `updateNoteAction` / `deleteNoteAction` a note attached to a `seedSecondUser`
  book → `{ ok:false }`; re-read confirms the second user's note is unchanged.

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration`
- Lint passes: `npm run lint`
- New file present: `tests/integration/notes.test.ts`

#### Manual Verification:

- Test names read as user/business behavior ("rejects empty note without
  persisting"), not implementation mirrors.
- Each assertion's expected value comes from the requirement (the saved body),
  not from re-deriving the lib's own SQL.

**Implementation Note**: After this phase's automated verification passes,
pause for confirmation before Phase 2.

---

## Phase 2: Tag-rename atomicity + ownership tests (Risk #4) + housekeeping

### Overview

Write the tag-rename integration tests (the atomicity core via
union-preservation through the action), then update cookbook §6 and stamp the
test-plan §3 status.

### Changes Required:

#### 1. Tag-rename atomicity + gate + ownership tests

**File**: `tests/integration/rename-tag.test.ts` (new)

**Intent**: Prove a confirmed merge re-points every source book to the target
(deduped) and deletes the source; the confirm gate mutates nothing; plain
rename and no-op behave; validation rejects without writing; and another
user's tag can't be renamed.

**Contract**: Same action-test harness as Phase 1. Seed books via the new
`seedBook` helper; create tags + book_tags through the real lib
(`addTagToBook` / `applyTagsToBooks`) so fixtures match production shape. Read
back through `listBookTags` and `listUserTagsWithCount`. Cases:

- **Union-preservation merge (the atomicity assertion)**: source tag `S` on
  books `{A,B}`, target tag `T` on books `{B,C}`. `renameTagAction` with
  `tagId=S`, `newName=T.name`, `confirmedMerge=1` → `{ ok:true, kind:"merged" }`.
  Assert: `T` is on exactly `{A,B,C}` (B deduped, count 3), `S` no longer
  exists in `listUserTagsWithCount`, and no `book_tags` row was lost. This is
  the regression that a reversed INSERT/DELETE ordering breaks.
- **Confirm gate mutates nothing**: with a real collision and `confirmedMerge`
  absent/`0` → `{ ok:false, kind:"needs_confirm", … }`; both tags and all
  book_tags are unchanged from the seeded state.
- **Plain rename (no collision)**: `renameTagAction` to a fresh name →
  `{ ok:true, kind:"renamed" }`; `listUserTagsWithCount` shows the new name,
  same id, same book count.
- **No-op same name modulo case/whitespace**: `newName` = existing name with
  different case → `{ ok:true, kind:"renamed" }`; nothing changed.
- **Validation**: empty name and >50 chars → `{ ok:false, kind:"error" }`;
  tag table unchanged.
- **Cross-user denial**: active session = `TEST_USER`; `tagId` belongs to a
  `seedSecondUser` tag → `{ ok:false, kind:"error" }` (tag-not-found); the
  second user's tag is unchanged.

#### 2. Cookbook + test-plan housekeeping

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect the patterns this phase shipped and advance the rollout
status so the orchestrator resumes correctly.

**Contract**: In §6.6 (per-rollout-phase notes) append a 2–3 line note for
Phase 2 (notes round-trip + tag-merge union-preservation patterns, the
`seedBook`/`seedSecondUser` helpers). Confirm §6.2/§6.3 still describe the
shared-helper usage (extend if the new helpers change the recommended call).
Leave §3 status to be flipped to `complete` by the `/10x-test-plan`
orchestrator when Progress is fully checked (this plan only stamps the
cookbook note).

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration`
- Lint passes: `npm run lint`
- New file present: `tests/integration/rename-tag.test.ts`

#### Manual Verification:

- **Mutation check (proves the test has teeth)**: temporarily reverse the
  INSERT/DELETE order in `renameOrMergeTag` (`src/lib/tags.ts`), run
  `npm run test:integration`, confirm the union-preservation test FAILS, then
  revert. The test must go red for the right reason.
- Cookbook §6 note reads accurately against the shipped tests.

**Implementation Note**: After automated verification passes and the mutation
check is confirmed, this change is ready to archive; the `/10x-test-plan`
orchestrator marks §3 Phase 2 `complete`.

---

## Testing Strategy

### Integration Tests:

- Notes: create/update/delete round-trips, empty-body + missing-id rejection,
  cross-user denial — all through the actions, read back through `listBookNotes`.
- Tag rename: union-preservation merge, confirm-gate-mutates-nothing, plain
  rename, no-op, validation, cross-user denial — through `renameTagAction`,
  read back through `listBookTags` / `listUserTagsWithCount`.

### Manual Testing Steps:

1. `npm run test:integration` — both new files green against Docker Postgres.
2. Mutation check on the merge ordering (Phase 2 manual verification).
3. Skim test names for behavior-framing vs implementation-mirroring.

## Migration Notes

None — no schema changes. Tests only, against the existing Phase 1 harness.

## References

- Rollout plan: `context/foundation/test-plan.md` §2 (Risk #4, #6 +
  Risk Response Guidance), §3 Phase 2
- Reference test pattern: `tests/integration/rename-on-edit.test.ts`
- Atomicity invariant under test: `src/lib/tags.ts:189-206`
- Notes ownership under test: `src/lib/notes.ts:53-96`
- Harness: `tests/helpers/db.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared seed helpers + Notes durability tests

#### Automated

- [x] 1.1 Integration suite passes: `npm run test:integration`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 New file present: `tests/integration/notes.test.ts`

#### Manual

- [x] 1.4 Test names read as behavior, not implementation mirrors
- [x] 1.5 Assertion oracles come from requirements, not re-derived SQL

### Phase 2: Tag-rename atomicity + ownership tests + housekeeping

#### Automated

- [ ] 2.1 Integration suite passes: `npm run test:integration`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 New file present: `tests/integration/rename-tag.test.ts`

#### Manual

- [ ] 2.4 Mutation check: reversed INSERT/DELETE ordering makes the union test FAIL, then reverted
- [ ] 2.5 Cookbook §6 per-phase note reads accurately against the shipped tests
