# DB Seed — 50 Public-Domain Books — Plan Brief

> Full plan: `context/changes/db-seed/plan.md`

## What & Why

Add a re-runnable `npm run db:seed` command that prefills a local dev database with 50 public-domain books — covers, tags, sample notes, and a few deliberately-incomplete books — so the whole UI (library, tag filter, search, notes, trash/restore) has realistic data without a live Google Drive or a real import. Each book is backed by a generated mock "empty" epub committed in the repo.

## Starting Point

No seed mechanism exists today — data only enters via the real import flow or one-row-at-a-time e2e helpers. The schema is stable: books are user-owned, review-gated (`confirmed` + non-trashed to show), covers live inline as `bytea`, and `drive_file_id` is nullable.

## Desired End State

`npm run db:seed` populates the signed-in developer's library with 50 covered books. Tag filters narrow the list, a few books carry Markdown notes, ~5 show empty states, and any seeded book can be trashed/restored without Drive. Re-running keeps exactly 50 books and never touches real imports.

## Key Decisions Made

| Decision            | Choice                                                                 | Why (1 sentence)                                                       | Source |
| ------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| Data + cover source | Standard Ebooks primary, Open Library fallback                         | Rich metadata plus CC0 covers that are legally safe to commit          | Plan   |
| Cover storage       | Download once, commit image files + JSON manifest                      | Seed stays offline and deterministic                                   | Plan   |
| Mock epubs          | Generate one valid empty-body epub per book                            | Honors "use mock ebook files"; reusable as import fixtures             | Plan   |
| `drive_file_id`     | `NULL` (not a placeholder string)                                      | Routes trash/restore through the DB-only path that works without Drive | Plan   |
| User attachment     | Upsert `BOOKSHELF_ALLOWED_EMAIL` (or `--email`)                        | Books appear for the account you actually sign in with                 | Plan   |
| Idempotency         | Delete-then-insert keyed by manifest titles                            | Safe re-runs; real imports (other titles) untouched                    | Plan   |
| Richness            | Books + tags + a few notes + ~5 incomplete                             | Exercises tag filter, note rendering, and empty states                 | Plan   |
| Invocation + safety | `npm run db:seed`; refuse under `NODE_ENV=production` unless `--force` | Matches tooling convention; prevents seeding prod                      | Plan   |
| DB access in script | Raw `pg` Pool, not `@/lib/db`                                          | `@/lib/db` and `parseEpub` are `server-only` and throw in a CLI        | Plan   |

## Scope

**In scope:** `scripts/seed.mts`, a `scripts/seed/` asset bundle (manifest + covers + generated epubs + epub generator), `npm run db:seed`, a CLAUDE.md doc line.

**Out of scope:** schema/migration changes, live web fetching at seed time, Drive upload, real epub bodies, production seeding, importing the app's `parseEpub`/`@/lib/db`.

## Architecture / Approach

`scripts/seed/books.json` is the single editable source of truth. `generate-epubs.mts` derives committed `.epub` files from it (cover embedded). `seed.mts` reads the manifest for metadata/tags/notes and cover bytes from `covers/`, then inserts via raw SQL in one transaction: upsert user → delete prior seed titles → insert 50 confirmed books (`drive_file_id NULL`) → upsert tags + book_tags → insert notes. The mock epubs are committed artifacts but are not read by the seeder (avoids the server-only parser).

## Phases at a Glance

| Phase                      | What it delivers                            | Key risk                                       |
| -------------------------- | ------------------------------------------- | ---------------------------------------------- |
| 1. Curate dataset & covers | `books.json` (50) + committed cover images  | Cover licensing; finding 50 with usable covers |
| 2. Generate mock epubs     | `generate-epubs.mts` + 50 committed `.epub` | EPUB validity (mimetype ordering)              |
| 3. Seed script & wiring    | `scripts/seed.mts`, `db:seed`, docs         | Idempotency correctness; server-only trap      |

**Prerequisites:** Docker Postgres running + migrations applied; `BOOKSHELF_ALLOWED_EMAIL` set (or pass `--email`).
**Estimated effort:** ~2–3 sessions across 3 phases (Phase 1 web research is the longest).

## Open Risks & Assumptions

- Title-based idempotency assumes no real dev import shares an exact seeded classic title (acceptable in dev).
- Cover availability/licensing for all 50 from CC0 sources may force a few substitutions or null-cover books.
- Committed binaries (covers + epubs) add ~a few MB to the repo; keep covers small.

## Success Criteria (Summary)

- `npm run db:seed` yields a 50-book library with covers, tags, and notes for the signed-in dev user.
- Re-running stays at 50 with no duplicates and no damage to real imports.
- A seeded book trashes and restores cleanly with no Drive credentials.
