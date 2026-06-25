# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-02

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   author is worried about X, and the failure would surface somewhere in
   `<area>`" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (37 commits over the
last 30 days; excludes `node_modules`, `.next`, `dist`, `build`,
fixtures, archive).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                                                                                              | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Import non-atomicity.** A successful "import" leaves the DB row written but the epub bytes never reach Drive (or the reverse): library shows a ghost book, or Drive holds an orphan file the app no longer references. App-independent-library guardrail silently breaks.                                          | High   | High       | interview Q1; hot-spot dir `src/lib/drive/` — 6 commits/30d; hot-spot dir `src/app/actions/` — 12 commits/30d; PRD US-01, FR-005, Guardrail "App-independent library"; archived plan `epub-import-to-drive` |
| 2   | **Migration drift between Docker-local Postgres and Render Postgres.** A migration applies green against the local Docker image and fails or silently misbehaves on Render (default collation, missing extension, locale, ordering of CITEXT/JSONB).                                                                 | High   | High       | interview Q2; hot-spot dir `src/lib/db/` — 3 commits/30d; archived plan `library-data-schema`; tech-stack.md (Kysely + `pg` + Docker Compose `postgres:16-alpine` locally)                                  |
| 3   | **Drive API error misclassification.** A transient 5xx / 429 / 401-token-expired / quota error is mapped to "not found" or vice versa; user sees the wrong outcome, or a transient becomes permanent. Can cascade into Risk #1.                                                                                      | Medium | High       | interview Q3; hot-spot dir `src/lib/drive/` — 6 commits/30d; archived plan `drive-oauth-and-client`                                                                                                         |
| 4   | **Tag rename non-atomicity.** A global rename half-applies after a mid-operation crash, or merge-on-collision goes wrong, leaving some books on the new tag and some still on the old. Violates the data-integrity guardrail.                                                                                        | High   | Medium     | PRD FR-010, Guardrail "Data integrity"; hot-spot dir `src/app/actions/` — 12 commits/30d (tags actions churning); archived plan `rename-tag-globally`                                                       |
| 5   | **AI enrichment violates the privacy boundary OR persists a wrong identity.** Prompt construction emits something other than the allow-listed strings (filename, embedded title/author/ISBN, front-matter), or the confirmation gate auto-accepts a low-confidence proposal that ends up identifying the wrong book. | High   | Medium     | PRD §Business Logic, PRD §NFR Privacy of book content, PRD FR-003/004; hot-spot dir `src/lib/enrichment/` — 4 commits/30d; hot-spot dir `src/lib/tag-suggestions/` — 4 commits/30d                          |
| 6   | **Notes save silently drops content.** Autosave or explicit-save fires but a transient DB error, refresh, or navigate-away loses the edit without telling the user. Violates the 5-second persistence-durability NFR and the data-integrity guardrail.                                                               | High   | Medium     | PRD §NFR Persistence durability, FR-014/015/016; archived plan `library-and-book-view` (notes shipped here); hot-spot dir `src/app/(app)/` — 12 commits/30d                                                 |
| 7   | **Server action runs without a valid session.** A mutating action becomes callable session-less (or with an expired session) and either crashes on an undefined user_id or — worse — writes against a stub identity. Abuse-lens row: the single-user model collapses if a stale session can mutate state.            | High   | Medium     | PRD §Access Control; tech-stack.md (NextAuth + Drive OAuth, single-user); hot-spot dir `src/app/actions/` — 12 commits/30d; abuse/security lens (auth + AI + user-provided input present)                   |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                              | Must challenge                                                                                                                                                     | Context `/10x-research` must ground                                                                                                                    | Likely cheapest layer                                                                                                        | Anti-pattern to avoid                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | A successful import means both the DB row exists AND the epub bytes are reachable via Drive. A Drive failure mid-upload leaves _neither_ state behind, and the user sees a clean error rather than a partial success.                                    | "The action returned 200, therefore both writes succeeded."                                                                                                        | The exact ordering of Drive upload vs DB insert in the import action, the rollback path, and the user-visible state after a partial failure.           | integration (action against a real Postgres + a fake Drive client that can fail mid-upload)                                  | happy-path-only; mocking the action under test; asserting the SQL string rather than the resulting row + bytes                                              |
| #2   | Every migration applies forward against a fresh Postgres matching the Render major version, rolls back cleanly, and the resulting schema is identical to what dev sees.                                                                                  | "It worked locally, so it'll work on Render."                                                                                                                      | The migration runner's contract, expected `schema_migrations` table, which extensions/collations the schema assumes (CITEXT? UUID? JSONB ordering?).   | contract / replay (CI step that spins up a Render-major Postgres and runs migrations up + down)                              | asserting against the current dev DB's schema (oracle problem — bakes in the bug); skipping rollback; only running migrations on the first commit           |
| #3   | Each documented Drive error class maps to a stable, user-visible outcome (with a recorded fixture per error code). Transient classes are retried; terminal classes surface a clear user error.                                                           | "200 means success" — Drive can return 200 with an error envelope. "The SDK throws on errors" — `googleapis` surfaces some errors as status, others as exceptions. | The full set of Drive responses the import / upload / connection-check code actually handles, which classes are retried, and where token-refresh sits. | unit on the error-mapper + integration on the upload path                                                                    | implementation mirror (re-asserting the mapping the function builds); over-mocking the `googleapis` client; not exercising the retry decision               |
| #4   | A rename either fully applies to every affected book AND removes the old tag (or merges on collision per the shipped change), or rolls back entirely. After a simulated mid-rename crash the DB is in one of those two states — never the in-between.    | "Rows affected equals expected count, therefore done"; "the migration is atomic because it's one query."                                                           | The exact rename SQL, the transaction boundary, the merge-on-collision semantics.                                                                      | integration with a transaction-probe + a forced-rollback case                                                                | snapshotting the SQL (implementation mirror); skipping the collision case                                                                                   |
| #5   | The prompt-construction path emits only allow-listed strings. The confirmation gate requires explicit user accept per field — no auto-accept paths exist anywhere; provenance is shown alongside each proposal; the reject path persists nothing.        | "We only send small strings, so we're safe"; "the LLM said X, so X is correct"; "front-matter is metadata-shaped, so it's allowed."                                | The exact set of strings the enrichment + tag-suggestion clients send, and the gate's accept/reject flow including the persistence boundary.           | contract test on prompt construction (negative: assert no forbidden bytes) + integration on the gate (positive: reject path) | snapshotting the LLM's response (couples to the model); only testing the accept path; asserting on the prompt template rather than the assembled body       |
| #6   | A note edit survives a refresh within 5 seconds of the last keystroke (or explicit save). On a simulated mid-save error the editor surfaces the failure rather than dropping silently.                                                                   | "The autosave callback ran, so the data is persisted"; "the UI shows a saved indicator."                                                                           | The note-save action's contract (debounce vs explicit, error surface, optimistic UI), the persistence-layer transaction shape.                         | integration on the save action (write → re-read) + a forced-error path                                                       | snapshotting the editor's internal state; asserting localStorage state without verifying the DB; testing only the autosave timer rather than the round-trip |
| #7   | Every mutating server action requires a valid NextAuth session; an action called session-less returns a clean error and writes nothing. Every action that touches a user-scoped row resolves the row via the session, not via a client-supplied user ID. | "It's single-user, so anyone reaching the action _is_ the user"; "the middleware handles auth."                                                                    | The session-extraction pattern actions actually use, whether any action accepts user_id as input, the shape of the error returned to the client.       | integration sweep on a representative sample of mutating actions, invoked without a session                                  | testing only the happy path with a real session; copying the session-guard logic into the test (oracle problem)                                             |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                           | Goal (one line)                                                                                                                                                                                                     | Risks covered | Test types                  | Status        | Change folder                                             |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------- | ------------- | --------------------------------------------------------- |
| 1   | Harness bootstrap + import/migration integrity       | Stand up Vitest + an integration harness against a Render-major Postgres; defend Risk #1 (import non-atomicity) and Risk #2 (migration parity) at the action and contract layers.                                   | #1, #2        | integration, contract       | complete      | `context/changes/testing-harness-and-import-integrity/`   |
| 2   | Notes durability + tag-rename atomicity              | Defend Risk #6 (notes save round-trip) and Risk #4 (rename transactional integrity) at the action layer, reusing the Postgres harness from Phase 1.                                                                 | #4, #6        | integration                 | change opened | `context/changes/testing-notes-and-tag-rename-integrity/` |
| 3   | Drive error envelope + AI privacy + session boundary | Defend Risk #3, Risk #5, Risk #7 with focused unit, contract, and integration tests sharing fixtures from Phase 1. AI privacy via prompt-construction contract; session boundary via session-less invocation sweep. | #3, #5, #7    | unit, contract, integration | not started   | —                                                         |
| 4   | Quality-gates wiring                                 | Lock the test floor in CI (GitHub Actions: lint + typecheck + Vitest matrix against a Render-major Postgres); optional post-deploy smoke via Render MCP for the deployed schema.                                    | cross-cutting | gates                       | not started   | —                                                         |

**Status vocabulary** (fixed — parser literals):

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `not started`   | No change folder for this rollout phase yet.                        |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched`    | `research.md` exists in the change folder.                          |
| `planned`       | `plan.md` exists with a `## Progress` section.                      |
| `implementing`  | Progress section has at least one `[x]` and at least one `[ ]`.     |
| `complete`      | Progress section is fully `[x]`.                                    |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests/configs
plus the MCP/tools actually exposed in the current session — see the
grounding note below the table.

| Layer                | Tool                                                           | Version | Notes                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration   | none yet — see §3 Phase 1                                      | —       | Phase 1 stands up Vitest (TypeScript-native, ESM-friendly, no Babel) against the Docker Compose Postgres.                                                        |
| API mocking          | none yet — see §3 Phase 1                                      | —       | Mock at the network edge only. Drive: a fake `drive_v3` client that the upload path accepts. OpenAI: per-test response fixture.                                  |
| e2e                  | none yet — see §3 Phase 4 (only if cost × signal justifies)    | —       | Default to integration. Add Playwright only if the failure mode requires a real browser + cookie + NextAuth round-trip and integration cannot catch it.          |
| accessibility        | none — out of scope per PRD §Non-Goals (no WCAG-AA commitment) | —       | Keyboard navigation and basic readability are checked manually.                                                                                                  |
| (optional) AI-native | not used                                                       | —       | No vision-review or post-edit-hook layer planned. The riskiest paths are deterministic (DB, Drive contracts, prompt strings) and classic tests carry the signal. |

**Stack grounding tools (current session):**

- Docs: **none** — no Context7 / framework-docs MCP exposed. For Next.js 16 guidance, read `node_modules/next/dist/docs/` directly per CLAUDE.md hard-rule #5; checked: 2026-06-02.
- Search: **WebSearch + WebFetch available** — generic web search and URL fetch for one-off framework-version / Postgres-version checks. No Exa.ai; checked: 2026-06-02.
- Runtime/browser: **none** — no Playwright MCP. If an e2e layer is ever added it must be a local devDependency (`@playwright/test`), not an MCP; checked: 2026-06-02.
- Provider/platform: **Render MCP** — can list/inspect deploys, query Render Postgres, read service logs. Quality-gate relevance: post-deploy schema verification (Risk #2) and post-deploy log inspection during the §3 Phase 4 smoke; checked: 2026-06-02. No GitHub MCP — CI YAML edits stay manual.

Use docs MCPs (when available) for current framework/library APIs and
setup. Use search MCPs for discovery or current status only, then prefer
official docs as the evidence. Do not use MCP docs/search to infer code
failure anchors; those belong in per-phase `/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase `<N>`" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                          | Where                                  | Required?                                     | Catches                                                            |
| --------------------------------------------- | -------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| lint (`eslint`)                               | local + CI (already in `package.json`) | required                                      | syntactic / style drift                                            |
| typecheck (`tsc --noEmit`)                    | local + CI                             | required after §3 Phase 4 wires it explicitly | type drift; Next.js 16 type changes per CLAUDE.md                  |
| unit + integration (Vitest)                   | local + CI                             | required after §3 Phase 1                     | logic + transactional regressions on Risk #1, #2, #4, #6           |
| migration replay (forward + rollback)         | CI on PR                               | required after §3 Phase 1                     | Risk #2 — Render Postgres drift                                    |
| Drive-error fixture suite                     | local + CI                             | required after §3 Phase 3                     | Risk #3 — error misclassification regressions                      |
| AI prompt-construction contract               | local + CI                             | required after §3 Phase 3                     | Risk #5 — privacy NFR violations                                   |
| session-required action sweep                 | CI on PR                               | required after §3 Phase 3                     | Risk #7 — session-less mutations                                   |
| post-deploy smoke (Render MCP: schema + logs) | between merge + prod                   | optional, recommended after §3 Phase 4        | environment-specific failures (Render Postgres drift surviving CI) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase `<N>`."

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 (Vitest harness) and §3 Phase 3 (Drive error-mapper pattern).

### 6.2 Adding an integration test against Postgres

Drop the test file into `tests/integration/`. Import `resetDb`, `seedDraft`, and `readState` from `tests/helpers/db.ts` — `resetDb` truncates all user tables and re-seeds the test user in one call, `readState(bookId)` returns the `{reviewState, driveFileId, hasDraft}` triple that anchors Risk #1 assertions. For library-state fixtures use `seedBook({ userId?, title?, author? })` (inserts a `confirmed` book, returns its id) and `seedSecondUser()` (a second fixed-UUID user) — these make cross-user ownership cases a one-liner. Mock `@/lib/drive/client` with `createDriveFake()` from `tests/helpers/drive-fake.ts` to control Drive behaviour per-test. Example: `tests/integration/confirm-review.test.ts`.

### 6.3 Adding a test for a server action

Call the action directly (no HTTP layer) — pass a `FormData` as the second argument and a `null` initial state as the first. Mock `@/auth` via `vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }))` and use `vi.mocked(auth).mockResolvedValue(...)` per-test to control the session. On success paths, actions call Next.js `redirect()` which throws a `NEXT_REDIRECT` error — catch it and assert the URL with `isRedirectError` + `getURLFromRedirectError` from `next/dist/client/components/redirect-error` and `next/dist/client/components/redirect`. Example: `tests/integration/import-epub.test.ts`.

### 6.4 Adding a migration + verifying parity

1. Write the migration file under `src/lib/db/migrations/` following the `NNNN_name.mts` naming convention.
2. Apply it locally: `npm run db:migrate` against your dev DB.
3. Regenerate the schema snapshot: `npm run test:migrate-replay -- --update-snapshot`. This drops and recreates `bookshelf_replay`, runs all migrations forward → full reset → forward again, and writes `tests/fixtures/migration-schema-snapshot.json`.
4. Commit the migration file and the updated snapshot in a single commit. CI runs `npm run test:migrate-replay` on every PR and will fail if the committed snapshot drifts from what the migrations actually produce.

### 6.5 Adding a test for an AI-touching path

- TBD — see §3 Phase 3. Covers the prompt-construction contract (assert no forbidden bytes), the per-test response fixture, and the gate's reject-path integration.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

**Phase 2 (notes durability + tag-rename atomicity).** Tag-merge atomicity is
proven by a _union-preservation_ assertion through `renameTagAction` (source `S`
on `{A,B}`, target `T` on `{B,C}` → `T` on exactly `{A,B,C}`, `S` gone) — no
fault injection needed; reversing the INSERT/DELETE order in `renameOrMergeTag`
turns it red. Notes/tags fixtures use the new `seedBook`/`seedSecondUser`
helpers (§6.2). Surprise: `deleteNote`'s ownership guard is dead code —
`DELETE … executeTakeFirst()` (no `RETURNING`) is always truthy, so
`deleteNoteAction` returns `{ ok:true }` on a denied no-op delete; the row is
still protected by the `WHERE exists` clause, so the notes test asserts the
data-integrity invariant (note unchanged) rather than the action's `ok` flag.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **shadcn/ui primitives under `src/components/ui/`** — upstream-generated via `npx shadcn@latest add`; testing them re-tests the registry. Trust the source. Re-evaluate if a component is hand-modified beyond a trivial wrapper. (Source: Phase 2 interview Q5.)
- **Live OAuth round-trip vs Google's real servers** — flaky, slow, not a failure mode worth catching in CI. Mock the boundary; cover the token-refresh / 401 paths via Risk #3's fixture suite. Re-evaluate if NextAuth + Drive scope mechanics change materially. (Source: Phase 2 interview Q5.)
- **Visual snapshots of marketing / static pages** — `signin/page`, `layout`, `globals.css`; these change rarely and break on every Tailwind upgrade. Negative ROI. Re-evaluate if a public-facing marketing page is added with real content. (Source: Phase 2 interview Q5.)
- **Concurrency / multi-user stress** — audience-of-one. No concurrent-edit, multi-user race, or multi-tab livelock tests beyond the basic single-user case. Re-evaluate if the product ever pivots off the single-user model (PRD §Non-Goals explicitly forbids this for v1). (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-02
- Stack versions last verified: 2026-06-02
- AI-native tool references last verified: 2026-06-02 (no AI-native tools wired; re-check if any are added)
- Phase 1 landed: 2026-06-04

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
