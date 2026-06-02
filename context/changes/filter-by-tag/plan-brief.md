# Filter by Tag — Plan Brief

> Full plan: `context/changes/filter-by-tag/plan.md`

## What & Why

The library page already has a working tag filter, but state lives entirely in client React — refreshing, hitting back from a book detail page, or sharing a URL all reset the filter to default. This change moves the filter (plus search query and view mode) into the URL so those flows preserve state, and adds a dedicated "Untagged" chip so users can surface books that need tagging after import.

## Starting Point

`src/app/components/library-view.tsx` is a client component holding `searchQuery`, `activeTags` (Set of tag IDs), and `view` in `useState`. Filtering is client-side with AND semantics across selected tags. The parent `src/app/(app)/page.tsx` is a server component that loads all confirmed books + all user tags and passes both down. The chip strip renders every user tag as a clickable button (`library-view.tsx:185-202`) and only when at least one tag exists.

## Desired End State

A URL like `/?tags=fiction&tags=philosophy&q=heidegger&view=list&untagged=1` (in any combination) renders the corresponding filtered library on first load. Toggling a chip, typing in search, or flipping the view immediately updates the URL via `window.history.replaceState` — no page reload, no server roundtrip. A new outlined "Untagged" chip sits at the end of the chip strip; it shows only books with zero tags and visually deselects regular chips when activated (and vice versa). AND semantics on regular tags stay the default and only behavior.

## Key Decisions Made

| Decision                       | Choice                                             | Why (1 sentence)                                                                                              | Source |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| Filter improvements in scope   | URL persistence + Untagged chip                    | The only user-reported pain; OR mode and chip polish stay deferred                                            | Plan   |
| Tag semantics                  | AND only (status quo)                              | Matches FR-011, simpler UX, no new mode toggle                                                                | Plan   |
| State location                 | URL search params, tag *names* (repeated `?tags=`) | Refresh / back / share-link work; URLs human-readable; rename-bookmark fragility acceptable                   | Plan   |
| Untagged behavior              | Dedicated chip, mutually exclusive with tag chips  | Closes the post-import "what still needs tagging?" loop without weird combined semantics                      | Plan   |
| URL scope                      | `tags`, `q`, `view` all persisted; selection state not | Same regression class for q and view; selection is transient and would bloat URLs                          | Plan   |
| URL update mechanism           | `window.history.replaceState` (shallow routing)    | Next.js 16 docs confirm it integrates with `useSearchParams`; avoids server re-render per keystroke           | Plan   |
| Mutual exclusion enforcement   | At write time, not read time                       | URL stays canonical (never `tags=X&untagged=1` at once); filter predicate stays simple                        | Plan   |

## Scope

**In scope:**
- Migrate `searchQuery`, `activeTags`, `view` in `LibraryView` from `useState` to `useSearchParams`-derived values
- Add `updateParams(mutator)` helper that writes via `window.history.replaceState`
- Switch tag matching from ID-based to name-based (since URL carries names)
- Add "Untagged" chip with mutual-exclusion writes and a `b.tags.length === 0` filter branch
- Widen the parent page's `searchParams` prop type to include the new keys

**Out of scope:**
- OR semantics or AND/OR mode toggle
- Chip polish: count badges, clear-all button, overflow handling
- URL persistence of selection mode / selected book IDs
- Schema changes, new server queries, API changes
- Debouncing (`replaceState` is cheap and doesn't roundtrip)

## Architecture / Approach

Single-component change. `LibraryView` reads `useSearchParams()` and derives `searchQuery`, `activeTagNames`, `view`, `showUntagged` directly — no mirroring useState. Every user interaction (search input, chip click, view toggle, Untagged toggle) calls helpers built on top of a single `updateParams` function that clones the current params, mutates them, and pushes via `window.history.replaceState`. Next.js's router observes the change, `useSearchParams` re-emits, and React re-renders with new derived values. The server component (`page.tsx`) is unchanged except for one type widening — it continues to load the full library for client-side filtering.

## Phases at a Glance

| Phase                                              | What it delivers                                                                                                | Key risk                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1. URL-driven filter, search, and view state       | `tags`, `q`, `view` round-trip through the URL; refresh / back / share-link all preserve filter; AND semantics unchanged | Controlled `value={searchQuery}` from `useSearchParams` may stutter under fast typing; fallback is local input state synced on commit |
| 2. "Untagged" chip                                 | Distinct chip at end of strip; `?untagged=1`; mutually exclusive with regular tag chips at the URL write layer  | UX must read mutual exclusion as intentional, not as a bug; chip-strip render condition needs to allow it for users with zero tags     |

**Prerequisites:** The library page + tag filter must already exist (shipped in `library-and-book-view`, commit `a3b076c`). No new packages, no env vars, no DB changes.
**Estimated effort:** One session across two phases.

## Open Risks & Assumptions

- **Input stutter** under `value={searchParams.get('q') ?? ''}` is theoretical — `replaceState` + Next router sync + React re-render is typically fast enough. Manual verification step 1.10 specifically watches for it; fallback is a local `useState` for the input value.
- **Tag-rename bookmark fragility**: a URL referencing a renamed tag silently matches zero books. Acceptable since rename is rare and there's no good UX for "URL stale" detection here.
- **Bulk-tag UI coexistence**: the existing selection-mode / bulk-tag bar in `LibraryView` stays in `useState`. The same component now mixes URL-driven and local state; reviewers should confirm this doesn't make the file unreadable.

## Success Criteria (Summary)

- A user can apply filters, refresh the page or hit back from a book detail page, and see the same filtered library — no manual re-application.
- A user can click "Untagged" right after importing a batch and see only the books that still need tagging, with one click.
- Search, view-toggle, and chip clicks all update the URL bar without a page reload.
