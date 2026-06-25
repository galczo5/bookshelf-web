---
change_id: ai-enrichment-privacy-boundary
title: Test Risk #5 — AI enrichment privacy boundary + wrong-identity confirmation gate
status: implementing
created: 2026-06-25
updated: 2026-06-25
archived_at: null
---

## Notes

Next test-rollout risk from `context/foundation/test-plan.md` (Risk Map #5, the
highest-ranked risk not yet covered — #3 shipped as `drive-error-classification`,
#7 still pending below this one).

**Risk #5 — AI enrichment violates the privacy boundary OR persists a wrong identity.**
Prompt construction emits something other than the allow-listed strings (filename,
embedded title/author/ISBN, front-matter), OR the confirmation gate auto-accepts a
low-confidence proposal that ends up identifying the wrong book.
Impact: High · Likelihood: Medium.
Source: PRD §Business Logic, PRD §NFR "Privacy of book content", PRD FR-003/004;
hot-spot `src/lib/enrichment/` (4 commits/30d), `src/lib/tag-suggestions/` (4 commits/30d).

**What would prove protection** (test-plan §2 Risk Response):

- Prompt-construction path emits ONLY allow-listed strings — no book-body bytes.
- Confirmation gate requires explicit per-field accept; no auto-accept paths exist anywhere.
- Provenance is shown alongside each proposal; the reject path persists nothing.

**Must challenge:** "we only send small strings, so we're safe"; "the LLM said X, so X
is correct"; "front-matter is metadata-shaped, so it's allowed."

**Likely cheapest layer:** contract test on prompt construction (negative: assert no
forbidden bytes) + integration on the gate (positive: reject path persists nothing).

**Anti-patterns to avoid:** snapshotting the LLM response (couples to the model); only
testing the accept path; asserting on the prompt template rather than the assembled body.

Part of test-plan §3 Phase 3 ("Drive error envelope + AI privacy + session boundary").
