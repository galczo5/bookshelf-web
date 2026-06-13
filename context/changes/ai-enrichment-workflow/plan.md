# Multi-Agent AI Enrichment Workflow — Implementation Plan

## Overview

Replace the single-call AI enrichment with a multi-agent workflow: a language classifier step followed by 10 parallel field sub-agents (adding series and part to the enriched set). Each field populates progressively as its agent finishes. A per-field chat modal lets users type guidance and retry individual fields with full conversation history preserved. Applied to both the initial import review page (`/review/[id]`) and the book detail re-enrichment panel (`books/[id]`).

## Current State Analysis

- **Single blocking AI call**: `src/lib/enrichment/client.ts:41` — `enrichBook()` makes one OpenAI Responses API call handling all 8 fields at once with a 28-second timeout
- **Series/part not AI-enriched**: `enrich-metadata-panel.tsx:363-364` — series and part fields have `proposal={undefined}`; no enrichment schema or prompt instructions exist for them
- **No per-field retry**: Only a global "Re-enrich metadata" button; no field-level retry affordance
- **Blocking SSR enrichment**: `page.tsx:51` — the review page calls `enrichBook()` in a server component, blocking the response until all proposals arrive; any failure redirects away and deletes the draft
- **OpenAI Responses API + web_search already wired**: `client.ts:59-75` — the call pattern is established; `response.id` is available on every response object but currently discarded
- **`previous_response_id` unused**: No multi-turn conversation threading exists anywhere

## Desired End State

A user importing or re-enriching a book sees individual fields populate progressively as each sub-agent completes. Each field slot shows a loading skeleton while its agent runs, then resolves to a proposal or an inline error with a retry button. A per-field chat modal lets the user type guidance ("this is the Polish edition") and have that specific field's agent re-run, with conversation history visible across attempts. Series and part now receive AI proposals in both flows.

### Key Discoveries

- `response.id` is present on every `responses.create()` return value but discarded — capturing it unlocks `previous_response_id` chaining at no extra cost (`src/lib/enrichment/client.ts:79` reads only `output_text`)
- `cover` returns `CoverProposal` (shape: `{ urls, primary, provenance, confidence }`) while all other 9 fields return `FieldProposal<string> | null` — this discrimination flows through the server action return type and the field slot renderer
- The review page's failure path (`deleteDraftAndBook` + redirect at `page.tsx:55-59`) becomes a responsibility mismatch once enrichment is client-side; failure recovery must move to per-field inline errors
- `book_drafts.proposals` column remains in the DB but stops being written — no migration needed; null proposals are already handled downstream

## What We're NOT Doing

- No DB schema changes — proposals stay ephemeral (client-side state only)
- No streaming/SSE infrastructure — N parallel server actions via `useTransition` achieves per-field progressive loading without new infra
- No changes to `applyMetadataAction` or `confirmReviewAction` — the save path is unchanged
- No changes to `open-library.ts` or `fetch-cover.ts` — reused as-is
- No removal of `enrichBook()` in `client.ts` — it can be cleaned up in a follow-up once both flows are migrated
- No full-text book content extraction (PRD non-goal: privacy requirement)
- No multi-model routing — all sub-agents use the same `OPENAI_MODEL` env var

## Implementation Approach

The existing `enrichBook()` single-call function is not refactored in place. Two new library modules are added alongside it:

1. `language-classifier.ts` — a focused call that identifies the language of the available metadata, seeding all field agents with the right search context
2. `field-agent.ts` — a generic per-field call accepting `(input, field, language, prevResponseId?, userMessage?)` that returns `{ proposal, responseId }`

New server actions in `enrich-field.ts` expose these as direct-parameter Next.js server actions (no FormData). The client fires N parallel transitions — one per field after language detection resolves — tracking state in a `Record<EnrichableField, FieldSlotState>` object at the panel/form level.

Per-field chat is handled by a new `FieldChatModal` component that manages conversation turns locally and threads calls via `previous_response_id`.

## Critical Implementation Details

**`previous_response_id` threading**: When retrying a field with user feedback, pass only the user's new message as `input` to `responses.create()` along with `previous_response_id: lastResponseId`. The OpenAI API reconstructs context from the prior response chain internally. The turn history displayed in the chat modal is purely for client-side display — it is NOT sent back to the API as message history.

**Language-first sequencing**: Language classification must fully resolve before any field agent call starts — the detected language string is an input to every field agent's prompt. In the client component, `await` the language action, then start parallel field transitions.

**Cover field discrimination**: `cover` returns `CoverProposal` while all other 9 fields return `FieldProposal<string> | null`. In the panel/form slot renderer, `field === 'cover'` renders the existing cover selector component; all other fields render MetaField.

**Review page error handling**: Currently `EnrichedReviewForm` deletes the draft and redirects on any enrichment failure. In the new client-side flow, enrichment failures are inline per-field errors. Remove the failure-triggered `deleteDraftAndBook` call from the server path entirely — the draft is only deleted when the user explicitly cancels.

---

## Phase 1: Multi-agent Enrichment Engine (Backend)

### Overview

Build the two new library modules, extend types and schema to include series/part, and expose four server actions for per-field enrichment (confirmed-book and draft variants).

### Changes Required

#### 1. Extend enrichment types

**File**: `src/lib/enrichment/types.ts`

**Intent**: Add series/part to `EnrichmentProposals`, introduce the `EnrichableField` union type, and add return types for the language classifier and field agent.

**Contract**:

- Add `series: FieldProposal<string> | null` and `part: FieldProposal<string> | null` to `EnrichmentProposals`
- Add `export type EnrichableField = 'title' | 'author' | 'isbn' | 'cover' | 'publisher' | 'language' | 'publishedDate' | 'description' | 'series' | 'part'`
- Add `export interface LanguageDetectionResult { language: string; responseId: string }`
- Add `export type FieldAgentResult = { proposal: FieldProposal<string> | CoverProposal | null; responseId: string }`

#### 2. Extend enrichment schema

**File**: `src/lib/enrichment/schema.ts`

**Intent**: Add JSON Schema blocks for series and part. Export a per-field schema map so `field-agent.ts` can select only the schema relevant to the field it's enriching.

**Contract**: Add `series` and `part` entries to `enrichmentProposalsSchema` following the same `anyOf: [fieldProposalShape, { type: 'null' }]` pattern as existing text fields. Also export `fieldSchemas: Record<EnrichableField, object>` — a map from each field name to its standalone JSON schema object (extracted from the properties of `enrichmentProposalsSchema`).

#### 3. Language classifier

**File**: `src/lib/enrichment/language-classifier.ts`

**Intent**: Detect the language of the available metadata (filename, embedded title/author) so field sub-agents know which language to search in. A book with a Polish filename and title should yield "Polish" so that all subsequent agents search Polish-language sources.

**Contract**: `export async function detectLanguage(input: EnrichmentInput): Promise<LanguageDetectionResult>` — single `responses.create()` call with a focused prompt (no JSON schema, just asking for a language name string); extracts `response.id` and the first text output item; throws `EnrichmentFailedError` on failure.

#### 4. Field agent

**File**: `src/lib/enrichment/field-agent.ts`

**Intent**: Generic per-field enrichment call that handles all 10 fields uniformly. Uses the detected language to steer search. Supports multi-turn retry via `previous_response_id`. Series/part prompt instructs the agent to split combined patterns (e.g., "Dune #1") into separate series name ("Dune") and part number ("1").

**Contract**:

```
export async function enrichField(
  input: EnrichmentInput,
  field: EnrichableField,
  language: string,
  prevResponseId?: string,
  userMessage?: string,
): Promise<FieldAgentResult>
```

Selects `fieldSchemas[field]` as the JSON schema for `text.format`, builds a field-focused language-aware system prompt, calls `responses.create()` with `previous_response_id` when `prevResponseId` is provided, extracts `response.id` and the parsed proposal; throws `EnrichmentFailedError` on failure.

#### 5. Per-field server actions

**File**: `src/app/actions/enrich-field.ts`

**Intent**: Expose the language classifier and field agent as typed Next.js server actions callable directly from client components without FormData. Separate confirmed-book and draft variants share the library functions but build `EnrichmentInput` from different DB sources.

**Contract**: Four exported `"use server"` functions:

- `detectLanguageAction(bookId: string): Promise<{ ok: true } & LanguageDetectionResult | { ok: false; message: string }>`
- `enrichFieldAction(bookId: string, field: EnrichableField, language: string, prevResponseId?: string, userMessage?: string): Promise<{ ok: true } & FieldAgentResult | { ok: false; message: string }>`
- `detectLanguageForDraftAction(draftId: string): Promise<{ ok: true } & LanguageDetectionResult | { ok: false; message: string }>`
- `enrichFieldForDraftAction(draftId: string, field: EnrichableField, language: string, prevResponseId?: string, userMessage?: string): Promise<{ ok: true } & FieldAgentResult | { ok: false; message: string }>`

Each validates session auth, looks up the book/draft from DB, constructs `EnrichmentInput`, calls the library function, and returns a typed result.

### Success Criteria

#### Automated Verification

- TypeScript compiles with no errors: `npx tsc --noEmit`
- `src/lib/enrichment/language-classifier.ts` exists and exports `detectLanguage`
- `src/lib/enrichment/field-agent.ts` exists and exports `enrichField`
- `src/app/actions/enrich-field.ts` exists and exports all four server actions
- `EnrichmentProposals` type includes `series` and `part` fields
- Linting passes: `npm run lint`

#### Manual Verification

- Calling `enrichField(sampleInput, 'title', 'English')` returns a valid `FieldAgentResult` with a non-empty `responseId`
- Calling `enrichField(sampleInput, 'series', 'English')` for a known series book returns a proposal with just the series name (no part number)
- Calling `enrichField` a second time with `prevResponseId` from the first call and a user message succeeds without error
- Calling `detectLanguage` with a Polish-language title/filename returns `{ language: 'Polish', responseId: '...' }`

**After completing this phase and verifying the above, pause for manual confirmation before proceeding to Phase 2.**

---

## Phase 2: Re-enrichment Panel — Per-Field Loading

### Overview

Refactor `enrich-metadata-panel.tsx` to fire per-field parallel server actions and show progressive per-field loading. Series and part now receive AI proposals. The global single-shot enrichment is replaced by the language-first → parallel-fields pattern.

### Changes Required

#### 1. Panel state and orchestration

**File**: `src/app/(app)/books/[id]/enrich-metadata-panel.tsx`

**Intent**: Replace the single `useActionState(enrichMetadataAction, ...)` enrichment call with per-field state management and parallel server action calls.

**Contract**:

- Add `type FieldSlotState = { status: 'idle' | 'loading' | 'done' | 'error'; proposal: FieldProposal<string> | CoverProposal | null; responseId: string | null; error: string | null }`
- New state: `fieldStates: Record<EnrichableField, FieldSlotState>` (all fields start 'idle')
- `languageStatus: 'idle' | 'loading' | 'done' | 'error'` tracks the language detection step
- Remove `useActionState(enrichMetadataAction, ...)` and all references to it
- Keep `useActionState(applyMetadataAction, ...)` unchanged
- When "Enrich" is clicked: set all field statuses to 'loading', call `detectLanguageAction(bookId)`, on success fire 10 parallel `enrichFieldAction` calls each in their own `startTransition`, each updating its `fieldStates` slice on completion or setting `status: 'error'` on failure

#### 2. MetaField loading state

**File**: `src/app/(app)/books/[id]/enrich-metadata-panel.tsx` (MetaField component)

**Intent**: Allow MetaField to render an animated skeleton when its field is loading, so the user sees per-field progress.

**Contract**: Add `loading?: boolean` prop; when true, render an animated `div` skeleton placeholder (matching Tailwind `animate-pulse` pattern used elsewhere in the codebase) instead of the input and proposal box. All existing behavior unchanged when `loading` is falsy.

#### 3. Cover field progressive loading

**File**: `src/app/(app)/books/[id]/enrich-metadata-panel.tsx` (cover section)

**Intent**: Show a skeleton where the cover selector appears while the cover sub-agent is running.

**Contract**: Conditionally render a skeleton `div` when `fieldStates.cover.status === 'loading'`, and the existing cover selector when 'done'. Cover proposal sourced from `fieldStates.cover.proposal as CoverProposal | null`.

#### 4. Series/part with proposals

**File**: `src/app/(app)/books/[id]/enrich-metadata-panel.tsx`

**Intent**: Wire series and part through the same field slot pattern as other fields, replacing the current `proposal={undefined}`.

**Contract**: Series and part MetaField instances receive `proposal={fieldStates.series.proposal as FieldProposal<string> | null}` and `loading={fieldStates.series.status === 'loading'}`.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- No references to `enrichMetadataAction` remain in `enrich-metadata-panel.tsx`

#### Manual Verification

- Clicking "Enrich" on a confirmed book shows "Detecting language…" then individual per-field skeletons
- Fields populate one by one as their sub-agents complete (not all at once)
- Series and part fields show AI proposals
- A failed field shows an inline error message; other fields are unaffected
- "Apply changes" saves all fields correctly

**Pause for manual confirmation after this phase before proceeding to Phase 3.**

---

## Phase 3: Per-Field Chat Modal

### Overview

Add the `FieldChatModal` component and wire it into the panel. Each completed field shows a "Retry" button; clicking it opens the modal where the user types guidance and the field sub-agent re-runs with `previous_response_id` conversation threading.

### Changes Required

#### 1. FieldChatModal component

**File**: `src/app/components/field-chat-modal.tsx`

**Intent**: A drawer/modal showing conversation history for one field, with a text input for user guidance. On submit, calls the appropriate server action with the prior response ID and user message appended as new input. Supports both the confirmed-book and draft flows via an `isDraft` flag.

**Contract**:

- Props: `field: EnrichableField; label: string; sourceId: string; isDraft: boolean; language: string; currentProposal: FieldProposal<string> | CoverProposal | null; responseId: string | null; open: boolean; onClose: () => void; onApply: (proposal: FieldProposal<string> | CoverProposal | null, responseId: string) => void`
- Local state: `turns: Array<{ role: 'user' | 'assistant'; content: string }>; inputValue: string; isPending: boolean`
- Initial `turns`: one assistant turn showing the current proposal's `value` (or `primary` URL for cover) and `provenance`
- On form submit: set `isPending = true`, call `enrichFieldAction` or `enrichFieldForDraftAction` with the last `responseId` as `prevResponseId`, append user + assistant turns to `turns`, update `responseId` from result, set `isPending = false`
- "Apply this suggestion" button calls `onApply` with the latest proposal and response ID; the modal stays open for further turns
- Uses Radix `Dialog` or `Sheet` (both available via `radix-ui` dependency)

#### 2. Retry wiring in panel

**File**: `src/app/(app)/books/[id]/enrich-metadata-panel.tsx`

**Intent**: Add "Retry" affordance to each completed field and integrate `FieldChatModal` with one-at-a-time locking so two fields cannot be retried simultaneously.

**Contract**:

- `retryingField: EnrichableField | null` state
- Each field slot with `status === 'done'` shows a small "Retry" button; clicking sets `retryingField` and disables all other retry buttons
- `<FieldChatModal>` mounted once at panel level; `open={retryingField !== null}`; receives `sourceId={bookId}` and `isDraft={false}`
- `onClose`: sets `retryingField` to null
- `onApply(proposal, responseId)`: updates `fieldStates[retryingField!]` with the new proposal and responseId, sets `retryingField` to null

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npx tsc --noEmit`
- `src/app/components/field-chat-modal.tsx` exists and exports `FieldChatModal`
- Linting passes: `npm run lint`

#### Manual Verification

- Clicking "Retry" on a completed field opens the chat modal with current proposal visible
- Typing a message and submitting shows loading then a new proposal in the modal
- "Apply this suggestion" closes the modal and updates the field in the panel
- All other retry buttons are disabled while the modal is open
- Closing the modal without applying preserves the original proposal
- A failed retry (network error) shows an error message inside the modal; the modal stays open

**Pause for manual confirmation after this phase before proceeding to Phase 4.**

---

## Phase 4: Import Review Flow Refactor

### Overview

Remove the blocking SSR enrichment from `page.tsx` and refactor `review-form.tsx` to trigger per-field enrichment client-side on mount, matching the pattern from Phases 2 and 3.

### Changes Required

#### 1. Review page — remove blocking SSR enrichment

**File**: `src/app/review/[id]/page.tsx`

**Intent**: Stop calling `enrichBook()` during server rendering. Render `ReviewForm` immediately with the draft's embedded metadata and let the form handle enrichment client-side.

**Contract**:

- Delete the entire `EnrichedReviewForm` async server component
- Remove the `isMissing` check and the `Suspense` boundary wrapping it
- Remove the `draft.proposals` branch (proposals are no longer read from or written to `book_drafts` in this flow)
- Always render `<ReviewForm bookId={id} embedded={embedded} filename={draft.filename} />`
- `filename` is a new prop passed down from the page (was previously passed only to the deleted `EnrichedReviewForm`)
- Remove imports: `enrichBook`, `EnrichmentFailedError`, `updateProposals`

#### 2. Review form — client-side per-field enrichment

**File**: `src/app/review/[id]/review-form.tsx`

**Intent**: Adopt the same per-field enrichment orchestration pattern established in Phase 2. Auto-trigger enrichment on mount. Show per-field loading state. Wire `FieldChatModal` for per-field retry with `isDraft={true}`.

**Contract**:

- Remove `proposals: EnrichmentProposals | null` prop; add `filename: string` prop
- Add `fieldStates: Record<EnrichableField, FieldSlotState>` state (same type as panel)
- `useEffect(() => { /* trigger enrichment on mount */ }, [])` — calls `detectLanguageForDraftAction(bookId)` then fires 10 parallel `enrichFieldForDraftAction` calls, updating `fieldStates` as each resolves
- Per-field MetaField instances receive `loading` prop based on field status; proposals sourced from `fieldStates`
- Cover selector shows skeleton while `fieldStates.cover.status === 'loading'`
- Series/part fields receive proposals from `fieldStates`
- `<FieldChatModal>` wired with `sourceId={bookId}` and `isDraft={true}`; same `retryingField` / `onApply` logic as panel
- `confirmReviewAction` call and cover selection logic remain unchanged — they read from field value state (user-edited strings), not from proposals

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npx tsc --noEmit`
- `review-form.tsx` does not import from `@/lib/enrichment/client` (old single-call)
- `page.tsx` does not import `enrichBook`, `updateProposals`, or `EnrichmentFailedError`
- Linting passes: `npm run lint`

#### Manual Verification

- Importing an epub with missing metadata navigates to `/review/[id]` immediately (no SSR wait)
- Individual fields populate progressively on the review page
- Series and part fields show proposals on the review page
- Per-field retry modal works on the review page
- Cancelling import still deletes the draft and returns to home
- Confirming import still uploads to Drive and transitions the draft to confirmed correctly
- Importing an epub with all metadata embedded shows null proposals quickly (no enrichment proposals needed)

---

## Testing Strategy

### Unit Tests

- `detectLanguage()` with an English-language input returns a non-empty `language` string and `responseId`
- `detectLanguage()` with a Polish-language title/filename returns `language: 'Polish'`
- `enrichField()` for the `series` field with "Dune" returns a proposal with `value` equal to the series name without a part number
- `enrichField()` with a `prevResponseId` from a prior call completes without error

### Integration Tests

- `detectLanguageAction(bookId)` returns `{ ok: true }` given a valid confirmed bookId and active session
- `enrichFieldAction(bookId, 'title', 'English')` returns `{ ok: true, proposal: ..., responseId: ... }` for a valid book
- `enrichFieldForDraftAction(draftId, 'author', 'English')` returns `{ ok: true }` given a valid pending draft

### Manual Testing Steps

1. Import an epub with no title/author/isbn → verify all 10 fields populate progressively on `/review/[id]`
2. Import an epub with all metadata → verify fields show null proposals quickly (no unnecessary API calls for already-authoritative values)
3. On a book detail page, click "Enrich" → verify per-field loading skeletons then proposals appear one by one
4. On a completed field, click "Retry", type "this is the second book in the series", verify the new proposal accounts for the feedback
5. Simulate a network failure mid-enrichment → verify per-field error states; other fields are unaffected
6. Apply enrichment after retry → verify saved metadata matches the last applied proposal
7. Verify that series/part proposals are now generated and saveable in both flows

## References

- Existing single-call enrichment (deprecated but kept): `src/lib/enrichment/client.ts:41`
- Cover proposal shape (distinct from FieldProposal): `src/lib/enrichment/types.ts:18`
- Series/part display logic (format contract): `src/app/(app)/books/[id]/page.tsx:77`
- `applyMetadataAction` (unchanged save path): `src/app/actions/enrich-metadata.ts:63`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Multi-agent Enrichment Engine (Backend)

#### Automated

- [x] 1.1 TypeScript compiles with no errors — c3403fc
- [x] 1.2 `language-classifier.ts` exists and exports `detectLanguage` — c3403fc
- [x] 1.3 `field-agent.ts` exists and exports `enrichField` — c3403fc
- [x] 1.4 `enrich-field.ts` exports all four server actions — c3403fc
- [x] 1.5 `EnrichmentProposals` type includes `series` and `part` — c3403fc
- [x] 1.6 Linting passes — c3403fc

#### Manual

- [x] 1.7 `enrichField` returns valid proposal and non-empty `responseId` — c3403fc
- [x] 1.8 `enrichField` for `series` field returns series name without part number — c3403fc
- [x] 1.9 `enrichField` with `prevResponseId` succeeds without error — c3403fc
- [x] 1.10 `detectLanguage` with Polish-language input returns `language: 'Polish'` — c3403fc

### Phase 2: Re-enrichment Panel — Per-Field Loading

#### Automated

- [x] 2.1 TypeScript compiles
- [x] 2.2 Linting passes
- [x] 2.3 No references to `enrichMetadataAction` in panel file

#### Manual

- [x] 2.4 Clicking "Enrich" shows per-field skeletons then proposals
- [x] 2.5 Fields populate progressively (not all at once)
- [x] 2.6 Series and part fields show AI proposals
- [x] 2.7 Failed field shows inline error; other fields unaffected
- [x] 2.8 "Apply changes" saves all fields correctly

### Phase 3: Per-Field Chat Modal

#### Automated

- [ ] 3.1 TypeScript compiles
- [ ] 3.2 `field-chat-modal.tsx` exists and exports `FieldChatModal`
- [ ] 3.3 Linting passes

#### Manual

- [ ] 3.4 Retry button opens chat modal with current proposal visible
- [ ] 3.5 Typing + submitting shows loading then new proposal
- [ ] 3.6 "Apply" closes modal and updates field in panel
- [ ] 3.7 Other retry buttons disabled while modal is open
- [ ] 3.8 Closing without applying preserves original proposal
- [ ] 3.9 Failed retry shows error in modal without closing it

### Phase 4: Import Review Flow Refactor

#### Automated

- [ ] 4.1 TypeScript compiles
- [ ] 4.2 `review-form.tsx` does not import from `@/lib/enrichment/client`
- [ ] 4.3 `page.tsx` does not import `enrichBook` or `updateProposals`
- [ ] 4.4 Linting passes

#### Manual

- [ ] 4.5 Import with missing metadata shows `/review/[id]` immediately, fields populate progressively
- [ ] 4.6 Import with complete metadata shows quick null proposals
- [ ] 4.7 Series/part show proposals on review page
- [ ] 4.8 Per-field retry modal works on review page
- [ ] 4.9 Cancel import still works (draft deleted, returns to home)
- [ ] 4.10 Confirm import still uploads to Drive and confirms the draft correctly
