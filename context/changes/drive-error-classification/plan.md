# Drive API Error-Classification Characterization Tests Implementation Plan

## Overview

Defend **Risk #3 — Drive API error misclassification** (`context/foundation/test-plan.md` §2) with characterization tests. A transient `5xx`/`429`/live-`401`/quota error can be mapped to the wrong user-visible outcome (or a transient made permanent). This change pins how every Drive-touching path classifies errors **today**, and explicitly labels the misclassification gaps it finds — it does **not** change production behavior.

Scope decisions (from planning interview):

- **Tests only** — characterize current behavior; no classifier or retry layer is introduced. The test plan's "cheapest layer: unit on the error-mapper" presupposes a mapper that does not exist; we test the scattered call-site behavior instead.
- **All Drive-touching actions/routes** are covered, not just the upload path.
- **Known-wrong behaviors are asserted and labeled** `KNOWN GAP` (passing tests that pin today's behavior, named/commented to flag it), plus a §6.6 phase note — so they double as a breadcrumb for the future classifier change.

## Current State Analysis

There is **no central Drive error classifier**. Classification is scattered and only ever distinguishes two things: a session pre-flight `DriveAuthError`, and (at two sites) a raw `404`. Everything else collapses into a single generic outcome per call site.

Enumerated contracts (the oracle these tests assert against):

| Call site                                                              | `DriveAuthError` (pre-flight)                                                                   | raw `404`                                                                               | transient / live-`401` / quota / `5xx`                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/drive/client.ts:9` `getDriveClient`                           | **throws** `DriveAuthError` on `!access_token` or `session.error === "RefreshAccessTokenError"` | —                                                                                       | does **not** classify live API errors                                       |
| `confirm-review.ts:102` (upload)                                       | `signOut` + `redirect("/signin?expired=1")`                                                     | rollback uploaded files + `{ok:false,"Could not finish import…"}`                       | same generic rollback path — live-`401` is **not** re-auth'd (**GAP**)      |
| `books.ts` `trashBookAction` (`:71`,`:93`)                             | `signOut`+redirect                                                                              | `files.get`/`move` `404` → warn + proceed **DB-only**                                   | `{ok:false,"Drive file lookup/move failed: {msg}"}` — not retried (**GAP**) |
| `books.ts` `restoreBookAction` (`:182`,`:221`)                         | `signOut`+redirect                                                                              | `404` → DB-only restore                                                                 | generic `{ok:false,…}` — not retried (**GAP**)                              |
| `check-drive.ts:23`                                                    | `signOut`+redirect                                                                              | (n/a)                                                                                   | `{ok:false, message:e.message}`                                             |
| `drive-sync.ts` `runSyncCheckNowAction:22`, `importFromDriveAction:76` | `signOut`+redirect                                                                              | (n/a)                                                                                   | **re-throws** raw error                                                     |
| `enrich-metadata.ts:134` (rename working copy)                         | `signOut`+redirect                                                                              | (n/a)                                                                                   | swallowed → `renameWarning:true` + `renamePending` set                      |
| `api/books/[id]/download/route.ts:48`                                  | `redirect("/signin")` (client throw only)                                                       | **maps `404`→`502`** "Could not reach Google Drive" (**MISCLASS**)                      | any `files.get` error → `502`                                               |
| `api/books/[id]/epub-metadata/route.ts:83`                             | `{available:false, reason:"drive_error"}`                                                       | any `files.get` error → `reason:"drive_error"` (**MISCLASS** — `404` indistinguishable) | → `reason:"drive_error"`                                                    |

### Key Discoveries

- **`googleapis`/Gaxios surfaces HTTP errors as thrown errors** carrying a numeric `.code` (and `.response.status`, `.errors[]` envelope). The only property the codebase reads is `(e as {code?: number}).code` (`books.ts:72,94,193,222`). Tests must build error objects shaped like this.
- **Live-`401` gap is real**: `getDriveClient` throws `DriveAuthError` only from _session_ state. A token that expires mid-call returns a raw `.code===401` from `drive.files.*`, which is **not** an instanceof `DriveAuthError`, so it never triggers re-auth — it hits the generic/rethrow path. This is the headline instance of Risk #3.
- **Test harness is close but missing pieces** (`tests/helpers/drive-fake.ts`): `failNextCreate`/`failNextDelete(err)` exist, but `files.get` is `notImplemented` (throws), and there is no fail-injection for `get`/`list`/`update`. The trash/restore and route paths call `files.get`, so the fake must grow these.
- **`confirm-review.test.ts:67` already covers** a generic mid-upload failure (`new Error("Drive 500")`) → generic message + no-rollback invariant. We add only the _classification-specific_ case there (live-`401` ≠ `DriveAuthError`), not a duplicate.
- **Conventions** (`tests/integration/confirm-review.test.ts`, cookbook §6.2/§6.3): call actions directly with `(null, FormData)`; `vi.mock("@/auth")` + `vi.mock("@/lib/drive/client")`; inject the fake via `vi.mocked(getDriveClient).mockResolvedValue(driveFake.client)`; catch `NEXT_REDIRECT` with `isRedirectError` + `getURLFromRedirectError`; DB helpers `resetDb`/`seedDraft`/`seedBook`/`readState` from `tests/helpers/db.ts`.

## Desired End State

A new integration test file pins the error-classification outcome of every Drive-touching path against the table above, with the three misclassification gaps asserted and labeled `KNOWN GAP` / `KNOWN MISCLASS`. The drive fake can simulate any Gaxios-style error on any operation. `npm test` is green; reversing a classification branch in the code under test (e.g. dropping the `code===404` check in `books.ts`, or making `getDriveClient` catch live-`401`) turns a test red. A §6.6 phase note and a cookbook pattern record the gaps for the future classifier change.

## What We're NOT Doing

- **No production code changes** — no `classifyDriveError()`, no retry/backoff, no fix to the live-`401` or `404→502` gaps. Those are explicitly deferred; this change only documents them via tests.
- **No coverage of Risk #5 (AI privacy) or Risk #7 (session boundary)** — they share test-plan Phase 3 but are separate changes. The Phase 3 status row stays partial.
- **No live Google OAuth / real Drive round-trip** — excluded per test-plan §7. The boundary is mocked.
- **No unit tests on a "mapper"** — there is no mapper to unit-test; all assertions are integration-level at the call sites.

## Implementation Approach

Phase 1 grows the shared drive fake so any operation can throw a realistic Gaxios-style error; this is the foundation every assertion depends on. Phase 2 writes one focused integration file that walks the contract table, reusing existing DB/auth/fake conventions, then records the gaps in the test plan. Tests assert the **observable outcome** (returned state object, thrown redirect URL, HTTP `Response` status/JSON, DB state, and delete-call counts) — never the SQL string or the function's internal branch — so they survive refactors but catch behavior changes.

## Phase 1: Drive-error test harness extensions

### Overview

Extend `tests/helpers/drive-fake.ts` so the fake can (a) return a file from `files.get` and (b) throw a caller-supplied error from `get`/`list`/`update`/`create`/`delete`, and add a small Gaxios-style error builder.

### Changes Required

#### 1. Gaxios-style error builder

**File**: `tests/helpers/drive-fake.ts`

**Intent**: Provide a single helper so every test constructs Drive errors the same way the SDK surfaces them, instead of hand-rolling `(err as any).code = …` inline. Keeps the live-`401` / `429` / `5xx` / `404` fixtures uniform.

**Contract**: Export `driveError(code: number, message?: string): Error` returning an `Error` with a numeric `.code` (and a matching `.status`) set, matching what `books.ts` reads via `(e as {code?: number}).code`. No external deps.

#### 2. Implement `files.get` and broaden fail-injection in the fake

**File**: `tests/helpers/drive-fake.ts`

**Intent**: The trash/restore actions and both API routes call `drive.files.get`; today the fake throws "not implemented", so those paths are untestable. Implement `get` against the in-memory map and let any operation be forced to throw a chosen error so error-class fixtures can target the exact call that fails.

**Contract**: `files.get({fileId, fields?, alt?}, opts?)` returns `{data}` for a present file (supporting at least `name`, `webContentLink`, and `alt:"media"` → `arraybuffer` of `contentBytes`) and throws `driveError(404)` for an absent id. Add `failNextGet/failNextList/failNextUpdate(err)` to the `DriveFake` interface alongside the existing `failNextCreate/failNextDelete`, each consumed once and cleared by `reset()`. Preserve current `deleteCallCount` semantics and the existing `failNext*` behavior.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Existing suite still green (no regression in helper consumers): `npm test`

#### Manual Verification

- A scratch assertion confirms `files.get` returns bytes for a created file and throws a `404`-coded error for an unknown id (removed before commit).

---

## Phase 2: Call-site characterization tests + gap documentation

### Overview

One integration file asserting the classification outcome of every Drive-touching path in the contract table, with gap cases labeled, plus the test-plan documentation updates.

### Changes Required

#### 1. New characterization test file

**File**: `tests/integration/drive-error-classification.test.ts`

**Intent**: Pin each call site's current error-class → outcome mapping so a future refactor that changes classification fails loudly, and encode the three known gaps as labeled passing tests.

**Contract**: A Vitest integration suite following §6.2/§6.3 conventions (`resetDb`, `vi.mock("@/auth")`, `vi.mock("@/lib/drive/client")`, fake via `getDriveClient`). Grouped `describe` blocks asserting **observable outcomes only**:

- **confirm-review**: a live `driveError(401)` from `failNextCreate` → returns the generic `{ok:false,"Could not finish import…"}` and does **not** redirect to `/signin?expired=1` — named `KNOWN GAP: live 401 is not re-auth'd`. Contrast case: a thrown `DriveAuthError` → `redirect("/signin?expired=1")`. (Reuses the existing fake-failure pattern at `confirm-review.test.ts:67`.)
- **books trash/restore**: `failNextGet(driveError(404))` → book reaches DB-only trashed/restored state (assert via `readState`), Drive not required; `failNextGet(driveError(429))` (and `503`) → `{ok:false,"Drive file lookup failed: …"}`, DB unchanged, and the operation is attempted exactly once — named `KNOWN GAP: transient not retried`. Use `seedBook`/`seedDraft` for fixtures.
- **check-drive**: `DriveAuthError` → redirect; a `driveError(500)` from `checkDriveConnection` → `{ok:false, message:…}`.
- **drive-sync** (`runSyncCheckNowAction`, `importFromDriveAction`): `DriveAuthError` → redirect `/signin?expired=1`; a non-auth `driveError(500)` re-throws (assert the thrown error is **not** a redirect).
- **enrich-metadata** rename: a non-auth `driveError(500)` on the rename path → `{ok:true, renameWarning:true}` with `renamePending` persisted (assert via DB/return), not a redirect.
- **download route** (`GET`): `failNextGet(driveError(404))` → `Response` status `502` — named `KNOWN MISCLASS: 404 surfaced as 502`; `driveError(500)` → `502` too (collapse).
- **epub-metadata route** (`GET`): `failNextGet(driveError(404))` and `driveError(500)` both → JSON `{available:false, reason:"drive_error"}` — named `KNOWN MISCLASS: 404 indistinguishable from transient`.

Each gap/misclass test carries a one-line comment pointing at the source line and stating what reversing it would prove (the regression trigger).

#### 2. Cookbook pattern for Drive-error tests

**File**: `context/foundation/test-plan.md` (§6, new sub-section "6.7 Adding a Drive-error classification test")

**Intent**: Record how to add a Drive-error test (build the error with `driveError(code)`, inject via `failNext*`, assert the observable outcome) so the pattern is reusable when the classifier is eventually built.

**Contract**: A short prose sub-section mirroring the style of §6.2/§6.3, referencing `tests/integration/drive-error-classification.test.ts` as the example and the new `drive-fake.ts` helpers.

#### 3. Phase note recording the gaps

**File**: `context/foundation/test-plan.md` (§6.6 Per-rollout-phase notes)

**Intent**: Leave a durable breadcrumb that the live-`401`, no-retry, and `404→502`/`drive_error` collapses are **known and intentionally characterized, not fixed** — so the future Risk #3 classifier change knows exactly which tests to flip.

**Contract**: A 2–4 line note naming the three gaps, the asserting test file, and that they are test-only characterizations pending a classifier.

### Success Criteria

#### Automated Verification

- New suite passes: `npm test`
- Targeted run is green: `npx vitest run tests/integration/drive-error-classification.test.ts`
- Lint passes: `npm run lint`
- Full integration suite still green (no regression): `npm run test:integration`

#### Manual Verification

- Sanity-check the gap assertions are real: temporarily delete the `code === 404` branch in `books.ts` trash path and confirm the corresponding test goes red; temporarily make `getDriveClient`/`confirm-review` treat `code===401` as `DriveAuthError` and confirm the `KNOWN GAP: live 401` test goes red. Revert both.
- The §6.6 note and §6.7 cookbook entry read clearly to someone who didn't plan this change.

**Implementation Note**: After Phase 2's automated verification passes, pause for human confirmation of the manual gap-reversal check before considering the change complete.

---

## Testing Strategy

### Integration Tests

- One file, `tests/integration/drive-error-classification.test.ts`, organized by call site, asserting the contract table. All boundaries (auth, Drive client) mocked per existing conventions; real Postgres via the Phase 1 harness for the DB-state assertions (trash/restore).

### Manual Testing Steps

1. Run `npx vitest run tests/integration/drive-error-classification.test.ts` — all green, including `KNOWN GAP`/`KNOWN MISCLASS` cases.
2. Reverse one classification branch in source (e.g. `books.ts` `code===404`) → confirm the matching test fails → revert.
3. Read §6.6 + §6.7 in `test-plan.md` for clarity.

## Migration Notes

None — no schema or production code changes.

## References

- Risk source: `context/foundation/test-plan.md` §2 Risk #3, §2 Risk Response Guidance row #3, §3 Phase 3
- Change identity: `context/changes/drive-error-classification/change.md`
- Conventions: `tests/integration/confirm-review.test.ts`, `tests/helpers/drive-fake.ts`, cookbook §6.2/§6.3
- Call sites: `src/lib/drive/client.ts:9`, `src/app/actions/books.ts:71`, `src/app/actions/confirm-review.ts:102`, `src/app/actions/check-drive.ts:23`, `src/app/actions/drive-sync.ts:22`, `src/app/actions/enrich-metadata.ts:134`, `src/app/api/books/[id]/download/route.ts:48`, `src/app/api/books/[id]/epub-metadata/route.ts:83`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Drive-error test harness extensions

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Existing suite still green: `npm test`

#### Manual

- [x] 1.3 Scratch assertion confirms `files.get` returns bytes and throws 404-coded error for unknown id

### Phase 2: Call-site characterization tests + gap documentation

#### Automated

- [ ] 2.1 New suite passes: `npm test`
- [ ] 2.2 Targeted run green: `npx vitest run tests/integration/drive-error-classification.test.ts`
- [ ] 2.3 Lint passes: `npm run lint`
- [ ] 2.4 Full integration suite still green: `npm run test:integration`

#### Manual

- [ ] 2.5 Gap assertions verified by reversing a classification branch (books 404; confirm-review live-401) and confirming red, then revert
- [ ] 2.6 §6.6 note and §6.7 cookbook entry read clearly
