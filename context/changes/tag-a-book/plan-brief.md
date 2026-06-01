# Tag a Book — Plan Brief

> Full plan: `context/changes/tag-a-book/plan.md`

## What & Why

Two improvements on top of the shipped tag system: (1) tag books directly from the library — quick-tag popover per card plus a selection-mode bulk add — and (2) an "AI suggest tags" button on the book detail page that uses web search to propose 3–8 tags. Today, applying a tag requires opening each book one at a time, and tag discovery is purely manual.

## Starting Point

All single-book tag plumbing exists: `src/lib/tags.ts` exposes add/remove/rename, server actions wrap them, the book detail page has an inline `TagPicker` with autocomplete, and `/tags` provides global rename. The library page only supports *filtering* by tag — there is no way to *apply* a tag from there. The enrichment AI module (`src/lib/enrichment/`) already uses the exact OpenAI Responses + `web_search` + structured-output pattern this change needs.

## Desired End State

On `/books/[id]`: a "Suggest tags" button next to the `TagPicker` opens an inline panel of 3–8 proposals (each labeled as existing or new), the user toggles which to accept, and "Apply" adds them. On the library: every `BookCard` shows a small tag icon that opens a popover for single-book tagging, and a "Select" toggle puts the library into checkbox mode where selecting books reveals a bulk action bar with "Add tag…" that tags every selected book in one transaction.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Library tagging UX | Quick-tag popover per card + selection-mode bulk | Optimal in both single-book and "just imported 10 books" cases | Plan |
| Bulk server action | New transactional `applyTagsToBooks(bookIds, tagNames)` | One round-trip, atomic, idempotent via existing onConflict patterns | Plan |
| AI button location | Book detail page only | Mirrors enrichment-review pattern; book detail already loads full context | Plan |
| AI tag scope | Prefer existing user tags, allow new with `isNew` flag | Keeps the taxonomy from sprawling while still capturing fresh concepts | Plan |
| AI review UX | Inline panel below tag picker (toggleable chips + Apply) | No modal stacking against the Tiptap notes modal; clear sub-step of tagging | Plan |
| AI input | Metadata only (title, author, ISBN) | PRD NFR forbids book body bytes leaving the device | Plan |
| AI failure handling | Inline error banner, stay on page | Book detail stays interactive; matches Drive/import error patterns | Plan |
| Bulk semantics | Add-only (union) | Matches user intent with no destructive surprise; idempotent | Plan |
| AI output | 3–8 tags, structured JSON with `{name, isNew, provenance}` | Small enough to review at a glance; pattern reuse from enrichment schema | Plan |

## Scope

**In scope:**
- New AI tag-suggestion module mirroring `src/lib/enrichment/` (client, prompt, schema, types)
- `suggestTagsAction` server action returning proposals
- `SuggestionsPanel` inline UI on `/books/[id]` (toggleable chips + Apply)
- `QuickTagPopover` reusable component for per-card tagging from the library
- Tag-affordance overlay on `BookCard` (visible on hover for grid; hidden during selection mode)
- Selection-mode toggle + bulk action bar in `LibraryView`
- New `applyTagsToBooks(userId, bookIds, tagNames)` library function + `applyTagsToBooksAction` server action (transactional, add-only)

**Out of scope:**
- Bulk *remove* from library (single-book remove on detail page is sufficient)
- AI suggestions from the library (single or bulk)
- Tag delete (not added in previous change; still out)
- AI input beyond metadata (no front-matter, no body text — privacy NFR)
- Keyboard shortcuts for selection (no Cmd+A, no shift-click range select)
- Persistence of unaccepted AI proposals across navigation
- Schema changes or data migration

## Architecture / Approach

Phase 1 reuses the enrichment AI module structure 1:1 — same `OpenAI({ apiKey })` lazy singleton, same `client.responses.create({ tools: [{ type: "web_search" }], text: { format: { type: "json_schema", strict: true, schema } } })`, same `AbortSignal.timeout(28000)` and typed error class. Phase 2 lifts selection state into the existing `LibraryView` client component and threads it down to `BookCard`. The new `applyTagsToBooks` follows the same Kysely `transaction()` + `onConflict.doNothing()` pattern as the existing `addTagToBook`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. AI tag suggestions on book detail | Working "Suggest tags" button: web-search-grounded proposals → inline review → accept | OpenAI cost + 28s tail latency on slow networks; privacy regression risk if book body leaks into the prompt |
| 2. Library-side tagging (quick-tag + bulk) | Per-card tag popover + selection-mode bulk add with new transactional action | Selection-state UX edge case: tagging a card that was selected-then-filtered-out (intentional, but needs to be visible) |

**Prerequisites:** `OPENAI_API_KEY` env var already wired (used by enrichment). All tag data-layer functions already exist. Existing `TagPicker` + book detail page already shipped.
**Estimated effort:** ~2 sessions across 2 phases.

## Open Risks & Assumptions

- Radix Popover (`radix-ui/react-popover`) import path needs to be verified against the aggregated `radix-ui` package before Phase 2 step 2 (same path-verification note as the previous change brief).
- AI tag quality on obscure self-published books may be poor — the inline error path covers timeout but not "AI confidently returned bad tags." Users mitigate by rejecting all chips before Apply.
- The selection-mode + filter interaction (selected cards that filter out remain selected and still get tagged) is correct but surprising; verification step 9 calls this out.

## Success Criteria (Summary)

- A user can open a freshly imported book on `/books/[id]`, click "Suggest tags", review the proposals, accept the right ones, and have them appear on the book in under a minute — without typing any tag names.
- A user can select 10 books on the library, type one tag name, click Apply, and tag all 10 in one transaction — without opening any book detail page.
- Quick-tag popover works for one-at-a-time tagging without selection mode.
