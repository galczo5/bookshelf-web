# Drive API Error-Classification Characterization Tests — Plan Brief

> Full plan: `context/changes/drive-error-classification/plan.md`

## What & Why

Defend **Risk #3 — Drive API error misclassification** (`context/foundation/test-plan.md` §2): a transient `5xx`/`429`/live-`401`/quota error getting mapped to the wrong user-visible outcome (or a transient becoming permanent). We pin how every Drive-touching path classifies errors **today** and explicitly label the misclassification gaps — without changing production behavior.

## Starting Point

There is **no central error classifier**. Classification is scattered and only ever distinguishes two things: a session pre-flight `DriveAuthError` and (at two sites) a raw `404`; everything else collapses to one generic outcome per site. The drive fake (`tests/helpers/drive-fake.ts`) can fail `create`/`delete` but has no `files.get` and no fail-injection for `get`/`list`/`update`.

## Desired End State

A new integration file pins each call site's error-class → outcome mapping, with three gaps asserted and labeled (`KNOWN GAP: live 401 not re-auth'd`, `KNOWN GAP: transient not retried`, `KNOWN MISCLASS: 404→502 / 404 indistinguishable`). `npm test` is green; reversing any classification branch in source turns a test red. The gaps are recorded in the test plan for the future classifier change.

## Key Decisions Made

| Decision                 | Choice                                      | Why (1 sentence)                                                                                       | Source |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| Production code vs tests | Tests only                                  | Stay true to the test-rollout mandate; the "error-mapper" the plan would unit-test does not exist yet. | Plan   |
| Call-site coverage       | All Drive-touching actions/routes           | Broadest regression net across the scattered classification sites.                                     | Plan   |
| Known-wrong behaviors    | Assert current behavior + label `KNOWN GAP` | Gives regression protection now and a breadcrumb for the future classifier.                            | Plan   |
| Phase structure          | 2 phases (harness → tests+docs)             | Merged the call-site tests and docs into one phase after the shared fake work.                         | Plan   |

## Scope

**In scope:** characterization tests for confirm-review, books trash/restore, check-drive, drive-sync (×2), enrich-metadata rename, and the download + epub-metadata API routes; drive-fake extensions; test-plan §6.6/§6.7 docs.

**Out of scope:** any production fix (classifier, retry, live-401/404→502 gaps); Risk #5 and #7 (separate Phase 3 changes); live OAuth round-trip.

## Architecture / Approach

Phase 1 grows the shared drive fake (Gaxios-style `driveError(code)` builder, real `files.get`, `failNextGet/List/Update`). Phase 2 writes one integration file walking the contract table, asserting **observable outcomes only** (returned state, redirect URL, HTTP `Response`, DB state, delete-call counts) so tests survive refactors but catch behavior changes, then records the gaps in the test plan.

## Phases at a Glance

| Phase                 | What it delivers                                        | Key risk                                                                                            |
| --------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1. Harness extensions | Fake can simulate any Drive error + serve `files.get`   | Over-broadening the fake beyond what tests need                                                     |
| 2. Tests + docs       | Contract-table characterization suite + §6.6/§6.7 notes | A green test encoding wrong behavior misleading a reader — mitigated by explicit `KNOWN GAP` naming |

**Prerequisites:** Phase 1 Postgres/Vitest harness (already in place since test-plan §3 Phase 1).
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes `googleapis`/Gaxios surfaces HTTP errors as thrown errors with a numeric `.code` — the only shape the code reads (`books.ts:72`). The fake's `driveError` mirrors this; if a real error shape differs, a fixture may not match the branch.
- `KNOWN GAP` passing tests can mislead a careless reader; mitigated by explicit test names + source-line comments stating the regression trigger.
- The test-plan Phase 3 row stays **partial** (this is only Risk #3 of #3/#5/#7).

## Success Criteria (Summary)

- Every Drive-touching path's current error-class → outcome mapping is asserted and green.
- Reversing a classification branch in source (e.g. `books.ts` `code===404`, or making live-`401` re-auth) turns a specific test red.
- The three misclassification gaps are documented in `test-plan.md` for the future classifier change.
