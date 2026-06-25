# AI Enrichment Privacy Boundary + Wrong-Identity Gate — Test Implementation Plan

## Overview

Defend test-plan **Risk #5** — _"AI enrichment violates the privacy boundary OR
persists a wrong identity."_ This is a **test-only** change (Phase 3 of the
`context/foundation/test-plan.md` rollout). It adds characterization tests that pin
two invariants in current behavior:

1. **Privacy boundary** — the strings the enrichment + tag-suggestion clients send to
   OpenAI are limited to the metadata-shaped allow-list (filename, embedded
   title/author/ISBN, front-matter snippets, plus external Open Library data and
   user-typed guidance). No book-body bytes reach a prompt.
2. **Wrong-identity gate (FR-004)** — no path auto-accepts an AI proposal. Proposals are
   _returned_ for review and persisted only through user-submitted `FormData`; the reject
   path persists nothing.

It mirrors the just-completed Risk #3 (`drive-error-classification`) approach:
**characterize what the code does today**, label any shortfall against the PRD ideal as a
`KNOWN GAP` / `KNOWN SURFACE` passing test (not a skip), and leave the exact tests to flip
when a future hardening change lands. No production code changes.

## Current State Analysis

**Prompt-construction paths (privacy surface) — four of them, all functions of typed,
metadata-only inputs:**

- `buildEnrichmentPrompt(input, openLibrary?)` — `src/lib/enrichment/prompt.ts`. Pure
  function. Emits filename, embedded title/author/ISBN, front-matter snippets, and (when
  no embedded ISBN) structured Open Library data (isbns, publishers, publishDates,
  languages). External data, not body.
- `buildFieldPrompt(input, field, language, userMessage?)` — `src/lib/enrichment/field-agent.ts:45`
  (module-private). Same metadata block, plus an optional **free-form `userMessage`**
  (user chat guidance from the field-chat modal), appended **unbounded**.
- `detectLanguage(input)` inline prompt — `src/lib/enrichment/language-classifier.ts:26`.
  Emits filename + embedded title/author only.
- `buildTagSuggestionPrompt(input)` — `src/lib/tag-suggestions/prompt.ts`. Emits title,
  author, ISBN, and the user's own existing tag names.

**The real privacy defense lives in the client layer, not the builder:**
`enrichBook` (`src/lib/enrichment/client.ts:42-45`) and `enrichField`
(`src/lib/enrichment/field-agent.ts:92-95`) cap `frontMatterStrings` to **10 items × 200
chars** _before_ building the prompt. This truncation is the safeguard against an oversized
front-matter field smuggling body text — and it is currently **untested**.

**All action call sites pass `frontMatterStrings: []`** (`enrich-metadata.ts:45`,
`enrich-field.ts:42/74/99/130`). So today no front-matter (and therefore no body) reaches a
prompt from the action layer at all — a fact worth pinning as a `KNOWN SURFACE`.

**Confirmation gate (wrong-identity surface):**

- Proposal-generating actions **return** proposals and **persist nothing**:
  `enrichMetadataAction` (`enrich-metadata.ts:24`), `enrichFieldAction` /
  `enrichFieldForDraftAction` (`enrich-field.ts:55/112`), `suggestTagsAction`
  (`tag-suggestions.ts:17`). No auto-accept exists by construction.
- Persistence happens only through user-submitted `FormData`:
  - `confirmReviewAction` (`confirm-review.ts:23`) → `confirmDraft` — the import gate.
  - `applyMetadataAction` (`enrich-metadata.ts:63`) → `updateBookMetadata` — the
    confirmed-book gate.
  - Both read field values from `FormData`, not from the proposal object. An empty form
    field persists as `null` (the reject path).

**Test harness conventions that already exist:**

- `tests/helpers/db.ts` — `resetDb`, `seedDraft`, `seedBook`, `seedSecondUser`, `readState`,
  `TEST_USER`.
- `tests/integration/confirm-review.test.ts` — reference for action tests: mocks `@/auth`,
  `@/lib/drive/client` (via `createDriveFake()`), and `@/lib/book-drafts.confirmDraft`;
  catches the `NEXT_REDIRECT` with `isRedirectError` + `getURLFromRedirectError`.
- **No OpenAI mock helper exists yet** — this change adds the first one.

## Desired End State

A new `tests/integration/ai-enrichment-privacy.test.ts` and a reusable
`tests/helpers/openai-fake.ts` exist and pass under `npm run test:integration`. The suite:

- Asserts each of the four prompt paths sends only allow-listed strings and never a
  book-body sentinel that wasn't in the typed input.
- Asserts the 10×200 front-matter cap is applied before send (via the OpenAI-boundary mock).
- Asserts the gate: proposal-generating actions leave the DB untouched; `confirmReviewAction`
  / `applyMetadataAction` persist the submitted `FormData` verbatim and persist `null` for
  omitted fields.
- Labels every shortfall against the PRD ideal as a `KNOWN GAP` / `KNOWN SURFACE` passing
  assertion, with a comment naming the exact test to flip when a hardening change lands.

Test-plan §6.5 is filled, a §6.6 Phase-3 note is appended, and `change.md` is stamped
`status: planned` → (after implementation) closed out.

### Key Discoveries:

- The cap is in the **client**, not the **builder** — `client.ts:42-45` /
  `field-agent.ts:92-95`. A builder-only test cannot exercise it; the OpenAI-boundary mock is
  required to capture the assembled `input`.
- `userMessage` (`field-agent.ts:49`, appended at `:78-80`) is user-typed and unbounded — a
  privacy _surface_ (a user could paste a body excerpt), not a current leak. Characterize, do
  not fail.
- No auto-accept path exists: persistence reads `FormData`, never the `EnrichmentProposals`
  object. The gate test proves the negative behaviorally.
- `OPENAI_API_KEY` gates real client construction (`client.ts:19-21`); the mock must replace
  `openai` so tests never touch the network and never require the env var.

## What We're NOT Doing

- **No production code changes.** Not adding a `userMessage` cap, not centralizing prompt
  construction, not changing the gate. Those are future hardening changes; this change only
  pins current behavior so they have a red/green signal to flip.
- **Not asserting the aspirational PRD ideal as hard red** where code falls short — shortfalls
  are characterized as passing `KNOWN GAP`/`KNOWN SURFACE` tests (per the Risk #3 precedent and
  the user's explicit choice).
- **Not snapshotting the LLM response or the prompt template** — the anti-patterns named in
  test-plan §2 Risk #5. We assert on the assembled prompt _body_ and on observable DB state.
- **No e2e / browser layer** — integration + unit carry the signal.
- **Not testing Open Library's network fetch** — `fetchOpenLibraryData` is mocked/bypassed;
  the privacy assertion is about what reaches the _prompt_, given structured OL data.

## Implementation Approach

Two phases. Phase 1 builds the reusable OpenAI fake and the prompt-construction privacy
contract (the harder, infrastructure-bearing half). Phase 2 adds the gate integration tests
and folds in the cookbook + close-out documentation.

The OpenAI fake mirrors `tests/helpers/drive-fake.ts`: a factory returning a `{ client,
reset, lastInput, setNextResponse }`-shaped object that stubs `responses.create`, records the
`input` string of each call, and returns a canned schema-valid JSON payload. It is injected by
`vi.mock("openai", …)` so `new OpenAI()` inside the client modules yields the fake.

## Phase 1: OpenAI fake + prompt-construction privacy contract

### Overview

Stand up the reusable OpenAI mock, then characterize the privacy boundary: the four prompt
paths emit only allow-listed strings, and the front-matter cap truncates before send.

### Changes Required:

#### 1. Reusable OpenAI fake

**File**: `tests/helpers/openai-fake.ts` (new)

**Intent**: Provide a per-test fake OpenAI client that captures the assembled prompt `input`
and returns a canned schema-valid response, so the enrichment/tag clients can be exercised
without network or `OPENAI_API_KEY`. Mirror the ergonomics of `tests/helpers/drive-fake.ts`.

**Contract**: Factory `createOpenAIFake()` returns `{ client, reset(), calls, lastInput(),
setNextResponse(json) }`. `client.responses.create(params, opts?)` pushes `params.input` onto
`calls`, returns `{ id, output_text }` where `output_text` is `JSON.stringify` of the next
canned response (default: a minimal valid `EnrichmentProposals` / tag payload). Must satisfy
the shape the client modules read: `response.output_text` and `response.id`. Wire-up note: the
client modules call `new OpenAI({ apiKey })` at module scope via `getClient()`, so the test
mocks the `openai` default export — `vi.mock("openai", () => ({ default: vi.fn(() =>
fake.client) }))` — and sets `process.env.OPENAI_API_KEY` to a dummy in `beforeAll`.

#### 2. Prompt-construction allow-list contract

**File**: `tests/integration/ai-enrichment-privacy.test.ts` (new — privacy describe block)

**Intent**: Assert each of the four prompt paths includes the allow-listed input values and
excludes a book-body sentinel that was never part of the typed input. Prove the builders are
closed over metadata-only inputs.

**Contract**: For `buildEnrichmentPrompt`, `buildFieldPrompt` (exercised via `enrichField`
since it is module-private), `detectLanguage`'s prompt (exercised via the boundary mock), and
`buildTagSuggestionPrompt`: feed an input whose allow-listed fields carry unique markers and
assert each marker appears in the captured prompt; assert a `"BOOK_BODY_SENTINEL_…"` string —
passed nowhere in the typed input — never appears. For `buildFieldPrompt`, also assert the
free-form `userMessage` is forwarded verbatim and **label this `KNOWN SURFACE`** (user-typed,
unbounded; not a body leak today). Builders that are pure exports (`buildEnrichmentPrompt`,
`buildTagSuggestionPrompt`) are called directly; the private ones are observed through the
boundary mock's `lastInput()`.

#### 3. Front-matter cap characterization

**File**: `tests/integration/ai-enrichment-privacy.test.ts` (privacy describe block, cont.)

**Intent**: Pin the 10-item × 200-char truncation that is the actual defense against oversized
front-matter — proving it happens in the client before the prompt is built.

**Contract**: Call `enrichBook` / `enrichField` (with the OpenAI fake) passing
`frontMatterStrings` of 15 entries, one of them 500 chars long. Assert via `fake.lastInput()`
that the captured prompt contains at most 10 snippets and none longer than 200 chars. Add a
`KNOWN SURFACE` assertion documenting that all action call sites pass `frontMatterStrings: []`
today (so the cap path is unreachable from the action layer) — reference
`enrich-metadata.ts:45` in the comment.

### Success Criteria:

#### Automated Verification:

- New helper compiles and is importable: `npm run test:integration` collects the file without
  module errors
- Privacy describe block passes: `npm run test:integration -- ai-enrichment-privacy`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Reversing the cap (`.slice(0, 10)` → no slice) in `client.ts` turns the cap test red —
  confirms the test actually guards the safeguard
- Adding a non-allow-listed field to a builder and routing a body string through it turns the
  sentinel assertion red
- The `KNOWN SURFACE` labels read clearly as "characterized, not endorsed"

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Confirmation gate integration + cookbook close-out

### Overview

Prove the wrong-identity gate behaviorally: no auto-accept anywhere, persistence is
FormData-driven, reject persists nothing. Then fill the test-plan cookbook and stamp the
change closed.

### Changes Required:

#### 1. No-auto-accept assertions

**File**: `tests/integration/ai-enrichment-privacy.test.ts` (new — gate describe block)

**Intent**: Prove that generating proposals never writes to the DB. Drive each
proposal-generating action with the OpenAI fake and a seeded book/draft, then assert the
persisted row is unchanged.

**Contract**: For `enrichMetadataAction`, `enrichFieldAction`, `enrichFieldForDraftAction`,
and `suggestTagsAction`: mock `@/auth` (per §6.3), seed via `seedBook` / `seedDraft`, capture
the book/draft row before and after, assert equality (metadata fields and tags unchanged) and
that the action returned `ok: true` with proposals present. Tag path additionally asserts no
`book_tags` rows were created.

#### 2. FormData-driven persistence + reject path

**File**: `tests/integration/ai-enrichment-privacy.test.ts` (gate describe block, cont.)

**Intent**: Prove the gate persists exactly what the user submitted, never the raw proposal,
and that omitted fields persist as `null` (the reject path).

**Contract**: For `confirmReviewAction` (seed a draft; mock drive via `createDriveFake`,
mock `confirmDraft` per the `confirm-review.test.ts` pattern) and `applyMetadataAction` (seed
a confirmed book): submit a `FormData` whose values differ from any proposal, assert the
persisted row equals the submitted values via `readState` / a direct select; submit a
`FormData` with an empty `isbn`/`author` and assert the column persists as `null`. Assert no
code path reads `EnrichmentProposals` into the persistence call.

#### 3. Cookbook + close-out

**File**: `context/foundation/test-plan.md`, `context/changes/ai-enrichment-privacy-boundary/change.md`

**Intent**: Replace the §6.5 TBD with the AI-privacy/gate test pattern, append a §6.6 Phase-3
note, and add a §6.7-style "Adding an AI-privacy / gate test" how-to referencing the new
`openai-fake.ts` helper. Stamp `change.md`.

**Contract**: §6.5 documents: pure builders for the content allow-list + OpenAI-boundary mock
for the cap; `createOpenAIFake()` usage and the `vi.mock("openai", …)` wire-up; gate tests via
`FormData` + `readState`. §6.6 adds 2–3 lines on the `KNOWN SURFACE` characterizations
(unbounded `userMessage`, always-empty front-matter, no-auto-accept-by-construction). Update
the §3 Phase-3 rollout status note if appropriate. Set `change.md` `status` and `updated`.

### Success Criteria:

#### Automated Verification:

- Full file passes: `npm run test:integration -- ai-enrichment-privacy`
- Whole integration suite green (no regressions): `npm run test:integration`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Forcing a proposal value into a persistence call (e.g. persisting the proposal's title
  instead of the FormData title) turns the FormData-driven assertion red
- Submitting a non-empty value where the reject test expects `null` turns the reject assertion
  red
- §6.5 reads as a usable how-to for the next contributor; §6.6 note is accurate

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- Pure prompt builders (`buildEnrichmentPrompt`, `buildTagSuggestionPrompt`): allow-list
  inclusion + body-sentinel exclusion.

### Integration Tests:

- `enrichBook` / `enrichField` with the OpenAI fake: front-matter cap (10 × 200) applied
  before send; `userMessage` forwarded (`KNOWN SURFACE`); `detectLanguage` prompt content.
- Proposal-generating actions: DB unchanged (no auto-accept).
- `confirmReviewAction` / `applyMetadataAction`: FormData-driven persistence + reject-as-null.

### Manual Testing Steps:

1. Run `npm run test:integration -- ai-enrichment-privacy` — all green.
2. Temporarily break the cap (`client.ts:44`) and the FormData binding — confirm the targeted
   tests go red, then revert.
3. Read §6.5/§6.6 cookbook edits for accuracy.

## Performance Considerations

None — tests run against the existing Docker Postgres harness with a fully mocked OpenAI
boundary (no network). Expected to add well under a second to the integration suite.

## Migration Notes

None — no schema or data changes.

## References

- Risk source: `context/foundation/test-plan.md` §2 Risk #5, §2 Risk Response row #5, §3 Phase 3
- Change identity + protection thesis: `context/changes/ai-enrichment-privacy-boundary/change.md`
- Characterization precedent: `tests/integration/drive-error-classification.test.ts`,
  test-plan §6.6 Phase-3 note + §6.7
- Action-test conventions: `tests/integration/confirm-review.test.ts`, test-plan §6.2 / §6.3
- Prompt paths: `src/lib/enrichment/prompt.ts`, `src/lib/enrichment/field-agent.ts:45`,
  `src/lib/enrichment/language-classifier.ts:26`, `src/lib/tag-suggestions/prompt.ts`
- Gate: `src/app/actions/confirm-review.ts`, `src/app/actions/enrich-metadata.ts:63`,
  `src/app/actions/enrich-field.ts`, `src/app/actions/tag-suggestions.ts`
- Cap: `src/lib/enrichment/client.ts:42-45`, `src/lib/enrichment/field-agent.ts:92-95`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: OpenAI fake + prompt-construction privacy contract

#### Automated

- [x] 1.1 New helper compiles and is importable (integration collects file without module errors) — ab54f5e
- [x] 1.2 Privacy describe block passes (`npm run test:integration -- ai-enrichment-privacy`) — ab54f5e
- [x] 1.3 Type checking passes (`npx tsc --noEmit`) — ab54f5e
- [x] 1.4 Linting passes (`npm run lint`) — ab54f5e

#### Manual

- [ ] 1.5 Reversing the cap in `client.ts` turns the cap test red
- [ ] 1.6 Routing a body string through a non-allow-listed field turns the sentinel assertion red
- [ ] 1.7 `KNOWN SURFACE` labels read as "characterized, not endorsed"

### Phase 2: Confirmation gate integration + cookbook close-out

#### Automated

- [x] 2.1 Full file passes (`npm run test:integration -- ai-enrichment-privacy`)
- [x] 2.2 Whole integration suite green, no regressions (`npm run test:integration`)
- [x] 2.3 Type checking passes (`npx tsc --noEmit`)
- [x] 2.4 Linting passes (`npm run lint`)

#### Manual

- [x] 2.5 Forcing a proposal value into a persistence call turns the FormData assertion red
- [x] 2.6 Submitting a non-empty value where reject expects `null` turns the reject assertion red
- [x] 2.7 §6.5 reads as a usable how-to; §6.6 note is accurate
