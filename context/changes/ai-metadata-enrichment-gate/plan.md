# AI Metadata Enrichment Gate Implementation Plan

## Overview

Re-sequence the existing import flow into a draft-then-confirm shape that lets the user review (and override) AI-proposed metadata before any book lands in the durable library. On drop, the epub's parsed metadata and raw bytes go into a draft books row (`review_state = 'pending'`) plus a `book_drafts` sidecar (BYTEA + JSONB). The user is redirected to `/review/<id>`, an RSC route that streams OpenAI-driven enrichment proposals into a per-field form with provenance + alternatives. On confirm, the bytes upload to Drive (replacing the silent upload S-01 did at import time), the books row is filled with confirmed values, and the draft is deleted. Closes PRD US-01, FR-003, FR-004, Business Logic, NFR-Latency, NFR-Privacy.

## Current State Analysis

- **S-01 import flow runs end-to-end inside `importEpubAction`** (`src/app/actions/import-epub.ts:30-97`): parse → Drive upload → books INSERT. No AI call. No review step. Title gets a filename fallback (line 54-55); other fields persist as nullable.
- **The parser already returns `null` for missing fields** (`src/lib/epub/parse.ts:5-10`). The gaps S-02 needs to fill are detectable today — no parser changes required.
- **Schema in place**: `books.title` is NOT NULL; `author / isbn / cover_bytes / cover_mime` are NULL-able; `drive_file_id TEXT NOT NULL` (`src/lib/db/migrations/0002_library_schema.mts:18`). The NOT NULL on `drive_file_id` blocks the draft-before-upload row this plan introduces and is relaxed by the Phase 1 migration.
- **Drive helpers reusable as-is**: `getDriveClient()`, `getOrCreateLibraryFolder()`, `uploadBookToDrive()`, `findAvailableFilename()` (`src/lib/drive/*`). `confirmReviewAction` calls them at confirm time.
- **`DriveAuthError` redirect pattern** (`src/app/actions/import-epub.ts:90-93`) — `confirmReviewAction` mirrors it.
- **`useActionState` + discriminated-union return is the codebase convention** (`src/app/components/import-dropzone.tsx`, `src/app/actions/check-drive.ts`). New actions follow it. `redirect()` inside a server action navigates correctly through `useActionState`.
- **No OpenAI client, no `OPENAI_API_KEY` config.** Phase 2 introduces both via the official `openai` npm SDK.
- **No JSONB column convention in this repo yet.** node-postgres serializes JS objects to JSON automatically for `jsonb` columns; Kysely passes the value through. Verify on the first migration round.
- **`composeFilename` + `sanitizeSegment` live inside `import-epub.ts`** (lines 18-28) — the confirm action needs them too, so they move to `src/lib/drive/upload.ts`.

## Desired End State

A signed-in operator drops a `.epub` on `/`. The server parses the file, INSERTs a pending books row, INSERTs a draft sidecar with the epub bytes, and redirects to `/review/<id>`. The review page:

1. Renders immediately with a Suspense skeleton for the AI-derived parts.
2. Streams in OpenAI-derived proposals for missing fields, with a short provenance phrase ("matches 12 external sources") and a low/high confidence chip per field.
3. For each field, shows the recommended value (embedded if present, else top AI proposal) pre-selected. A "Show other options" expander surfaces alternatives. A free-text override is always available. Cover proposals render as a primary preview plus a thumbnail row inside the expander.
4. A single "Save & import" button commits all selections. A Cancel button deletes everything.

On Save: chosen cover URL (if AI-picked) is fetched server-side (5 s timeout, ≤ 5 MB, `image/*` only); the epub bytes are read from `book_drafts.staged_bytes`; the Drive filename is composed from confirmed author + title; `findAvailableFilename` picks a non-colliding name; `uploadBookToDrive` writes the file; the books row UPDATEs `drive_file_id`, `title`, `author`, `isbn`, `cover_bytes`, `cover_mime`, `review_state='confirmed'`; the `book_drafts` row is DELETEd; the user is redirected to `/`.

On Cancel or AI hard-fail: the books row (cascade drops the draft) is deleted; the user is redirected to `/`; on hard-fail, an inline banner shows the cause via `?error=enrichment_failed`.

Verification: drop an epub with all metadata complete → review page shows only embedded values (no AI call, no chips) → one click confirms. Drop an epub with `<dc:title>` missing → review page shows top AI title with provenance + confidence + alternatives. Drop a malformed epub → existing inline error on the dropzone (no draft row). Disconnect from OpenAI → user is sent home with `?error=enrichment_failed`; no orphan rows.

### Key Discoveries

- `confirmReviewAction` reuses `uploadBookToDrive` and `findAvailableFilename` without modification — the Drive helpers don't know about review state.
- `drive_file_id NOT NULL` (`0002_library_schema.mts:18`) is the only schema friction; relaxing it is the migration's central change.
- `redirect()` inside a server action throws `NEXT_REDIRECT`; the framework intercepts before the action's return type matters. `useActionState`'s state stays at its initial value on redirect; the dropzone's `state?.ok === true` branch becomes unreachable post-redirect.
- React Suspense boundaries inside RSC stream their fallback first, then replace with resolved content on the same HTTP response — no client polling for the 30 s budget.
- `cover_bytes BYTEA` (`0002_library_schema.mts:23`) already accepts the chosen cover at confirm time; no schema change for cover storage.

## What We're NOT Doing

- **No library list / book-detail view.** S-03 owns those; post-confirm redirect lands on `/`.
- **No re-enrichment after confirm.** Once `review_state='confirmed'`, the gate cannot be re-entered. Future "edit book" slice (not on the roadmap) owns that.
- **No background worker / queue.** The AI call runs inside the RSC render via Suspense streaming. The 30 s NFR fits a single request.
- **No per-field AI streaming.** The first cut blocks on the whole OpenAI response before rendering proposals; per-field streaming is a future optimization if perceived latency demands it.
- **No persistent OpenAI response cache.** Each import calls OpenAI fresh. ISBN-keyed caching is deferred (single-user, low volume; cost stays in pennies/month).
- **No edit affordance on already-imported books.** Out of scope per Q12.
- **No CHECK constraint on `review_state`.** Per F-02 convention ("No CHECK constraints"); a TS union enforces values at the boundary.
- **No retry on AI failure.** Hard-fail per Q11; user retries by re-dropping the file.
- **No automatic draft TTL / cleanup sweeper.** Drafts persist until the user confirms or cancels; orphans (tab-close without action) accumulate. Acceptable for single-user MVP; a future slice can sweep.
- **No SSRF hardening on the cover-fetch URL beyond size/timeout/content-type.** Trust model: AI-generated URLs picked by the user. Threat is adversarial AI, low-probability for MVP.
- **No exposed enrichment-input UI.** The user does not see or edit what gets sent to OpenAI; the `EnrichmentInput` shape is internal.
- **No `frontMatterStrings` extraction yet.** The parser doesn't pull front-matter today; the field is wired through as an empty array in Phase 2. A future enrichment-quality slice can add the extraction.

## Implementation Approach

Two phases.

**Phase 1** sets up the persistence + flow scaffolding without the AI. By the end of Phase 1, a user can drop an epub, see a review page with embedded metadata in free-text inputs, save, and find the book in Drive + DB exactly as today — but with the new flow shape. This is the testable cut: persistence model + Drive-on-confirm + form round-trip all proven on a known-good (AI-free) foundation.

**Phase 2** plugs OpenAI in. The enrichment call becomes an async server function awaited inside a Suspense boundary on the review page. Proposals stream into a richer form with provenance, confidence chips, and the "Show alternatives" expander. Cover URLs surface as thumbnails. Hard-fail behavior wires through to the home page's error banner. End-state: PRD US-01 / FR-003 / FR-004 / Business Logic / NFR-Latency / NFR-Privacy all satisfied.

## Critical Implementation Details

### Privacy boundary: one chokepoint module

`src/lib/enrichment/client.ts` exports exactly one function — `enrichBook(input: EnrichmentInput): Promise<EnrichmentProposals>` — and is the only place in the codebase that talks to OpenAI. The `EnrichmentInput` type (in `src/lib/enrichment/types.ts`) has exactly these fields: `filename`, `embeddedTitle`, `embeddedAuthor`, `embeddedIsbn`, `frontMatterStrings: string[]`. Book body text has no path into this type, so it has no path to the network. Privacy is enforced by the type system + one reviewable module; any new field requires editing both files.

### Always-show-gate even when nothing is missing

PRD Business Logic says complete-metadata imports are silent; the user explicitly chose to override (Q4). When all four embedded fields are present (title, author, isbn, cover), the review page renders without an AI call — proposals stay null in `book_drafts`. The form pre-populates from embedded values; the user clicks Save to confirm. Single round-trip; no enrichment cost.

The "is anything missing" check is: title is null/empty, OR author is null/empty, OR isbn is null/empty, OR cover is null. Any one triggers AI.

### Drive-on-confirm filename composition

Move `sanitizeSegment` + `composeFilename` from `src/app/actions/import-epub.ts:18-28` into `src/lib/drive/upload.ts` so the confirm action reuses them without a layering violation (app code importing from `app/actions/...`). Behavior unchanged: replace `/ \ : * ? " < > |` with `_`, collapse whitespace, trim leading/trailing whitespace and dots, cap each segment at 100 chars, substitute `unknown` on empty.

### Cover storage and the chosen-cover path

The embedded cover, when present, is stored in `books.cover_bytes` / `cover_mime` at *draft-insert* time. This means: by the time the review page renders, the embedded cover (if any) is already addressable from the DB row — the form can render `data:<mime>;base64,…` directly from the prop.

On confirm:
- `coverChoice = "embedded"`: leave `cover_bytes` alone.
- `coverChoice = "ai:<url>"`: server-side fetch the URL (rules below), overwrite `cover_bytes` + `cover_mime`.
- `coverChoice = ""` or unknown: both stay null.

Cover-fetch rules (`confirmReviewAction`): `url.startsWith("https://")`, `AbortSignal.timeout(5000)`, response `content-type` starts with `image/`, body length cap 5 MB (stream-read + abort on overflow). On any violation, return `{ok: false, message: "Could not download the chosen cover. Pick another or skip."}` without mutating any state.

### OpenAI Responses API + Structured Outputs

`enrichBook` calls OpenAI's Responses API with `tools: [{type: "web_search"}]` and a JSON-Schema structured output that mirrors `EnrichmentProposals`. Model defaults to `gpt-4.1-mini` (cost-optimal at MVP scale, supports tools + structured outputs per August 2025 cutoff); overridable via `OPENAI_MODEL` env var. The prompt instructs the model to use web search for canonical metadata, return up to 3 alternatives per text field, up to 3 cover URLs, one provenance phrase, and a high/low confidence flag.

**Verification when implementing**: OpenAI API surface evolves; confirm the current Responses API shape, `web_search` tool name/availability per model, and `response_format: { type: "json_schema", strict: true }` behavior against live docs before wiring.

Timeout: `AbortSignal.timeout(28000)` — the NFR is 30 s end-to-end; reserve ~2 s for the DB write + render.

### Hard-fail on AI error: delete + redirect

The `/review/[id]` page awaits `enrichBook` inside a try/catch. On `EnrichmentFailedError` (network / timeout / parse / schema failure), it `deleteDraftAndBook(bookId, userId)` and `redirect("/?error=enrichment_failed")`. The home page reads `searchParams.error` and renders an inline banner above the dropzone.

The Suspense boundary wraps only the form body — not the page chrome (header, file name) — so the user sees a streamed skeleton with the page already navigated, not a blank screen for the 30 s budget.

### JSONB columns + Kysely

`book_drafts.proposals` is JSONB. node-postgres auto-serializes JS objects for `jsonb` columns; Kysely passes the value through. TS interface: `proposals: ColumnType<EnrichmentProposals | null, EnrichmentProposals | null, EnrichmentProposals | null>` (same type all three positions). If `pg` complains on insert (it shouldn't), wrap in `sql\`${JSON.stringify(value)}::jsonb\``. Verify on Phase 1's first migrate-run.

### `drive_file_id` becomes nullable

Phase 1 migration: `ALTER TABLE books ALTER COLUMN drive_file_id DROP NOT NULL`. Existing rows (S-01-imported) keep their non-null values. New pending rows insert with `drive_file_id: null`. `confirmReviewAction` UPDATEs it along with `review_state`. S-03 (library list) must filter `WHERE review_state = 'confirmed'` to exclude pending rows; that's a handoff for the next slice, not a Phase 2 concern.

## Phase 1: Draft persistence + Drive-on-confirm + skeleton review page

### Overview

Stand up the new persistence model and the gate's structural shape without any AI. The user can drop an epub, see a review page with embedded fields in free-text inputs, save, and find the result in Drive + DB — equivalent to today's S-01 outcome but routed through the new flow.

### Changes Required

#### 1. Schema migration: `review_state`, `drive_file_id` nullable, `book_drafts` table

**File**: `src/lib/db/migrations/0003_book_drafts.mts` (new)

**Intent**: Three coordinated changes in one migration so the new flow's persistence shape is atomic. Adds `review_state` to books with `DEFAULT 'confirmed'` so existing S-01 rows are valid as-is. Relaxes `drive_file_id` NOT NULL so pending rows can defer the Drive upload. Creates `book_drafts` to hold staged epub bytes + AI proposals.

**Contract**:
- `up(db)` via Kysely schema builder:
  - `ALTER TABLE books ADD COLUMN review_state TEXT NOT NULL DEFAULT 'confirmed'`. No CHECK constraint (per F-02 convention).
  - `ALTER TABLE books ALTER COLUMN drive_file_id DROP NOT NULL`.
  - `CREATE TABLE book_drafts`: `book_id UUID PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE`, `filename TEXT NOT NULL`, `staged_bytes BYTEA NOT NULL`, `proposals JSONB`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. (`filename` carries the original uploaded filename — needed for the enrichment prompt input and as a fallback for the Drive filename if the user clears the title field.)
- `down(db)`:
  - `DROP TABLE book_drafts`.
  - `ALTER TABLE books ALTER COLUMN drive_file_id SET NOT NULL` (errors if pending rows exist — intentional).
  - `ALTER TABLE books DROP COLUMN review_state`.

#### 2. Update Kysely types for the schema changes

**File**: `src/lib/db.ts`

**Intent**: Reflect the schema changes in `BooksTable` and add `BookDraftsTable`.

**Contract**:
- `BooksTable.drive_file_id`: `string | null` (was `string`).
- `BooksTable.review_state`: `Generated<'pending' | 'confirmed'>` — `Generated` because DEFAULT is set; callers can omit for confirmed, must specify 'pending' explicitly.
- New `BookDraftsTable`:
  - `book_id: string`
  - `filename: string`
  - `staged_bytes: Buffer`
  - `proposals: ColumnType<unknown | null, unknown | null, unknown | null>` for Phase 1 (Phase 2 swaps `unknown` for the concrete `EnrichmentProposals` type).
  - `created_at: Generated<Date>`
- `Database` interface: add `book_drafts: BookDraftsTable`.

#### 3. Book-drafts CRUD helpers

**File**: `src/lib/book-drafts.ts` (new)

**Intent**: One server-only module with the small set of CRUD ops the actions need. Keeps `src/app/actions/*` thin.

**Contract**:
- `import "server-only";`
- `createDraft({userId, filename, embeddedMetadata, stagedBytes, derivedTitle})`: in a single transaction, INSERT books `{user_id, drive_file_id: null, title: derivedTitle, author, isbn, cover_bytes, cover_mime, review_state: 'pending'}` then INSERT book_drafts `{book_id, filename, staged_bytes, proposals: null}`. Returns the new `bookId`.
- `getDraftWithBook(bookId, userId)`: SELECT join on books + book_drafts; returns null if not found, wrong user, or `review_state != 'pending'`.
- `deleteDraftAndBook(bookId, userId)`: DELETE FROM books WHERE id AND user_id AND review_state='pending' (cascade drops the draft).
- `confirmDraft(bookId, userId, confirmed: {title, author, isbn, coverBytes, coverMime, driveFileId})`: in a transaction, UPDATE books SET … review_state='confirmed', then DELETE FROM book_drafts WHERE book_id.
- Phase 2 adds `updateProposals(bookId, proposals)`.

#### 4. Modify import action: parse → draft → redirect

**File**: `src/app/actions/import-epub.ts`

**Intent**: Replace the existing Drive-upload + INSERT path with: parse → createDraft → redirect to `/review/<id>`. Parse errors stay inline on the dropzone (no redirect).

**Contract**:
- Keep `ImportEpubState` shape; keep the file-presence, file-size, and `EpubParseError` handling unchanged.
- After successful parse: resolve `userId` via existing `getUserIdByEmail`; compute `derivedTitle` via the existing filename-fallback logic.
- Call `createDraft({userId, filename: file.name, embeddedMetadata: {author: metadata.author, isbn: metadata.isbn, coverBytes: metadata.cover?.bytes ?? null, coverMime: metadata.cover?.mime ?? null}, stagedBytes: buffer, derivedTitle})`.
- `redirect(\`/review/${bookId}\`)`.
- Remove the DriveAuthError catch from this file (no Drive call here anymore).
- Remove unused Drive-helper imports; they move to the confirm action.

#### 5. Move filename helpers into the Drive module

**Files**: `src/app/actions/import-epub.ts`, `src/lib/drive/upload.ts`

**Intent**: `sanitizeSegment` + `composeFilename` move from the import action into `src/lib/drive/upload.ts` so the confirm action can reuse them without importing from `@/app/actions/...`.

**Contract**: `src/lib/drive/upload.ts` exports `composeFilename(author: string | null, title: string): string`. Behavior identical to the current copy. Delete the local copies in `import-epub.ts`.

#### 6. Review page (RSC) — skeleton form, no AI

**File**: `src/app/review/[id]/page.tsx` (new)

**Intent**: Render the review form for a pending draft. Phase 1 shows only embedded values; cover preview if embedded cover present. One Save button; one Cancel button.

**Contract**:
- `async function ReviewPage({ params }: { params: Promise<{ id: string }> })`.
- `await auth()`; redirect to `/signin` if missing.
- Resolve `userId`. Call `getDraftWithBook(id, userId)`; if null, redirect to `/`.
- Render the page chrome (header, file name) directly. Render `<ReviewForm bookId={id} embedded={...} proposals={null} />`.
- No AI call in Phase 1.

#### 7. Review form (client component)

**File**: `src/app/review/[id]/review-form.tsx` (new)

**Intent**: The form the user interacts with. Phase 1 shape: editable text inputs for title, author, isbn; cover preview (if embedded); Save & Cancel buttons.

**Contract**:
- `"use client";`
- Props: `bookId: string`, `embedded: { title, author, isbn, coverDataUrl: string | null }`, `proposals: unknown | null` (ignored in Phase 1).
- Two side-by-side `<form>`s (Save + Cancel) each using `useActionState` against `confirmReviewAction` and `cancelReviewAction`. Each form includes a hidden `<input name="bookId">`.
- Save form inputs: `<input name="title" defaultValue={embedded.title}>`, same for `author`, `isbn`. Cover preview from `coverDataUrl` (if present). Hidden `<input name="coverChoice" value="embedded">`.
- Cancel form has only the bookId hidden field + a button.
- Inline error rendering from the Save form's state.

#### 8. Confirm action

**File**: `src/app/actions/confirm-review.ts` (new)

**Intent**: Read the form, compose the filename, upload bytes to Drive, UPDATE the books row, delete the draft.

**Contract**:
- `"use server";`
- `export type ConfirmReviewState = null | { ok: false; message: string }` (success → redirect; no state).
- Read `bookId`, `title`, `author`, `isbn`, `coverChoice` from formData.
- `await auth()` + resolve `userId`.
- `getDraftWithBook(bookId, userId)` → if null, return `{ok: false, message: "Draft not found"}`.
- Compose filename: `composeFilename(author || null, title)`.
- `getDriveClient()`, `getOrCreateLibraryFolder(drive, email)`, `findAvailableFilename(drive, folderId, composed)` → `finalName`.
- `uploadBookToDrive(drive, folderId, finalName, draft.staged_bytes)` → `fileId`.
- `confirmDraft(bookId, userId, {title, author: author || null, isbn: isbn || null, coverBytes: <embedded cover bytes from the books row, unchanged for Phase 1>, coverMime: <unchanged>, driveFileId: fileId})`.
- Catch `DriveAuthError` → `signOut({redirect:false})` → `redirect("/signin?expired=1")`.
- Other errors: try a best-effort `drive.files.delete({fileId})` if upload succeeded but DB UPDATE failed; log; return generic message.
- Success: `redirect("/")`.

#### 9. Cancel action

**File**: `src/app/actions/cancel-review.ts` (new)

**Intent**: Delete the pending books row + cascaded draft. Redirect home. Idempotent.

**Contract**:
- `"use server";`
- `export async function cancelReviewAction(_prev: null, formData: FormData): Promise<null>`.
- Read `bookId`, `await auth()`, resolve `userId`.
- `deleteDraftAndBook(bookId, userId)`.
- `redirect("/")`.

#### 10. Dropzone — remove unreachable success branch

**File**: `src/app/components/import-dropzone.tsx`

**Intent**: The import action now `redirect()`s on success, so the `state?.ok === true` rendering branch is unreachable. Remove it. Keep the parse-error branch.

**Contract**: Drop the `state?.ok === true` block (the "Imported: …" rendering). Update the `ImportEpubState` import or local type if needed. Leave the `state?.ok === false` rendering and the dropzone interaction unchanged.

### Success Criteria

#### Automated Verification

- Migration runs cleanly on a fresh dev DB; `\d books` shows `review_state TEXT NOT NULL DEFAULT 'confirmed'` and `drive_file_id` NULL-able; `\dt` shows `book_drafts`.
- `npm run db:migrate:down` reverts `0003` cleanly when no pending rows exist.
- `npm run build` succeeds.
- `npm run lint` passes.
- `grep -nE "composeFilename|sanitizeSegment" src/app/actions/import-epub.ts` returns no matches.
- `grep -n "composeFilename" src/lib/drive/upload.ts` returns the new export.

#### Manual Verification

- Dropping a clean epub redirects to `/review/<id>` with embedded values pre-filled.
- Clicking "Save & import" lands the file in Drive at `Bookshelf/<author> — <title>.epub`, sets `review_state='confirmed'` + `drive_file_id` on the books row, deletes the `book_drafts` row.
- Re-dropping the same epub and confirming produces a `(2).epub` Drive sibling.
- Editing the title before save produces an updated Drive filename and books row title.
- Cancel deletes the books row + draft; nothing in Drive.
- Closing the tab post-upload + revisiting `/review/<id>` directly re-renders the form (the pending row survives).
- Dropping a malformed epub shows the existing inline error on the dropzone; no draft row.

**Implementation Note**: After Phase 1's automated checks pass, pause for manual confirmation of each round-trip path before starting Phase 2.

---

## Phase 2: OpenAI enrichment + provenance + alternatives + always-show-gate

### Overview

Plug the AI in. `enrichBook(input)` calls OpenAI with the privacy-scoped DTO and returns per-field proposals with provenance, confidence, and alternatives. The review page awaits enrichment inside a Suspense-streamed render; proposals flow into the form. The form gains the "Show alternatives" expander per text field, confidence chips, and a cover thumbnails row. Hard-fail on AI error deletes the draft + pending row and redirects home with `?error=enrichment_failed`.

### Changes Required

#### 1. Add OpenAI dependency + env

**Files**: `package.json`, `.env.example`

**Intent**: Install the official `openai` SDK; document the new env vars.

**Contract**:
- `package.json` dependencies: `openai` (latest stable).
- `.env.example`: `OPENAI_API_KEY=` (required), `OPENAI_MODEL=gpt-4.1-mini` (optional override).

#### 2. Enrichment types

**File**: `src/lib/enrichment/types.ts` (new)

**Intent**: Define the privacy-scoped input DTO and the proposals output shape. This file is the canonical reference for what crosses the network.

**Contract**:
- `export interface EnrichmentInput { filename: string; embeddedTitle: string | null; embeddedAuthor: string | null; embeddedIsbn: string | null; frontMatterStrings: string[]; }`
- `export type ConfidenceLevel = "high" | "low";`
- `export interface FieldProposal<T> { value: T; provenance: string; confidence: ConfidenceLevel; alternatives: T[]; }`
- `export interface CoverProposal { urls: string[]; primary: string; provenance: string; confidence: ConfidenceLevel; }` — `primary` is one of the URLs.
- `export interface EnrichmentProposals { title: FieldProposal<string> | null; author: FieldProposal<string> | null; isbn: FieldProposal<string> | null; cover: CoverProposal | null; }`

#### 3. JSON schema for OpenAI Structured Outputs

**File**: `src/lib/enrichment/schema.ts` (new)

**Intent**: A single JSON Schema describing `EnrichmentProposals`, passed to OpenAI's structured-output mode.

**Contract**: `export const enrichmentProposalsSchema = { … }` matching the type shape; `maxItems: 3` on alternative arrays and cover URLs; OpenAI strict-mode compliant (all fields required at object level; nullable types where the TS interface uses `| null`).

#### 4. Privacy-scoped OpenAI client

**File**: `src/lib/enrichment/client.ts` (new)

**Intent**: One function — `enrichBook(input)` — and the only place in the codebase that talks to OpenAI. Constructs the prompt, calls Responses API with the web_search tool and structured output, validates the response, returns typed proposals.

**Contract**:
- `import "server-only";`
- Lazy SDK client (env var read at first call).
- `export class EnrichmentFailedError extends Error { code = "ENRICHMENT_FAILED" as const; constructor(public reason: "network" | "timeout" | "parse" | "schema") { super(\`Enrichment failed: ${reason}\`); } }`
- `export async function enrichBook(input: EnrichmentInput): Promise<EnrichmentProposals>`:
  - Defense-in-depth caps: `input.frontMatterStrings = input.frontMatterStrings.slice(0, 10).map(s => s.slice(0, 200))`.
  - Build prompt via `buildEnrichmentPrompt(input)` from `./prompt.ts`.
  - Call `openai.responses.create({ model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", tools: [{ type: "web_search" }], input: prompt, response_format: { type: "json_schema", strict: true, schema: enrichmentProposalsSchema }, max_output_tokens: 2048 }, { signal: AbortSignal.timeout(28000) })`.
  - Parse the structured output as JSON; throw `EnrichmentFailedError("parse")` on failure.
  - Minimal runtime shape check (top-level keys present + types); throw `EnrichmentFailedError("schema")` on mismatch.
  - Map `AbortError` → `EnrichmentFailedError("timeout")`; map other fetch errors → `EnrichmentFailedError("network")`.

This module is the ONLY place that imports `openai`. PR review is the privacy gate.

#### 5. Prompt builder

**File**: `src/lib/enrichment/prompt.ts` (new)

**Intent**: Compose the user-facing prompt from `EnrichmentInput`; instruct the model on output shape.

**Contract**: `export function buildEnrichmentPrompt(input: EnrichmentInput): string`. The prompt instructs: use web_search; return values only for fields where embedded is missing OR higher-confidence sources exist (otherwise null per field); cover URLs must be direct image URLs (jpg/png/webp), not page URLs; provenance must be one short phrase; cap alternatives at 3 per field; cap cover URLs at 3. Embeds `input.filename`, `input.embeddedTitle`, etc. verbatim. **No book body content.**

#### 6. Book-drafts helpers: proposals support

**File**: `src/lib/book-drafts.ts`

**Intent**: Add `updateProposals`; tighten the proposals type to `EnrichmentProposals | null`.

**Contract**:
- `export async function updateProposals(bookId: string, proposals: EnrichmentProposals): Promise<void>` — UPDATE book_drafts SET proposals = $1 WHERE book_id = $2.
- `getDraftWithBook` return type tightens `proposals` to `EnrichmentProposals | null`.

#### 7. `db.ts` — concretize the proposals type

**File**: `src/lib/db.ts`

**Intent**: Swap the Phase-1 `unknown` for the concrete type now that it exists.

**Contract**: `BookDraftsTable.proposals: ColumnType<EnrichmentProposals | null, EnrichmentProposals | null, EnrichmentProposals | null>` with the import from `@/lib/enrichment/types`. Verify Kysely + node-postgres serialize JSONB on insert/update without an explicit `JSON.stringify` (the standard `pg` behavior); if not, switch to `sql\`${JSON.stringify(v)}::jsonb\`` at the call site.

#### 8. Review page — Suspense-wrapped enrichment + always-show-gate

**File**: `src/app/review/[id]/page.tsx`

**Intent**: If proposals aren't cached, decide whether to call AI (based on "is anything missing"); on hard-fail, delete + redirect.

**Contract**:
- After `getDraftWithBook`: if `draft.proposals` is non-null → render with cached proposals.
- Else: compute `isMissing = !embedded.title || !embedded.author || !embedded.isbn || !embedded.coverBytes`.
  - If `isMissing === false`: skip AI; render with `proposals: null`.
  - Else: render a `<Suspense fallback={<ReviewFormSkeleton />}>` containing an inner async component that:
    - Builds `EnrichmentInput` from `draft.filename` + embedded fields; `frontMatterStrings: []` for now (parser doesn't extract front-matter; deferred to a future enrichment-quality slice).
    - Calls `enrichBook(input)` inside try/catch.
    - On `EnrichmentFailedError`: `deleteDraftAndBook(bookId, userId)` then `redirect("/?error=enrichment_failed")`.
    - On success: `updateProposals(bookId, proposals)`; render `<ReviewForm proposals={proposals} … />`.
- Page chrome (header, file name, Cancel link) renders outside the Suspense boundary so the user sees the navigation immediately while AI runs.

#### 9. Review form — provenance, confidence chips, alternatives expander, cover gallery

**File**: `src/app/review/[id]/review-form.tsx`

**Intent**: For each field: pre-selected value (embedded if present else top AI proposal), a "Show other options" expander (collapsed by default), a provenance phrase, and a confidence chip. For cover: primary preview + thumbnail row inside the expander.

**Contract**:
- Props: `bookId`, `embedded` (Phase 1 shape), `proposals: EnrichmentProposals | null`.
- For each of title/author/isbn:
  - Initial value: `embedded.X` ?? `proposals?.X?.value` ?? `""`.
  - If `proposals?.X` exists: under the input, render `<small>{proposals.X.provenance}</small>` and a `<Chip variant={proposals.X.confidence}>` (low → amber, high → green; use existing Tailwind utility classes).
  - "Show other options" expander (Radix Collapsible — `radix-ui` already in deps) listing `proposals.X.alternatives` as radio buttons; selecting one updates the input value.
- For cover:
  - Default preview: embedded cover (data URL) if present, else `proposals?.cover?.primary` (as `<img src={url}>`).
  - Hidden `<input name="coverChoice">` initial value `"embedded"` (if embedded) or `\`ai:${proposals.cover.primary}\`` (if AI primary) or `""`.
  - Expander row: embedded thumbnail (if any) + each URL in `proposals.cover.urls` rendered as a clickable `<img>` thumbnail; click updates the primary preview and `coverChoice`.
- Save button submits the Save form; Cancel form unchanged.

#### 10. Confirm action — cover fetch on AI choice

**File**: `src/app/actions/confirm-review.ts`

**Intent**: When `coverChoice` starts with `"ai:"`, fetch the URL bytes server-side and use those as the cover. Otherwise reuse embedded (or null).

**Contract**:
- Parse `coverChoice`:
  - `"embedded"`: read embedded cover bytes from the `getDraftWithBook` join (books.cover_bytes / cover_mime).
  - `"ai:<url>"`: call local `fetchCover(url)` → `{ bytes: Buffer; mime: string }`; on rules-violation throw a tagged error.
  - `""` / unknown: cover stays null.
- On any cover-fetch error: return `{ok: false, message: "Could not download the chosen cover. Pick another or skip."}` without committing.
- `fetchCover(url)` rules (helper local to `confirm-review.ts`): `url.startsWith("https://")`; `fetch(url, { signal: AbortSignal.timeout(5000) })`; `content-type` starts with `image/`; stream-read with cumulative byte cap of 5 MB (abort + reject on overflow).

#### 11. Home page — show enrichment error banner

**File**: `src/app/page.tsx`

**Intent**: Read `searchParams.error` and render an inline banner above the dropzone for `enrichment_failed`.

**Contract**:
- Page accepts `searchParams: Promise<{ error?: string }>` (Next.js 16 async-searchParams shape).
- If resolved `error === "enrichment_failed"`, render a small red banner above the dropzone: "AI enrichment failed. Please try again."
- Other error values: ignore.

### Success Criteria

#### Automated Verification

- `npm run build` succeeds with `EnrichmentProposals` wired through `BookDraftsTable`.
- `npm run lint` passes.
- `grep -nE "import.*openai|new OpenAI|openai\\.responses" src/` returns matches ONLY in `src/lib/enrichment/client.ts`.
- The `EnrichmentInput` interface in `src/lib/enrichment/types.ts` contains exactly five fields: filename, embeddedTitle, embeddedAuthor, embeddedIsbn, frontMatterStrings (manual grep + read).

#### Manual Verification

- Epub with complete embedded metadata renders the gate without provenance chips; no OpenAI call (verify by inspecting OpenAI dashboard or local proxy logs).
- Epub missing `<dc:title>` renders a streaming skeleton briefly, then a proposed title with provenance caption + confidence chip + "Show other options" expander listing up to 3 alternatives.
- Epub missing `<dc:creator>`: same shape for the author field.
- Epub missing cover: AI cover preview + alternatives thumbnail row in the expander; clicking a thumbnail updates the primary preview and `coverChoice`.
- Save with default selections persists the chosen cover bytes (verify in psql).
- Save with an AI-picked cover triggers a server-side fetch and stores the bytes in `cover_bytes`.
- Cover URL that 404s or exceeds 5 MB returns an inline form error; user can re-pick.
- Forced OpenAI outage (revoke `OPENAI_API_KEY`, drop epub with missing field): page errors → draft + pending row deleted → user lands at `/?error=enrichment_failed` → red banner above dropzone.
- Network inspection during a real enrichment: the only outbound request from the page render is to OpenAI; payload contains only `EnrichmentInput`-shaped strings (filename / title / author / ISBN). No book body, no manifest content.

**Implementation Note**: After Phase 2's automated checks pass, pause for manual verification of each scenario above before declaring the slice done.

---

## Testing Strategy

### Unit Tests

None — no test runner configured (`CLAUDE.md`: "No test framework is configured yet"). Natural targets for a future suite: `src/lib/enrichment/client.ts` (mock the OpenAI SDK), `prompt.ts` (snapshot the generated prompt), and the cover-fetch helper (URL rules + size cap).

### Integration Tests

None automated. Migration runner + `npm run build` + the Manual Verification list act as the integration suite.

### Manual Testing Steps

End-to-end after both phases land:

1. Drop a clean, fully-embedded epub → review page (no AI call, no chips) → Save → book confirmed in DB + Drive.
2. Drop an epub missing `<dc:title>` → streaming skeleton → proposal arrives with provenance + confidence + alternatives → expand alternatives → pick one → Save → DB has confirmed value.
3. Drop an epub missing cover → AI cover preview + alternatives row → pick a different thumbnail → Save → fetched cover bytes are in `cover_bytes`.
4. Drop an epub during a forced OpenAI outage → page errors → redirected home → banner shown → no orphan rows.
5. Drop a malformed file → existing inline dropzone error → no draft row.
6. Cancel mid-review → draft + pending row gone → no Drive call.

## Performance Considerations

- **AI call dominates latency.** Web-search-tool calls on `gpt-4.1-mini` typically return in 8–20 s; the 28 s client-side timeout leaves ~2 s for the surrounding DB + render. If real-world calls trend toward the upper bound, fall back to a faster model or accept the budget overrun — document the actual observed latency post-deploy.
- **`book_drafts.staged_bytes` grows the row.** A 20 MB epub becomes a 20 MB JSONB-adjacent row. Postgres TOAST handles this transparently; only the confirm path SELECTs `staged_bytes` — other queries should project away.
- **Cover-fetch on confirm** is one extra HTTPS call (typically < 500 ms).
- **No N+1.** All DB calls in the review flow are by-primary-key. Drive calls (list folder, list-to-find-available-name, create) are O(1) per import.

## Migration Notes

- **Pre-deploy step for prod**: none. The migration adds a column with `DEFAULT 'confirmed'` (existing rows valid as-is), drops a NOT NULL (always safe), creates a new table. No data move required.
- **Rollback**: `npm run db:migrate:down` on `0003` fails if any pending rows exist (`SET NOT NULL` on `drive_file_id` would error). Operator must `DELETE FROM books WHERE review_state = 'pending';` first. This is the intended safety net — a rollback mid-review would lose user-visible state.
- **`OPENAI_API_KEY` must be set on Render before Phase 2 deploy.** Use `render env set OPENAI_API_KEY=… --service bookshelf-web` or the dashboard. Phase 1 deploy doesn't need it.

## References

- Roadmap entry: `context/foundation/roadmap.md` (S-02; PRD refs US-01, FR-003, FR-004, Business Logic, NFR Privacy / Latency)
- PRD: `context/foundation/prd.md` (Business Logic section; NFR-Privacy of book content; NFR AI enrichment latency)
- S-01 plan + existing import flow: `context/changes/epub-import-to-drive/plan.md`, `src/app/actions/import-epub.ts`
- F-02 schema + Kysely migration tooling: `context/changes/library-data-schema/plan.md`, `src/lib/db/migrations/0002_library_schema.mts`, `scripts/migrate.mts`
- Drive helpers: `src/lib/drive/upload.ts` (`uploadBookToDrive`, `findAvailableFilename` — re-used by `confirmReviewAction`)
- Parser: `src/lib/epub/parse.ts` (already returns nullable fields)
- useActionState pattern: `src/app/components/check-drive-button.tsx`
- Next.js 16 docs (verify against `node_modules/next/dist/docs/01-app/...` when implementing): server-action redirect, async searchParams shape, RSC Suspense streaming
- OpenAI Responses API + web_search tool: verify current shape against OpenAI docs at implementation time; defaults assume August 2025 cutoff
- **Handoff to S-03 (library view)**: must filter `WHERE review_state = 'confirmed'` to exclude pending drafts from the library list.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Draft persistence + Drive-on-confirm + skeleton review page

#### Automated

- [x] 1.1 Migration runs cleanly on a fresh dev DB; `\d books` shows `review_state` and `drive_file_id` NULL-able; `\dt` shows `book_drafts`
- [x] 1.2 `npm run db:migrate:down` reverts `0003` cleanly when no pending rows exist
- [x] 1.3 `npm run build` succeeds
- [x] 1.4 `npm run lint` passes
- [x] 1.5 `grep -nE "composeFilename|sanitizeSegment" src/app/actions/import-epub.ts` returns no matches
- [x] 1.6 `grep -n "composeFilename" src/lib/drive/upload.ts` returns the new export

#### Manual

- [ ] 1.7 Dropping a clean epub redirects to `/review/<id>` with embedded values pre-filled
- [ ] 1.8 Clicking "Save & import" lands the file in Drive and updates the books row to `review_state='confirmed'`
- [ ] 1.9 Re-dropping the same epub and confirming produces a `(2).epub` Drive sibling
- [ ] 1.10 Editing the title before save produces an updated Drive filename and books row title
- [ ] 1.11 Cancel deletes the books row + draft; nothing in Drive
- [ ] 1.12 Closing the tab post-upload + revisiting `/review/<id>` directly re-renders the form
- [ ] 1.13 Malformed epub shows the existing inline dropzone error; no draft row

### Phase 2: OpenAI enrichment + provenance + alternatives + always-show-gate

#### Automated

- [x] 2.1 `npm run build` succeeds with `EnrichmentProposals` wired through `BookDraftsTable`
- [x] 2.2 `npm run lint` passes
- [x] 2.3 `grep -nE "import.*openai|new OpenAI|openai\\.responses" src/` returns matches ONLY in `src/lib/enrichment/client.ts`
- [x] 2.4 `EnrichmentInput` in `src/lib/enrichment/types.ts` contains exactly filename / embeddedTitle / embeddedAuthor / embeddedIsbn / frontMatterStrings

#### Manual

- [ ] 2.5 Epub with complete embedded metadata renders the gate without provenance chips; no OpenAI call
- [ ] 2.6 Epub missing `<dc:title>` shows streaming skeleton then a proposed title with provenance + chip + "Show other options" expander
- [ ] 2.7 Epub missing `<dc:creator>` shows the same shape for the author field
- [ ] 2.8 Epub missing cover shows AI cover preview + alternatives row; selecting a thumbnail updates the primary
- [ ] 2.9 Save with default selections persists the chosen cover bytes
- [ ] 2.10 Save with an AI-picked cover triggers server-side fetch and stores the bytes
- [ ] 2.11 Cover URL that 404s or exceeds 5 MB returns an inline form error
- [ ] 2.12 Forced OpenAI outage deletes the draft + pending row and redirects to `/?error=enrichment_failed` with banner
- [ ] 2.13 Network inspection shows only filename / title / author / ISBN strings sent to OpenAI; no book body
