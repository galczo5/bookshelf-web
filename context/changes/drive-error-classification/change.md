---
change_id: drive-error-classification
title: Defend Risk #3 — Drive API error misclassification (error-mapper unit + upload-path integration)
status: implemented
created: 2026-06-25
updated: 2026-06-25
archived_at: null
---

## Notes

Next most important uncovered risk from `context/foundation/test-plan.md` (§2 Risk Map, ordered by impact × likelihood). Phase 1 covered Risks #1/#2; Phase 2 (`testing-notes-and-tag-rename-integrity`) covered #4/#6. Risk #3 is the next row.

**Risk #3 — Drive API error misclassification (Medium × High).** A transient 5xx / 429 / 401-token-expired / quota error gets mapped to "not found" (or vice versa); the user sees the wrong outcome, or a transient failure becomes permanent. Can cascade into Risk #1 (import non-atomicity).

What would prove protection (test-plan §2 Risk Response Guidance, row #3):

- Each documented Drive error class maps to a stable, user-visible outcome, with a recorded fixture per error code.
- Transient classes are retried; terminal classes surface a clear user error.

Must challenge: "200 means success" — Drive can return 200 with an error envelope. "The SDK throws on errors" — `googleapis` surfaces some errors as status, others as exceptions.

`/10x-research` must ground: the full set of Drive responses the import / upload / connection-check code actually handles, which classes are retried, and where token-refresh sits.

Likely cheapest layer: unit on the error-mapper + integration on the upload path. Anti-patterns to avoid: implementation mirror (re-asserting the mapping the function builds), over-mocking the `googleapis` client, not exercising the retry decision.

This is Risk #3 of Phase 3 (`Drive error envelope + AI privacy + session boundary`, currently `not started`), scoped here to Risk #3 alone per the "next most important risk" request.
