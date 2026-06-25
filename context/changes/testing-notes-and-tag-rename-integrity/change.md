---
change_id: testing-notes-and-tag-rename-integrity
title: Notes durability + tag-rename atomicity tests
status: implementing
created: 2026-06-25
updated: 2026-06-25
archived_at: null
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md`: "Notes durability + tag-rename atomicity". Integration tests at the action layer, reusing the Postgres harness from Phase 1 (`testing-harness-and-import-integrity`).

Risks covered:

- **Risk #6 — notes save silently drops content.** Prove a note edit survives a refresh within 5s of the last keystroke (or explicit save), and a simulated mid-save error surfaces to the user rather than dropping silently. Write → re-read round-trip plus a forced-error path.
- **Risk #4 — tag rename non-atomicity.** Prove a global rename either fully applies to every affected book AND removes the old tag (merge-on-collision per the shipped change), or rolls back entirely — after a simulated mid-rename crash the DB is in one of those two states, never in-between.

Next: `/10x-research` to ground the note-save and tag-rename action contracts before planning.
