# Tag a Book Implementation Plan

## Overview

Two coupled improvements to tagging: (1) an AI button on the book detail page that uses web search to look up the book and propose 3–8 tags for one-click accept, and (2) library-side tagging — a per-card quick-tag popover plus a selection-mode bulk add — so users can tag many books without opening each one.

## Current State Analysis

All single-book tag plumbing is shipped. `src/lib/tags.ts` exposes `addTagToBook`, `removeTagFromBook`, `renameTag`, `listUserTags(WithCount)`, and `listBookTags`. Server actions `addTagAction` / `removeTagAction` / `renameTagAction` are in `src/app/actions/tags.ts`. The book detail page (`src/app/(app)/books/[id]/page.tsx`) hosts an inline `TagPicker` with autocomplete (`tag-picker.tsx`), and `/tags` provides global rename (`src/app/(app)/tags/`). The library (`src/app/components/library-view.tsx`) supports tag-chip filtering but has no UI to *apply* tags — that only happens on book detail.

The AI infrastructure for enrichment already uses the exact pattern this change needs: `src/lib/enrichment/client.ts` calls OpenAI Responses API with `tools: [{ type: "web_search" }]` and a strict JSON schema (`src/lib/enrichment/schema.ts`), with an `EnrichmentFailedError` differentiating network/timeout/parse/schema failures. The same prompt + schema pattern is the template for the new tag-suggestion module.

The current `LibraryView` is a client component already managing `searchQuery`, `activeTags`, and `view` state — selection state can join it. `BookCard` is the natural host for the per-card quick-tag affordance.

## Desired End State

On `/books/[id]`, a "Suggest tags" button next to the existing tag picker triggers an inline panel of 3–8 proposed tags (each labeled as existing or new). The user toggles which to accept and clicks "Apply" — selected tags are added to the book. On the library, every `BookCard` shows a small tag-button icon that opens a popover with autocomplete (same UX as the book-detail picker, scoped to one book). A "Select" toggle on the library puts cards into checkbox mode; selecting one or more books reveals a bulk action bar with "Add tag…" that adds the chosen tag(s) to all selected books in one transaction. Failures (AI down, network) surface as inline errors; the page remains interactive.

### Key Discoveries:

- Existing enrichment AI pattern is directly reusable (`src/lib/enrichment/client.ts:31` — `client.responses.create({ tools: [{ type: "web_search" }], text: { format: { type: "json_schema", strict: true, schema } } })`). The new module mirrors `client.ts`, `prompt.ts`, `schema.ts`, `types.ts` one-for-one.
- `OPENAI_API_KEY` and optional `OPENAI_MODEL` env vars are already wired (`src/lib/enrichment/client.ts:18`), default model `gpt-4.1-mini`. No new env work needed.
- `addTagToBook` (`src/lib/tags.ts:52`) uses an `onConflict … doNothing` upsert pattern in a transaction — already idempotent on `(user_id, name)` and `(book_id, tag_id)`. The new bulk function reuses this shape.
- PRD NFR forbids book body text leaving the device (`context/foundation/prd.md` — "no bytes of a book's body text leave the user's device"). AI input is restricted to metadata fields (title, author, ISBN) — front-matter strings are NOT used here, even though enrichment uses them at import time.
- `TagPicker` (`src/app/(app)/books/[id]/tag-picker.tsx`) is tightly coupled to its container layout. The library quick-tag popover needs its own lighter component rather than reusing `TagPicker` verbatim.
- `radix-ui/react-popover` is the natural primitive for the per-card popover; the project already uses Radix in the aggregated `radix-ui` package (see `package.json` dependency).

## What We're NOT Doing

- **No bulk remove from library.** Add-only semantics confirmed in design; removing a wrong tag is done from book detail.
- **No AI suggestions from the library** (single-book or bulk). AI button lives only on `/books/[id]`.
- **No tag delete** anywhere. Out of scope per the previous change (`context/changes/library-and-book-view/plan-brief.md:33`); still out of scope here.
- **No epub front-matter input to the AI** — privacy NFR. Title + author + ISBN only.
- **No drag-and-drop tag-onto-book** UX. Not chosen during questioning.
- **No keyboard shortcut for selection mode** (no Cmd+A, no shift-click range select). Click-to-toggle only.
- **No persistence of AI proposals.** If the user navigates away without applying, proposals are lost.

## Implementation Approach

Two phases, feature-aligned. Phase 1 builds the AI piece end-to-end (server module → server action → book-detail UI). Phase 2 builds the library tagging UX (quick-tag popover + selection mode + bulk action + new transactional action). The phases are independent — they could ship separately.

Both phases reuse the existing `useTransition` + `router.refresh()` pattern from `TagPicker` for client-server state coherence. Both phases reuse the existing `addTagAction` for single-book operations and only introduce one new server action: `applyTagsToBooks` (Phase 2).

## Critical Implementation Details

- **Privacy boundary for AI input.** The `suggestTagsAction` and `buildTagSuggestionPrompt` MUST only receive `{ title, author, isbn }` from the DB. Front-matter strings, note content, and book body bytes must not enter the prompt. Mirror the safety comment from `src/lib/enrichment/prompt.ts:33` ("Do NOT include any content from the book body").
- **Bulk transaction shape.** `applyTagsToBooks` runs inside a single Kysely `db.transaction()` — upsert all tags (one upsert per unique tag name), then insert all `book_tags` rows. Tags created for user A must never be visible to user B; every insert filters by `user_id`. Failure of any single tag insert rolls back the whole batch.
- **Schema constraint surface.** The DB has a unique constraint on `(user_id, name)` in `tags`. The `applyTagsToBooks` action must use `onConflict(["user_id", "name"]).doNothing()` to remain idempotent across repeated apply calls.

## Phase 1: AI Tag Suggestions on Book Detail

### Overview

Build the AI tag-proposal pipeline end-to-end: a new `src/lib/tag-suggestions/` module (mirroring the enrichment module structure), one new server action, and an inline `SuggestionsPanel` UI on `/books/[id]`.

### Changes Required:

#### 1. AI tag-suggestion library module

**File**: `src/lib/tag-suggestions/types.ts`

**Intent**: Define the proposal shape returned by the AI call. One book → an array of 3–8 tag proposals with provenance and an `isNew` flag.

**Contract**: Export `TagSuggestionInput = { title: string; author: string | null; isbn: string | null; existingTagNames: string[] }` and `TagProposal = { name: string; isNew: boolean; provenance: string }`. Export `TagSuggestionsResponse = { tags: TagProposal[] }`.

**File**: `src/lib/tag-suggestions/schema.ts`

**Intent**: Strict JSON schema for the OpenAI `responses.create` `json_schema` format. Constrains the output to a `tags` array of 3–8 items.

**Contract**: Export `tagSuggestionsSchema` — top-level object `{ type: "object", required: ["tags"], additionalProperties: false }` with `tags: { type: "array", minItems: 3, maxItems: 8, items: { type: "object", required: ["name", "isNew", "provenance"], properties: { name: {type:"string"}, isNew: {type:"boolean"}, provenance: {type:"string"} }, additionalProperties: false } }`.

**File**: `src/lib/tag-suggestions/prompt.ts`

**Intent**: Build the prompt string from the input. Instruct the model to use web_search, prefer the user's existing tags (case-insensitive match), and propose new tags only when no existing tag fits. Provenance must cite the source (e.g., "described as historical fiction on 3 bookseller listings"). Privacy notice mirroring `enrichment/prompt.ts:33`.

**Contract**: Export `buildTagSuggestionPrompt(input: TagSuggestionInput): string`. The prompt explicitly states: do NOT include or reference book body content; use only title, author, ISBN. Existing tags are passed as a bulleted list with the instruction to prefer them and set `isNew: false` when reused.

**File**: `src/lib/tag-suggestions/client.ts`

**Intent**: Run the OpenAI call, parse the response, validate against the schema. Throw a typed error on each failure mode.

**Contract**: Export `class TagSuggestionFailedError extends Error { code: "TAG_SUGGESTION_FAILED"; reason: "network" | "timeout" | "parse" | "schema" }` and `async function suggestTags(input: TagSuggestionInput): Promise<TagSuggestionsResponse>`. Mirror `src/lib/enrichment/client.ts:31` shape — same `OpenAI({ apiKey })` lazy singleton, same `client.responses.create({ model, tools: [{ type: "web_search" }], input: prompt, text: { format: { type: "json_schema", name: "tag_suggestions", strict: true, schema: tagSuggestionsSchema } }, max_output_tokens: 2048 }, { signal: AbortSignal.timeout(28000) })`. Same `isValid…` runtime guard. `"server-only"` import at the top.

#### 2. Server action

**File**: `src/app/actions/tag-suggestions.ts`

**Intent**: Authenticated server action that resolves the user, loads the book + existing tag names, calls `suggestTags`, and returns proposals to the client. Filters proposals so any `isNew: false` proposal that doesn't match an existing tag is dropped (the model occasionally hallucinates membership).

**Contract**: `"use server"` directive. Export `type SuggestTagsState = { ok: boolean; proposals?: TagProposal[]; message?: string }` and `async function suggestTagsAction(_prev: SuggestTagsState, formData: FormData): Promise<SuggestTagsState>`. Reads `bookId` from formData; redirects to `/signin` if no session. On `TagSuggestionFailedError`, returns `{ ok: false, message: "Could not get suggestions. Please try again." }` — does NOT redirect (inline error UX confirmed in questioning). Existing-tag membership check is case-insensitive.

#### 3. Inline suggestions panel UI

**File**: `src/app/(app)/books/[id]/suggestions-panel.tsx`

**Intent**: Client component rendered next to `TagPicker` on the book detail page. Hosts a "Suggest tags" button. When clicked, runs `suggestTagsAction`, displays a list of proposed tags as toggleable chips (selected by default), with provenance text under each and a "new" badge for `isNew: true` proposals. "Apply selected" commits via parallel `addTagAction` calls (or a single batch call — see contract). Inline error banner on failure.

**Contract**: Default export `function SuggestionsPanel({ bookId }: { bookId: string }): React.JSX.Element`. Internal state: `proposals: TagProposal[] | null`, `selectedNames: Set<string>`, `isLoading`, `error`. After successful apply, calls `router.refresh()` and resets `proposals` to `null` (hiding the panel). Uses the same `useTransition` pattern as `TagPicker` (`src/app/(app)/books/[id]/tag-picker.tsx:21`). Apply path: for each selected proposal, fire `addTagAction` in parallel via `Promise.all`; on any failure, surface a single error message.

#### 4. Wire SuggestionsPanel into book detail page

**File**: `src/app/(app)/books/[id]/page.tsx`

**Intent**: Mount `SuggestionsPanel` inside the same card that hosts the `TagPicker`, visually grouped.

**Contract**: Import `SuggestionsPanel` from `./suggestions-panel`. Render it inside the existing `<div className="mb-8 rounded-xl border border-zinc-200 bg-white p-6">` block, immediately below `<TagPicker … />`. Pass `bookId={book.id}`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (no `npm run typecheck` script — `next build` runs tsc)
- Linting passes: `npm run lint`

#### Manual Verification:

- On `/books/[id]`, clicking "Suggest tags" shows a loading state, then a panel with 3–8 proposals within ~30 seconds.
- Proposals visibly distinguish existing tags ("Fiction", plain chip) from new tags ("Memoir", with "new" badge).
- Toggling chips and clicking "Apply selected" adds the selected tags; panel collapses; `TagPicker` above shows the new tags after `router.refresh()`.
- With `OPENAI_API_KEY` unset, the button surfaces an inline red error banner; the rest of the page stays interactive.
- Network kill mid-call → inline timeout error; no redirect.
- The prompt sent to OpenAI (verify via temporary `console.log` if needed, then remove) contains only title/author/ISBN — no book body text.

**Implementation Note**: After Phase 1 ships and verifies, pause for manual confirmation before starting Phase 2.

---

## Phase 2: Library-Side Tagging (Quick-Tag + Bulk)

### Overview

Add two new ways to tag from the library page: (a) a per-card quick-tag popover for single-book operations, and (b) a selection mode + bulk action bar for tagging multiple books at once via a new transactional server action.

### Changes Required:

#### 1. Bulk apply server action

**File**: `src/lib/tags.ts`

**Intent**: New transactional function that upserts a set of tags and links each to a set of books in one transaction. Add-only semantics (existing links are no-ops). Tag matching is by name within the user.

**Contract**: Export `async function applyTagsToBooks(userId: string, bookIds: string[], tagNames: string[]): Promise<void>`. Wraps everything in `db.transaction().execute(async (trx) => …)`. For each unique `tagName`: upsert into `tags` with `onConflict(["user_id", "name"]).doNothing()`. Resolve the resulting tag IDs in one `selectFrom("tags").where("user_id", "=", userId).where("name", "in", tagNames)` query. Build `bookIds × tagIds` insert rows for `book_tags`, then `insertInto("book_tags").values(rows).onConflict(["book_id", "tag_id"]).doNothing()`. Return void; throws on transaction failure.

**File**: `src/app/actions/tags.ts`

**Intent**: New server action wrapping `applyTagsToBooks` with auth + form parsing.

**Contract**: Export `type BulkTagActionState = { ok: boolean; message?: string }` and `async function applyTagsToBooksAction(_prev: BulkTagActionState, formData: FormData): Promise<BulkTagActionState>`. Reads `bookIds` (comma-separated string), `tagNames` (comma-separated string). Trims and dedupes both lists. Returns `{ ok: false, message }` on validation failure (empty bookIds, empty tagNames) without hitting the DB.

#### 2. Quick-tag popover component

**File**: `src/app/components/quick-tag-popover.tsx`

**Intent**: Reusable client popover for tagging a single book from the library. Hosts a lightweight version of `TagPicker`'s autocomplete input — no chip list display (current tags aren't shown here; the popover is for *adding*). Closes on apply or escape. Reuses the existing `addTagAction`.

**Contract**: Default export `function QuickTagPopover({ bookId, allUserTags, trigger }: { bookId: string; allUserTags: Tag[]; trigger: React.ReactNode }): React.JSX.Element`. Built on Radix `Popover` (`radix-ui/react-popover`). Internal state: `input`, `error`, `isPending`. Calls `router.refresh()` on success. Suggestions list filters `allUserTags` by case-insensitive substring match — same logic as `tag-picker.tsx:23`.

#### 3. BookCard: tag affordance

**File**: `src/app/components/book-card.tsx`

**Intent**: Add a small tag-button icon overlay (visible on hover for grid variant, always visible inline for list variant) that opens `QuickTagPopover`. When the parent library is in selection mode, the tag-button is hidden and the card behaves as a selectable checkbox instead.

**Contract**: Extend `BookCardProps` with `allUserTags: Tag[]`, `selectionMode: boolean`, `selected: boolean`, `onSelectToggle: () => void`. When `selectionMode` is true: render a checkbox indicator (Tailwind ring + check icon), `onClick` calls `onSelectToggle`, and disable the underlying Link navigation. When false: standard card with a `<QuickTagPopover>` trigger button in the corner. Use Lucide `Tag` icon for the trigger, `Check` for selected state.

#### 4. LibraryView: selection mode + bulk action bar

**File**: `src/app/components/library-view.tsx`

**Intent**: Add selection state and a bulk action bar. A "Select" toggle button puts the library into selection mode (cards become checkboxes; quick-tag affordance hidden); selecting books reveals a sticky bar with "Add tag…" that opens a small inline input for one tag name (with autocomplete) and an "Apply" button that calls `applyTagsToBooksAction`. Exiting selection mode clears selection.

**Contract**: Extend internal state with `selectionMode: boolean`, `selected: Set<string>` (book IDs), `bulkInput: string`, `bulkError: string | null`. The bulk action bar renders only when `selectionMode && selected.size > 0`. Apply path: fire `applyTagsToBooksAction` with `bookIds = [...selected].join(",")` and `tagNames = bulkInput.trim()` (single tag for v1). On success: `router.refresh()`, clear selection, exit selection mode. Pass `allUserTags={tags}` and selection props down to each `BookCard`. The existing search/filter remain functional in selection mode (filters apply to which cards are visible, not which are selected — selecting a card then filtering it out keeps it selected but invisible; "Apply" still tags it).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Hovering a grid card reveals a tag icon; clicking it opens a popover with autocomplete; adding a tag shows in `/books/[id]` and as a filter chip on the library.
- Clicking "Select" turns cards into checkboxes; clicking cards toggles selection (does NOT navigate); the tag overlay is hidden.
- With 2+ books selected, the bulk action bar appears; entering a tag name + "Apply" tags all selected books in one network call.
- Applying an existing tag to a book that already has it is a no-op (no duplicate, no error).
- Applying a brand-new tag from the bulk bar creates the tag once (visible on `/tags` and as a filter chip) and links it to all selected books.
- Exiting selection mode (clicking "Select" again) clears all selected state.
- Two different signed-in users tagging the same tag name "Sci-Fi" produces two separate tag records (one per user); applying tags from user A doesn't link them to user B's books.

**Implementation Note**: After Phase 2 ships and verifies, pause for manual confirmation before closing the change.

---

## Testing Strategy

### Unit Tests:

No test framework is configured (CLAUDE.md: "No test framework is configured yet. Don't fabricate test commands"). Skip automated unit tests. Verification is via `npm run build` (type check) and `npm run lint`.

### Integration Tests:

Not applicable — no test runner.

### Manual Testing Steps:

1. **AI suggest happy path**: open a known book on `/books/[id]`, click "Suggest tags", wait, verify 3–8 proposals with provenance; toggle a few, Apply; verify they show on the `TagPicker` above.
2. **AI suggest empty existing tags**: on a user with zero tags, verify all proposals are flagged "new".
3. **AI suggest with many existing tags**: on a user with 20+ tags, verify the AI prefers reusing existing ones (most proposals come back `isNew: false`).
4. **AI suggest failure**: temporarily set an invalid `OPENAI_API_KEY` env var; verify inline error, no redirect.
5. **Quick-tag from library**: hover a card → click tag icon → autocomplete-pick an existing tag → verify book now has it.
6. **Quick-tag new tag from library**: type a brand-new tag name in the popover, press Enter, verify it appears in the library filter chips.
7. **Bulk add**: enter selection mode, select 3 books, enter "Sci-Fi" in bulk bar, Apply; verify all 3 books have the tag.
8. **Bulk add idempotent**: select 5 books where 2 already have the tag, apply the same tag again; verify no duplicates, no error.
9. **Selection mode + filter**: select 5 books, filter by an unrelated tag (selected cards hide), apply a tag; verify all 5 selected books still get tagged including the hidden ones. (Or, if this feels surprising, document it as intentional.)
10. **Cross-user isolation**: sign in as user B and confirm none of user A's bulk-applied tags appear.

## Performance Considerations

- AI tag suggestions take up to 28 seconds (matches the existing enrichment timeout in `src/lib/enrichment/client.ts:60`). UI must show a continuous loading indicator on the button — the privacy NFR explicitly mandates "continuous visible progress, not a frozen screen."
- Bulk apply does N+M database operations in one transaction (N upserts, 1 select, 1 multi-row insert). For 50 selected books × 1 tag this is ~3 round-trips; well below the 200ms filter NFR.
- The library list query (`listConfirmedBooks`) is unchanged — no extra columns fetched.
- `allUserTags` is passed from the server page into `LibraryView` and through to each `BookCard`'s `QuickTagPopover`. For a user with 1000 tags this is ~30KB of props per card render — acceptable but worth noting. If tag counts explode later, hoist the popover content to a single shared instance.

## Migration Notes

No schema changes. No data migration. Both phases ship behind no feature flag — they're additive UI on existing tables.

## References

- Existing tag data layer: `src/lib/tags.ts:9`
- Existing tag server actions: `src/app/actions/tags.ts`
- Existing inline tag picker: `src/app/(app)/books/[id]/tag-picker.tsx:8`
- Enrichment AI pattern to mirror: `src/lib/enrichment/client.ts:31`, `src/lib/enrichment/prompt.ts`, `src/lib/enrichment/schema.ts`
- Library client component to extend: `src/app/components/library-view.tsx:8`
- Book card to extend: `src/app/components/book-card.tsx`
- PRD privacy NFR (book body must not leave device): `context/foundation/prd.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: AI Tag Suggestions on Book Detail

#### Automated

- [x] 1.1 Type checking passes: `npm run build`
- [x] 1.2 Linting passes: `npm run lint`

#### Manual

- [ ] 1.3 On `/books/[id]`, clicking "Suggest tags" shows a loading state, then a panel with 3–8 proposals within ~30 seconds.
- [ ] 1.4 Proposals visibly distinguish existing tags ("Fiction", plain chip) from new tags ("Memoir", with "new" badge).
- [ ] 1.5 Toggling chips and clicking "Apply selected" adds the selected tags; panel collapses; `TagPicker` above shows the new tags after `router.refresh()`.
- [ ] 1.6 With `OPENAI_API_KEY` unset, the button surfaces an inline red error banner; the rest of the page stays interactive.
- [ ] 1.7 Network kill mid-call → inline timeout error; no redirect.
- [ ] 1.8 The prompt sent to OpenAI contains only title/author/ISBN — no book body text.

### Phase 2: Library-Side Tagging (Quick-Tag + Bulk)

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — 2e62499
- [x] 2.2 Linting passes: `npm run lint` — 2e62499

#### Manual

- [ ] 2.3 Hovering a grid card reveals a tag icon; clicking it opens a popover with autocomplete; adding a tag shows in `/books/[id]` and as a filter chip on the library.
- [ ] 2.4 Clicking "Select" turns cards into checkboxes; clicking cards toggles selection (does NOT navigate); the tag overlay is hidden.
- [ ] 2.5 With 2+ books selected, the bulk action bar appears; entering a tag name + "Apply" tags all selected books in one network call.
- [ ] 2.6 Applying an existing tag to a book that already has it is a no-op (no duplicate, no error).
- [ ] 2.7 Applying a brand-new tag from the bulk bar creates the tag once and links it to all selected books.
- [ ] 2.8 Exiting selection mode (clicking "Select" again) clears all selected state.
- [ ] 2.9 Two different signed-in users tagging the same tag name "Sci-Fi" produces two separate tag records; tagging by user A doesn't link to user B's books.
