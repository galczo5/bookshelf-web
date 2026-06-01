# AI Metadata Enrichment Gate — Plan Brief

> Full plan: `context/changes/ai-metadata-enrichment-gate/plan.md`

## What & Why

Re-sequence the existing import flow into a draft-then-confirm shape: epub bytes and parsed-metadata land in a `book_drafts` sidecar (`review_state='pending'` on the books row); the user is redirected to `/review/<id>`, an RSC route that streams OpenAI-driven enrichment proposals (with provenance + alternatives) into a per-field form; on confirm, the bytes upload to Drive and the books row is finalized. Closes PRD US-01 / FR-003 / FR-004 / Business Logic — the AI-assisted-metadata feature that the shape session called the differentiating insight, and S-01's deferred handoff.

## Starting Point

S-01 ships a one-shot `importEpubAction` (`src/app/actions/import-epub.ts:30-97`) that goes parse → Drive upload → books INSERT in a single server-action round-trip; no AI, no review step, filename-fallback for missing title. The parser (`src/lib/epub/parse.ts`) already returns `null` for missing fields, so the gaps are detectable today without parser changes. F-02 schema covers all the persistence (`books`, `users`, etc.); the only schema friction is `books.drive_file_id NOT NULL`, which blocks a draft-before-upload row. No OpenAI client, no JSONB column convention, no `/review/...` route yet.

## Desired End State

A signed-in operator drops a `.epub`. The server inserts a pending books row + draft sidecar (bytes + null proposals) and redirects to `/review/<id>`. The page chrome renders immediately; a Suspense boundary streams in the AI-enriched form body. Each field shows the recommended value (embedded if present, else top AI proposal) pre-selected, a short provenance phrase ("matches 12 external sources"), a low/high confidence chip, and a "Show other options" expander listing up to 3 alternatives. Cover shows a primary preview + a thumbnail row inside the expander. One "Save & import" button uploads the bytes to Drive, fetches the chosen cover URL if AI-picked, UPDATEs the books row, deletes the draft, and redirects home. Cancel deletes the books row + draft. AI hard-fail (network/timeout/parse/schema) deletes the draft + pending row and redirects home with `?error=enrichment_failed`.

## Key Decisions Made

| Decision                    | Choice                                                                              | Why (1 sentence)                                                                                                                              | Source |
| --------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Persistence model           | Draft row pre-review, UPDATE on confirm                                             | Survives tab-close/refresh; library list hides `pending` rows with a WHERE filter; AI proposals are a sidecar JSONB.                          | Plan   |
| Drive upload timing         | After confirm only — bytes buffered in `book_drafts.staged_bytes`                   | User wanted "no orphan files in Drive on reject"; Postgres BYTEA is durable across container restart unlike `/tmp`.                           | Plan   |
| Progress UX                 | RSC Suspense streaming on `/review/[id]`                                            | Native to Next.js 16 + React 19; no SSE/polling infra; page chrome navigates instantly while the form body streams.                           | Plan   |
| Review-step trigger         | Always show the gate, even when embedded metadata is complete                       | User explicitly chose this over PRD's "silent on complete" default; gives a single consistent flow and an override point for bad embeddeds.   | Plan   |
| Epub byte staging           | Postgres BYTEA on the `book_drafts` sidecar                                         | Transactional with the draft row; survives container restart; no new infra; 20 MB cap from existing `bodySizeLimit` keeps row size sane.      | Plan   |
| AI provider stack           | OpenAI GPT (default `gpt-4.1-mini`) + `web_search` tool + Structured Outputs        | User-chosen; one vendor / one key; structured output is mandatory for typed proposals; model is env-overridable.                              | Plan   |
| Privacy enforcement         | Typed `EnrichmentInput` DTO at the AI-call boundary (one chokepoint module)         | Type-checked; reviewable in one file; matches PRD NFR-Privacy (no book body bytes leave the device); discipline > runtime allowlist for MVP.  | Plan   |
| Alternatives UX             | Single best pick + "Show other options" expander                                    | Lowest visual noise on the happy path; alternatives capped at 3 per field; cover thumbnails appear inside the expander.                       | Plan   |
| Provenance display          | One short phrase + low/high confidence chip                                         | Matches PRD examples verbatim ("matches 12 external sources" vs "inferred from filename only"); fast visual read of trust level.              | Plan   |
| Per-field confirmation      | Editable inputs pre-populated with recommendation; single Save commits all          | One submit cycle; free-text override always available; "accept all" = press Save; "reject all" = clear inputs.                                | Plan   |
| Failure mode                | Hard fail — delete draft + pending row, redirect to `/?error=enrichment_failed`     | User-chosen; mid-import AI outage shouldn't leave half-broken rows; user retries by re-dropping the file.                                     | Plan   |
| Scope guard                 | One-shot at import only; no re-enrichment after confirm                             | Crisp slice boundary aligned to PRD wording ("before being persisted"); future "edit book" slice owns post-confirm corrections.               | Plan   |

## Scope

**In scope:**
- Migration `0003_book_drafts.mts`: `review_state` column, `drive_file_id` nullable, new `book_drafts` table (book_id, filename, staged_bytes, proposals JSONB, created_at)
- Kysely types in `src/lib/db.ts` for the schema changes
- `src/lib/book-drafts.ts` — createDraft / getDraftWithBook / deleteDraftAndBook / confirmDraft / updateProposals
- Modified `importEpubAction` — parse → createDraft → `redirect("/review/<id>")`
- New `src/app/review/[id]/page.tsx` (RSC) with Suspense-streamed enrichment
- New `src/app/review/[id]/review-form.tsx` (client) with alternatives expander + provenance + confidence chips + cover gallery
- New `confirmReviewAction` (uploads to Drive, fetches AI cover if picked, UPDATEs books, deletes draft)
- New `cancelReviewAction`
- `composeFilename` / `sanitizeSegment` moved from import action into `src/lib/drive/upload.ts`
- New `src/lib/enrichment/{types,schema,prompt,client}.ts` — `EnrichmentInput` DTO + `enrichBook(input)` OpenAI client + `EnrichmentFailedError`
- `openai` dep + `OPENAI_API_KEY` / `OPENAI_MODEL` env
- Home page reads `searchParams.error` and renders an enrichment-failed banner
- Dropzone unreachable-success branch removed

**Out of scope:**
- Library list / book-detail view (S-03 — must filter `WHERE review_state='confirmed'`)
- Re-enrichment after confirm / edit-after-confirm
- Background worker / queue
- Per-field AI streaming, ISBN-keyed response cache
- Draft TTL / orphan sweeper
- `frontMatterStrings` extraction in the parser (wired as empty array)
- Test framework introduction

## Architecture / Approach

```
Browser /                                Server                                   External
─────────────                            ─────────────────────────                ───────────
ImportDropzone           ─POST───►       importEpubAction
  (useActionState)                       ├─ auth() → userId
                                         ├─ parseEpub(buf) → embedded
                                         ├─ createDraft(books pending + book_drafts)
                                         └─ redirect("/review/<id>")
                         ◄─NEXT_REDIRECT─┘
                         ─GET────►       /review/[id]/page.tsx  (RSC)
                                         ├─ getDraftWithBook(id, userId)
                                         ├─ render chrome + <Suspense>
                                         │   └─ if missing: enrichBook(input) ───► OpenAI Responses API
                                         │       │                                  (web_search tool +
                                         │       │                                   structured outputs)
                                         │       ├─ EnrichmentFailedError? → deleteDraftAndBook + redirect "/?error="
                                         │       └─ updateProposals(...)
                                         └─ <ReviewForm proposals=...>
ReviewForm               ─POST───►       confirmReviewAction
  Save                                   ├─ getDraftWithBook
                                         ├─ composeFilename + findAvailableFilename
                                         ├─ uploadBookToDrive(staged_bytes) ─────► Drive files.create
                                         ├─ coverChoice "ai:<url>"? fetchCover ──► HTTPS image fetch
                                         ├─ confirmDraft (UPDATE books, DELETE draft)
                                         └─ redirect("/")

ReviewForm               ─POST───►       cancelReviewAction
  Cancel                                 └─ deleteDraftAndBook → redirect("/")
```

`src/lib/enrichment/client.ts` is the only module that imports `openai`; the `EnrichmentInput` type at the boundary is the privacy chokepoint.

## Phases at a Glance

| Phase                                                | What it delivers                                                                                                                                                                                                                  | Key risk                                                                                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Draft persistence + Drive-on-confirm + skeleton   | Schema migration, draft CRUD helpers, modified import action, new `/review/[id]` (no AI yet), confirm + cancel actions, filename helper move. End: full round-trip works without AI.                                              | JSONB + Kysely + node-postgres roundtrip: verify objects serialize on insert; if not, wrap with `sql\`…::jsonb\``. Low risk but warrants the first migrate-run.   |
| 2. OpenAI enrichment + provenance + alternatives     | `enrichment/*` modules, OpenAI Responses API + `web_search` tool + structured outputs, hard-fail flow, Suspense-streamed form, provenance + confidence chips, alternatives expander, cover gallery + URL fetch, error banner.     | 30 s NFR budget vs. real-world `gpt-4.1-mini` + `web_search` latency: 28 s client-side timeout reserves ~2 s; if real calls trend longer, fall back model needed. |

**Prerequisites:** S-01 (epub-import-to-drive) deployed end-to-end. F-02 schema in place. Operator session with the `users` row already bootstrapped. Phase 2 also needs `OPENAI_API_KEY` configured on Render.

**Estimated effort:** ~2–3 after-hours sessions. Phase 1 is mostly type + persistence + UI scaffolding (no external surface). Phase 2 is the OpenAI prompt/schema/client + the richer form + the error path.

## Open Risks & Assumptions

- **OpenAI API shape drift.** The Responses API + `web_search` tool + Structured-Outputs `strict: true` behavior should be verified against live docs at implementation time (August 2025 cutoff may have moved). Worst case is a small adapter rewrite inside `client.ts`.
- **`gpt-4.1-mini` + `web_search` latency variance.** Typical 8–20 s, tail extends to 30+ s. If the tail blows the budget, fall back to a leaner model and accept slightly weaker proposals, or document the budget overrun and revisit.
- **JSONB serialization through Kysely.** node-postgres should serialize JS objects for `jsonb` columns without a manual `JSON.stringify`. Verify on the first `npm run db:migrate`-then-insert round; fallback is `sql\`${JSON.stringify(v)}::jsonb\`` at the call sites.
- **Cover-URL trust model.** AI returns URLs; user clicks one; server fetches. Threat is an adversarial AI pointing to a malicious target. MVP mitigations: HTTPS-only, 5 s timeout, 5 MB cap, `image/*` content-type. No SSRF allow-list. Acceptable for a single-user app; a future hardening slice can add it.
- **Always-show-gate vs PRD silent-import.** User override of PRD Business Logic ("silent for complete-metadata epubs"). Documented and recorded; downstream slices should treat the gate as universal.
- **Orphan drafts on tab-close.** No TTL sweeper in this slice. Single-user MVP: acceptable; a future sweep job can clean up `book_drafts` older than N days.
- **Front-matter strings not extracted yet.** Parser change deferred; `frontMatterStrings: []` is the call site value. Proposal quality for unusual files may suffer until a later slice extracts these.

## Success Criteria (Summary)

- A signed-in operator can drop an epub, review AI-proposed values for missing fields (with provenance + chip + alternatives expander), confirm, and land the book in Drive + DB — single Save click, no manual file moves, no left-behind rows.
- A drop with complete embedded metadata routes through the gate but skips the OpenAI call entirely — Save commits embedded values; no enrichment cost.
- AI failures (network / timeout / parse / schema) hard-fail cleanly: no orphan books row, no orphan draft, no orphan Drive file; user sees an inline banner on `/`.
- Network inspection confirms only `EnrichmentInput`-shaped strings (filename, embedded title/author/ISBN, capped front-matter list) leave the server — no book body bytes.
