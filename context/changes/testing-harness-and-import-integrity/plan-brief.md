# Testing Harness + Import/Migration Integrity — Plan Brief

> Full plan: `context/changes/testing-harness-and-import-integrity/plan.md`
> Research: `context/changes/testing-harness-and-import-integrity/research.md`

## What & Why

Stand up the project's first test infrastructure — Vitest, an integration harness against Docker-Compose Postgres 18, a programmable Drive fake, and a CI workflow — and use it to defend two top risks from `context/foundation/test-plan.md`: **Risk #1** (epub import non-atomicity: a successful import must leave both the DB row and the Drive bytes consistent, or neither) and **Risk #2** (migration drift between local Postgres and Render Postgres). This is test-plan Phase 1 and is load-bearing for Phases 2–4.

## Starting Point

There is currently **no test infrastructure at all** — no Vitest, no test files, no fixtures, no CI workflow, no `test` script. Docker Compose Postgres exists but is on `16-alpine` while Render runs major **18** (verified this session via Render MCP — that drift is itself a Risk #2 instance). The Risk-#1 surface is **`confirmReviewAction`** at `src/app/actions/confirm-review.ts:59-139`, not the file-picker `importEpubAction` — the import is two server actions, and the atomicity question lives in the second one. A best-effort rollback-delete is already wired at lines 126-132; the original `epub-import-to-drive` plan explicitly accepts the double-failure orphan-leak as "consistent with the app-independent guardrail."

## Desired End State

A contributor clones the repo, runs `docker compose up -d db && createdb bookshelf_test && npm run db:migrate && npm test`, and sees green in under 60 seconds. Every PR runs three GitHub Actions jobs (lint, integration tests, migration replay) against a Postgres-18 service container; merge is blocked when any job fails. A regression that breaks Drive ↔ DB atomicity, or that drifts the migration schema from the committed snapshot, fails a test with a clear, action-level or schema-level diagnostic — not a snapshot-of-implementation diff.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Test isolation strategy | **TRUNCATE between tests** | Exercises real COMMIT semantics — exactly what Risk #1 needs because `confirmDraft` uses an inner `db.transaction()` that would become a SAVEPOINT under an outer-rollback strategy. | Plan |
| Drive client fake shape | **Programmable in-memory fake double** | One reusable double anchors Phase 1 + Phase 2 + Phase 3 tests; per-call `failNextCreate/failNextDelete` hooks make every failure-mode test readable. | Plan |
| Epub fixture source | **One real tiny `.epub` committed under `tests/fixtures/`** | `parseEpub` validates structure — synthetic bytes won't survive it, and the import flow needs the real path exercised. | Plan |
| Migration replay depth | **Full round-trip + schema snapshot** | Forward → down all → forward → diff against committed JSON snapshot catches every category of drift the test plan names. | Plan |
| CI scope | **Ship workflow in this change** | Test-plan §5 marks Vitest + migration replay as **required** after Phase 1; local-only enforcement would drift. | Plan |
| Postgres major version | **Pin to `18-alpine` (matches Render)** | Verified via Render MCP `dpg-d887ac7avr4c73e2uufg-a` → version "18"; closes the most likely source of Risk #2 drift right now. | Plan |
| Orphan-leak case coverage | **Assert observable contract; accept orphan** | Locks in the documented `epub-import-to-drive` contract; future code that tries to "fix" the orphan-leak will be flagged. | Plan |
| `npm` scripts | **`test`, `test:integration`, `test:migrate-replay`** | One default for humans, two narrow ones for CI jobs to run in parallel; aligned with Phase 2/3 growth (`test:unit` added later). | Plan |
| Atomicity oracle | **`{review_state, drive_file_id, hasDraft}` triple** | Single-column reads leave the door open to half-consistent states; the triple is the only complete oracle. | Research |
| Risk-#1 surface | **`confirmReviewAction`, not `importEpubAction`** | Research showed import is split into draft creation (safe by transaction) + confirm (Drive + DB, the atomicity surface). | Research |

## Scope

**In scope:**
- Install Vitest; `vitest.config.ts` with `pool: 'forks'` + `singleFork: true`
- Bump `docker-compose.yml` to `postgres:18-alpine`
- Three test helpers: `tests/helpers/db.ts`, `tests/helpers/drive-fake.ts`, `tests/helpers/fixtures.ts`
- One real `.epub` fixture (under 5 KB) committed at `tests/fixtures/minimal.epub` with a regen README
- Five `confirm-review` integration tests + two `import-epub` integration tests
- Migration replay script `scripts/test-migrate-replay.mts` + committed `tests/fixtures/migration-schema-snapshot.json`
- Refactor `scripts/migrate.mts` to expose a reusable runner (preserves existing CLI)
- `.github/workflows/test.yml` — three jobs (`lint`, `test:integration`, `test:migrate-replay`) against `postgres:18-alpine`
- Three `npm` scripts: `test`, `test:integration`, `test:migrate-replay`
- Update `context/foundation/test-plan.md`: Phase-1 status `complete`, §6.2/§6.3/§6.4 cookbook entries filled

**Out of scope:**
- Tests for Risks #3, #4, #5, #6, #7 (deferred to test-plan Phases 2–3)
- Refactoring `confirmReviewAction` or introducing a `DriveClient` interface — the seams already exist
- E2E / Playwright (test-plan §4)
- `tsc --noEmit` CI gate (test-plan §5 marks this as Phase 4)
- Post-deploy smoke via Render MCP (test-plan §5 marks this as optional after Phase 4)
- Cleanup machinery for the orphan-leak (rejected by the original `epub-import-to-drive` plan)
- Multi-Postgres-major matrix in CI
- `test:unit` script (lands when Phase-3 unit tests do)
- OpenAI / cover-fetch / OAuth fakes
- Extending the Drive fake to `about.get` / `files.get` / `files.update` (Phase 2 of the test plan extends it as needed)

## Architecture / Approach

**Test stack**: Vitest 1.x → `node` environment → `pool: 'forks'` + `singleFork: true` so all integration tests share one process and one DB connection. **DB seam**: existing Kysely Proxy at `src/lib/db.ts:77` keyed on `DATABASE_URL`; tests set it once via `tests/setup.ts` before any import. **Drive seam**: `vi.mock('@/lib/drive/client', () => ({ getDriveClient: vi.fn() }))` returns the per-test programmable fake — no production refactor. **Auth seam**: `vi.mock('@/auth')` returns a synthetic session. **Isolation**: per-test `TRUNCATE TABLE notes, book_tags, book_drafts, books, tags, users RESTART IDENTITY CASCADE` + re-seed a fixed `TEST_USER`. **Migration replay**: dedicated `bookshelf_replay` DB; `DROP/CREATE DATABASE` against the `postgres` admin DB; reuse the migrator factory extracted from `scripts/migrate.mts`. **CI**: three parallel jobs, each with a `postgres:18-alpine` service container.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Harness primitives | Vitest installed; Postgres 18 pinned; DB/Drive/fixture helpers; minimal epub fixture; three `npm` scripts; setup file with safe env defaults | Postgres 18-alpine image availability and any local volume incompatibility with the major bump |
| 2. Risk #1 integration tests | Five `confirm-review` tests + two `import-epub` tests against real Postgres + Drive fake; locks in atomicity oracle including the orphan-leak contract | `redirect()` throws on success — tests must catch `NEXT_REDIRECT` cleanly; `vi.mock` hoisting subtleties |
| 3. Risk #2 migration replay | `scripts/test-migrate-replay.mts` (forward → down → forward + schema snapshot diff); committed snapshot JSON; cookbook entry in test-plan §6.4 | Snapshot determinism across Postgres minor versions — requires deterministic `ORDER BY` clauses |
| 4. CI workflow | `.github/workflows/test.yml` with three required jobs against Postgres 18; test-plan §3 Phase 1 row marked `complete`, §6.2/§6.3 cookbook entries filled | GitHub Actions service-container healthcheck timing; deliberately-broken-PR validation is manual |

**Prerequisites:** Docker available locally (already required by current dev setup); GitHub repo access to add `.github/workflows/`. No production access needed; no Render changes.

**Estimated effort:** ~3-4 implementation sessions across the four phases. Phase 1 is the heaviest (foundation + fixture creation); Phases 2-4 build mechanically on it.

## Open Risks & Assumptions

- **`postgres:18-alpine` is published and stable on Docker Hub.** True as of 2026-06-04; will re-check before pulling the image during Phase 1.
- **Vitest 1.x ESM + Next.js 16 + Node 22 play together cleanly** for server-action imports under `vi.mock`. Verified pattern in Vitest docs but not yet exercised in this codebase; mitigation is to fall back to deeper module-path mocks if the high-level `vi.mock('@/auth')` hits import-order issues.
- **The orphan-leak test is testing a contract a future maintainer might reasonably want to change.** Inline comment with a pointer to `epub-import-to-drive/plan.md` keeps the rationale visible; this risk lives in the documented contract, not in this change.
- **CI service-container Postgres has the same default collation / extensions** as Render Postgres 18. Likely true (both Debian-based, no special extensions in our schema), but the migration replay test exists precisely to catch this — the first CI run is the validator.
- **Render does not bump majors during this change's implementation window.** Risk is low (majors live for years on Render); if it happens mid-flight, re-verify via the same MCP call and bump the image.

## Success Criteria (Summary)

- Running `npm test` after `docker compose up -d db && createdb bookshelf_test && npm run db:migrate` is green within 60s on a clean clone.
- A regression that reorders the Drive vs DB calls in `confirmReviewAction`, removes the rollback delete, or breaks a migration's `down()` function fails CI in the right job with a clear diagnostic — not in a stack trace or a snapshot-of-implementation diff.
- Every PR runs three GitHub Actions jobs against Postgres 18 (lint + integration + migration replay) and merging is blocked until all three pass.
