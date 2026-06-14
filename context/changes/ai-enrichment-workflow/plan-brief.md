# Multi-Agent AI Enrichment Workflow — Plan Brief

> Full plan: `context/changes/ai-enrichment-workflow/plan.md`

## What & Why

Replace the single blocking AI enrichment call (one 28-second OpenAI request for all fields) with a multi-agent workflow: a language classifier fires first, then 10 parallel field sub-agents run simultaneously — including new series and part agents. Each field has a per-field retry modal where users can type guidance and have that specific agent re-run with conversation history preserved.

## Starting Point

`src/lib/enrichment/client.ts` makes one `responses.create()` call for all 8 fields at once. Series and part are manual-only (no AI proposals). The review page calls this blocking function during SSR. No per-field retry exists anywhere.

## Desired End State

A user importing or re-enriching a book sees individual fields populate progressively as each sub-agent finishes — no single long wait. Series and part now receive AI proposals in both flows. Each completed field shows a "Retry" button that opens a chat modal; the user types guidance ("this is the Polish edition") and the agent re-runs using `previous_response_id` conversation threading.

## Key Decisions Made

| Decision             | Choice                                                                  | Why (1 sentence)                                                                                  |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Which flows          | Both (import review + re-enrichment panel)                              | Consistent UX; both flows share the same library functions                                        |
| Field scope          | All 10 fields incl. series/part                                         | Task description explicitly calls out series/part; they're in the DB but currently unenriched     |
| Parallelism          | Language first, then all 10 fields in parallel                          | Language context is required by all field agents; parallel execution keeps wall time low          |
| Language effect      | Language injected into all field agent prompts                          | Non-English books currently get English-biased proposals; language steering fixes this            |
| State home           | Client-side React state only                                            | No DB change needed; page refresh re-triggers enrichment (acceptable)                             |
| Retry UX             | Modal/drawer chat panel per field                                       | User explicitly chose this over inline text input; supports multi-turn conversation               |
| Conversation history | Full history visible in modal; `previous_response_id` threads API calls | Agent learns from prior corrections; API handles context internally                               |
| Loading UX           | Per-field skeleton/spinner, fields populate as they complete            | Progressive feel even though total time may be similar                                            |
| Concurrent retries   | One at a time (others disabled while one modal is open)                 | Avoids race conditions in state; simpler UX                                                       |
| Field errors         | Fail gracefully per field with inline error + retry                     | One transient failure shouldn't block 9 successful proposals                                      |
| Delivery mechanism   | N parallel server actions, one per field                                | Fits existing server-action pattern; no SSE infrastructure needed                                 |
| Series format        | Series name only; Part = number/short string                            | Matches existing `composeFilename` and display logic; agent instructed to split combined patterns |

## Scope

**In scope:**

- New `language-classifier.ts` and `field-agent.ts` library modules
- Schema/types extended with series + part
- Four new server actions in `enrich-field.ts`
- `enrich-metadata-panel.tsx` refactored for per-field loading
- New `FieldChatModal` component
- `review-form.tsx` and `page.tsx` refactored to remove blocking SSR enrichment

**Out of scope:**

- DB schema changes
- SSE/streaming infrastructure
- Changes to `applyMetadataAction` / `confirmReviewAction`
- Removal of old `enrichBook()` function (cleanup follow-up)

## Architecture / Approach

Two new pure-function modules (`language-classifier.ts`, `field-agent.ts`) sit alongside the existing `client.ts`. Server actions in `enrich-field.ts` wrap them with auth/DB lookup, returning `{ ok: true, proposal, responseId }`. Client components fire all 10 field actions in parallel via `startTransition` after the language step resolves. `FieldChatModal` stores turn history locally and passes `previous_response_id` on retries — the API reconstructs context; the modal history is display-only.

## Phases at a Glance

| Phase                      | What it delivers                                                                                    | Key risk                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Multi-agent engine      | `language-classifier.ts`, `field-agent.ts`, `enrich-field.ts` server actions, extended types/schema | OpenAI `previous_response_id` threading — needs validation that context carries through correctly |
| 2. Panel per-field loading | `enrich-metadata-panel.tsx` refactored; series/part get proposals; per-field skeletons              | 10 parallel requests may hit OpenAI rate limits for a busy account                                |
| 3. Per-field chat modal    | `FieldChatModal` component; retry wiring; conversation history                                      | Radix modal/sheet integration; one-at-a-time locking state                                        |
| 4. Review flow refactor    | SSR enrichment removed from `page.tsx`; `review-form.tsx` uses client-side pattern                  | Review page currently deletes draft on failure — must be removed cleanly                          |

**Prerequisites:** Phase 1 must be complete before Phases 2–4. Phases 2, 3, and 4 should be done in order (Phase 3 adds retry to Phase 2's fields; Phase 4 reuses the same components).

**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- OpenAI rate limits: 10 parallel calls per enrichment session could trigger rate limits if the user re-enriches frequently; mitigation is a short delay or exponential backoff in the field agent
- `previous_response_id` availability: confirmed in openai@6.x Responses API but not tested in this codebase; Phase 1 manual verification catches any issues early
- Review page draft erasure removal: currently the SSR path deletes the draft on failure; removing this means a failed import leaves a stale draft — acceptable since the user can manually cancel

## Success Criteria (Summary)

- Individual fields populate progressively (not all at once) in both import review and re-enrichment flows
- Series and part fields receive and display AI proposals
- Per-field retry modal allows user-guided correction with conversation history preserved
