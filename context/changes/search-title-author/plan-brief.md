# Search Title/Author — Plan Brief

> Full plan: `context/changes/search-title-author/plan.md`

## What & Why

Library search by title/author already works (`q` URL param, substring match, client-side filter — shipped under `filter-by-tag`). It's also a usability papercut: ASCII-only matching ignores accented author names, multi-word queries fail unless they're contiguous substrings, matches are invisible inside cards, and there's no count or recoverable empty state. This change polishes the existing search into a polyglot multi-word search with visible feedback and a focus shortcut.

## Starting Point

`LibraryView` (`src/app/components/library-view.tsx`) holds a working `<input type="search">` bound to a `q` URL param; the filter predicate at `:39-50` does case-insensitive substring matching against `title` and nullable `author`. `BookCard` renders title and author plainly across four layout branches. The library page (`src/app/(app)/page.tsx`) loads all confirmed books server-side and hands the full list to `LibraryView` for client-side filtering.

## Desired End State

Typing `"heidegger being"` returns "Being and Time" by Heidegger with both tokens highlighted across title and author. Typing `"bronte"` matches "Brontë". A count of "N of M books" sits next to the search row whenever any filter is active. Zero search results show `No books match "<query>"` with a Clear search button that empties only the search term. Cmd-K / Ctrl-K focuses the search input from anywhere on the library page.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Goal of the change | Polish existing search, not rebuild it | Search ships and works; the value left is in matching semantics and feedback | Plan |
| Polish set | Result count + match highlighting + Cmd-K + empty-state polish (all four) | Each item is independently small; combined they shift the feature from "functional" to "delightful" | Plan |
| Multi-word semantics | AND across title+author combined (each token may match either field) | Matches how readers think — "author + topic" is the natural multi-word query | Plan |
| Accent-folding | Yes — `normalize('NFD').replace(/\p{Diacritic}/gu, '')` on both query and field | Polyglot library means Bronte/Borges/Sartre all "just work" without thinking | Plan |
| Highlight rendering | `<mark>` element with browser-default style | Semantic, accessible, themeable, single helper reused across `BookCard` variants | Plan |
| Focus shortcut | Cmd-K / Ctrl-K (palette style) | Modifier-key shortcut avoids conflicting with typing anywhere on the page | Plan |
| Count copy + placement | Always-on "N of M books" / "M books" inline with search row | Persistent library-size cue plus progress feedback while typing | Plan |
| Empty-state action | "Clear search" only (not "Clear all filters") | Surgical action lets users keep refining within an active tag filter | Plan |
| Backend changes | None — keep client-side filter | The ~1000-book ceiling holds; server-side search is a separate change | Plan |

## Scope

**In scope:**
- New pure helper at `src/lib/search-utils.ts` (`foldDiacritics`, `tokenize`, `matchesQuery`, `highlightMatches`)
- New `<Highlighted>` client component used by `BookCard`
- `BookCard` gains a `searchQuery` prop and wraps title/author through `<Highlighted>`
- `LibraryView` filter predicate calls `matchesQuery`; result count and polished empty-state added
- Cmd-K / Ctrl-K focus shortcut on the search input

**Out of scope:**
- Moving search server-side; ISBN, tag, or note search; fuzzy/ranked matching
- `/` as alternate focus shortcut; Cmd-K command palette
- Schema, server actions, API, or `listConfirmedBooks` changes
- Debouncing the search input
- Persisting matching-mode preferences

## Architecture / Approach

A single new pure helper module owns the matching contract. `LibraryView` consumes it for the filter predicate and renders the count + empty-state. `BookCard` accepts the current query as a prop and delegates per-line highlighting to a tiny `<Highlighted>` component. The Cmd-K shortcut is a `useEffect` on `document.keydown` inside `LibraryView`, with a guard against firing while another input is focused. No URL contract changes — the existing `q` param still drives everything.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Matching engine upgrade | Multi-word AND + accent-folding via `matchesQuery`; replaces inline `.includes` | Behavior change for users with bookmarked `?q=` URLs (strictly broader matches) |
| 2. Match highlighting in BookCard | `<mark>` spans around matched tokens in title and author, across all 4 card variants | Index-alignment between folded and original strings; helper must walk original char-by-char |
| 3. Result count + empty state | Always-on count and named-query empty-state with Clear search | Empty-state branching must distinguish search-zero from tag-zero from library-zero |
| 4. Cmd-K / Ctrl-K focus shortcut | Global keydown listener focuses search input with proper guards | Must not hijack typing in other inputs or override the shortcut in nested TipTap editors |

**Prerequisites:** `filter-by-tag` shipped (commit `b13f73b`) — the `q` URL param contract is the foundation this builds on. No new packages, env vars, or DB changes.
**Estimated effort:** One session across four small phases; each phase is single-component scope.

## Open Risks & Assumptions

- Accent-folding via per-character `Array.from(text).map(foldDiacritics).join("")` keeps original/folded indices aligned for Latin script titles/authors; multi-codepoint graphemes (rare in book metadata) may drift the highlight by a few characters. Acceptable.
- Cmd-K is a common shortcut; if a command palette is added later it will steal this binding. Acceptable; the focus shortcut moves to wherever the palette parks search.
- `<mark>` browser-default yellow may visually clash with the existing zinc/blue palette. Mitigation deferred — restyle with a Tailwind class if a quick eyeball test calls for it.

## Success Criteria (Summary)

- A user types a multi-word query and the matching book appears with both tokens highlighted in title and/or author.
- Typing an unaccented version of an accented name returns the matching book.
- The library page shows a count of matches while filtering, and gives a one-click escape when search produces zero results.
- Cmd-K / Ctrl-K focuses the search input without disrupting any other typing affordance on the page.
