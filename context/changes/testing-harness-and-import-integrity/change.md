---
change_id: testing-harness-and-import-integrity
title: Test harness bootstrap and import/migration integrity (test-plan Phase 1)
status: new
created: 2026-06-02
updated: 2026-06-02
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Harness bootstrap + import/migration integrity".

Risks covered: #1 (import non-atomicity — DB row written but Drive bytes missing, or the reverse), #2 (migration drift between Docker-local Postgres and Render Postgres).

Test types planned: integration (action + real Postgres + fake Drive client) for Risk #1; contract / replay (migration forward + rollback against a Render-major Postgres image) for Risk #2.

Risk response intent (from §2 Risk Response Guidance — do not re-derive from the implementation):
- Risk #1: prove that a successful import means both the DB row AND the Drive bytes are present; a Drive failure mid-upload leaves NEITHER state behind and surfaces a clean user-visible error. Challenge "the action returned 200, therefore both writes succeeded."
- Risk #2: prove every migration applies forward against a fresh Postgres matching the Render major version, rolls back cleanly, and the resulting schema is identical to what dev sees. Challenge "it worked locally, so it'll work on Render."

This change also stands up the test harness (Vitest + integration harness against the Docker Compose Postgres). The harness is load-bearing for §3 Phase 2 and Phase 3; do not skip it or roll it into a different change.
