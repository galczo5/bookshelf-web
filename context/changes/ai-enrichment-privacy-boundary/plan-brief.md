# AI Enrichment Privacy Boundary + Wrong-Identity Gate — Plan Brief

> Full plan: `context/changes/ai-enrichment-privacy-boundary/plan.md`

## What & Why

Defend test-plan **Risk #5** — _"AI enrichment violates the privacy boundary OR persists a
wrong identity."_ Add characterization tests proving (1) the enrichment + tag-suggestion
clients send only metadata-shaped allow-listed strings to OpenAI — no book-body bytes — and
(2) no path auto-accepts an AI proposal; proposals are persisted only through user-submitted
form data. Test-only; no production changes.

## Starting Point

Four prompt-construction paths exist (`buildEnrichmentPrompt`, `buildFieldPrompt`,
`detectLanguage`, `buildTagSuggestionPrompt`), all functions of typed metadata-only inputs.
The real privacy safeguard — a 10×200 front-matter cap — lives in the client layer
(`client.ts:42-45`) and is **untested**. The gate has no auto-accept by construction:
persistence (`confirmReviewAction`, `applyMetadataAction`) reads `FormData`, never the
proposal object. There is no OpenAI mock helper in the test suite yet.

## Desired End State

`tests/integration/ai-enrichment-privacy.test.ts` + a reusable `tests/helpers/openai-fake.ts`
exist and pass, pinning the allow-list, the front-matter cap, and the FormData-driven gate.
Shortfalls against the PRD ideal are labeled `KNOWN SURFACE`/`KNOWN GAP` passing tests — the
exact tests to flip when a future hardening change lands. Test-plan §6.5/§6.6 cookbook filled.

## Key Decisions Made

| Decision                 | Choice                                                    | Why                                                                               | Source |
| ------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Test philosophy for gaps | Characterize current behavior; label gaps `KNOWN SURFACE` | Matches Risk #3 drive-error precedent; tests stay green and become flip-points    | Plan   |
| Cap + allow-list layer   | Pure builders + OpenAI-boundary mock                      | The cap lives in the client, not the builder — a builder-only test misses it      | Plan   |
| OpenAI mock location     | New `tests/helpers/openai-fake.ts`                        | Phase 3 reuses it; mirrors `drive-fake.ts` conventions; cookbook can reference it | Plan   |
| Coverage                 | All four prompt paths + both gates                        | Complete Risk #5 surface; shared pattern keeps it cheap                           | Plan   |
| Cookbook update          | Fill §6.5 + §6.6 note                                     | Consistent with Phase 2/3 documentation habit                                     | Plan   |

## Scope

**In scope:** privacy contract for 4 prompt paths; front-matter cap test; no-auto-accept +
FormData-persistence + reject-path gate tests; `openai-fake.ts` helper; test-plan cookbook
§6.5/§6.6.

**Out of scope:** any production code change (no `userMessage` cap, no prompt centralization,
no gate change); asserting the PRD ideal as hard red; snapshotting LLM responses or prompt
templates; e2e; Open Library network testing.

## Architecture / Approach

A new integration test file with two describe blocks (privacy + gate). The privacy block calls
pure builders directly and exercises the private/client paths through `createOpenAIFake()`,
which stubs `responses.create`, captures the assembled prompt `input`, and returns canned
schema-valid JSON. The gate block drives the real server actions against the Docker Postgres
harness (`seedBook`/`seedDraft`/`readState`), mocking `@/auth`, drive, and OpenAI.

## Phases at a Glance

| Phase                             | What it delivers                                              | Key risk                                                                  |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. OpenAI fake + privacy contract | `openai-fake.ts` + allow-list & cap tests                     | Wiring `vi.mock("openai")` so module-scope `new OpenAI()` yields the fake |
| 2. Gate integration + close-out   | No-auto-accept, FormData-persistence, reject tests + cookbook | Proving the negative (no proposal value reaches persistence) cleanly      |

**Prerequisites:** Docker Postgres harness (Phase 1 of test-plan, already landed); existing
`tests/helpers/db.ts` + `drive-fake.ts`.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- `userMessage` (free-form chat guidance) is forwarded unbounded — characterized as a
  `KNOWN SURFACE`, not fixed here; a real future privacy review may want to cap it.
- The OpenAI fake must satisfy only `output_text` + `id`; if a client path later reads more of
  the response shape, the fake needs extending.
- Assumes `frontMatterStrings: []` at all action call sites remains true; the cap test exercises
  the client directly to stay meaningful regardless.

## Success Criteria (Summary)

- A book-body sentinel never appears in any assembled prompt; each allow-listed input does.
- The 10×200 front-matter cap is provably applied before send (breaking it turns a test red).
- Generating proposals never mutates the DB; the gate persists submitted FormData, with
  omitted fields stored as `null`.
