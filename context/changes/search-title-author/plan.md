# Search Title/Author — Polish Implementation Plan

## Overview

The library already has a working search input (`q` URL param, substring match across `title` + `author`, client-side). This change upgrades it from "works on a single contiguous substring, ASCII only, with no visible feedback" to a polished polyglot search: multi-word AND matching, accent-folding, in-card match highlighting, a result count, a recoverable empty state, and a Cmd-K / Ctrl-K focus shortcut.

## Current State Analysis

- `src/app/components/library-view.tsx:27` reads `q` from `useSearchParams()`. Same component, `:39-50` holds the filter predicate — a single `String.includes` against `title` and `author?`, case-insensitive only.
- The search input is at `:135-146`, controlled by `searchQuery` and writing back via `updateParams` (`:32-37`) — the same shallow-URL mechanism that powers tag filtering.
- The list of books is fetched server-side in `src/app/(app)/page.tsx:21-24` via `listConfirmedBooks(userId)` (`src/lib/books.ts:19-60`) and the *full* list is passed into `LibraryView` for client-side filtering. Out of scope here; the current ~1000-book ceiling is fine for FR-012.
- `BookCard` (`src/app/components/book-card.tsx`) renders title and author across 4 layout branches (grid+selection, grid+default, list+selection, list+default). Every branch wraps `book.title` and `book.author` in `<p>` with truncation classes.
- Empty state copy currently lives at `library-view.tsx:254-257` — single generic line, no clear-action affordance.
- No existing focus-shortcut convention in the app to clash with; `useRouter`/`useSearchParams` are the only navigation primitives in play.

### Key Discoveries:

- The existing `q` URL param + shallow-routing mechanism is reused verbatim — no new state plumbing needed (`library-view.tsx:32-37`).
- `BookSummary.author` is `string | null` (`src/lib/books.ts:5-12`); every highlight + match code path must tolerate `null`.
- The "any filter active" predicate already exists implicitly (search OR tags OR untagged); making it explicit is a one-liner that the count and empty-state both need.
- `String.prototype.normalize('NFD').replace(/\p{Diacritic}/gu, '')` is the standard ES2018+ accent-folding idiom; works in all browsers we target.
- The match-position computation for highlighting must operate on the folded string but slice the original string — folded and original always have the same length when using NFD-then-strip-marks on Latin scripts, so index alignment holds. (Verified: NFD splits "Ś" → "S" + combining mark, removing the combining mark leaves "S" — same length 1 as the original character.)
- Wait: that's wrong. The *original* "Ś" is a single code unit (length 1). After NFD it becomes 2 code units ("S" + combining mark). After removing the mark it becomes 1 again. So lengths match in the *folded* result vs. the original *only by coincidence of which characters appear*. The safer invariant: fold both query and field with NFD-then-strip, but for highlighting walk the original string character-by-character and ask "does the folded prefix-from-here-of-length-k equal the folded token?" This is `O(field × token)` per match attempt; trivially cheap at our scale. See Phase 2 contract.

## Desired End State

A user typing in the library search input experiences:

- **Multi-word AND across fields**: `"heidegger being"` matches a book titled "Being and Time" by Heidegger — each token must appear in `title` OR `author`, accent-folded.
- **Accent-folding**: typing `"borges"` matches "Jorge Luis Borges"; typing `"bronte"` matches "Charlotte Brontë". Symmetric — typing the accented form still works.
- **Highlighted matches**: every matched token is wrapped in `<mark>` inside the book card's title and author lines, in both grid and list variants.
- **Always-on count**: a small "N of M books" label sits next to the search row whenever any filter is active; "M books" otherwise.
- **Empty-state with escape hatch**: when search-driven filters produce zero results, the empty state names the query and offers a "Clear search" button that empties only `q` (preserves tag/untagged filters).
- **Cmd-K / Ctrl-K focus**: pressing the chord from anywhere on the library page focuses the search input. Shortcut is suppressed when another input/textarea is focused.

Verifiable via manual testing (typing the queries above and observing the UI) and a sanity build (`npm run lint`, `npm run build`).

## What We're NOT Doing

- **Not** moving search to the server — client-side filtering stays; the ~1000-book ceiling holds.
- **Not** searching ISBN, notes, tag names, or any field outside `title` + `author`. Note search is FR-017 nice-to-have, a separate change.
- **Not** adding fuzzy matching, ranked scoring, or typo tolerance. AND-substring after accent-folding is the matching contract.
- **Not** adding `/` as a focus shortcut (chose Cmd-K per Round 2).
- **Not** highlighting matches inside tag chips, ISBN, or anywhere outside `BookCard`'s title/author lines.
- **Not** debouncing input — `replaceState` is cheap and the current keystroke-per-update behavior shipped fine in filter-by-tag.
- **Not** adding a Cmd-K command palette — just a focus shortcut on the existing input. If a palette is built later it can take Cmd-K over and this shortcut will move.
- **Not** persisting matching-mode preferences (everyone gets multi-word AND + accent-folding; no toggle).

## Implementation Approach

Single-file scope on the client. Extract the matching logic into a small pure helper (`searchUtils`) used by both the filter predicate in `LibraryView` and the highlight renderer in `BookCard`. Pass `searchQuery` as a new optional prop to `BookCard` so the card can compute its own highlight ranges; the alternative (pre-computing ReactNodes in `LibraryView` and passing them down) leaks rendering concerns up and inflates the prop surface. The count and empty-state are pure additions in `LibraryView`. The Cmd-K shortcut is a `useEffect` on `document` keydown with a single guard against focus already being inside an editable element.

## Critical Implementation Details

- **Accent-folding + highlight index alignment**: folding with `normalize('NFD').replace(/\p{Diacritic}/gu, '')` can change string length (composed → decomposed → stripped). For *matching* (predicate), fold both sides and use `includes`. For *highlighting*, you cannot reuse the folded index — you must walk the original string and fold prefixes-from-each-position to find match boundaries in the original. See Phase 2 contract for the precise helper signature.
- **Cmd-K guard**: the listener must check `document.activeElement` and skip if it's an `INPUT`, `TEXTAREA`, or `[contenteditable]`. Also skip if `e.metaKey === e.ctrlKey === false` (so plain `k` typed elsewhere doesn't focus). `e.preventDefault()` on match to avoid the browser's default Cmd-K (focus omnibox / Chrome's open-search-engine).

## Phase 1: Matching engine upgrade

### Overview

Replace the inline `String.includes` predicate with a small helper that tokenizes the query, folds diacritics, and AND-matches each token across `title + author`. No UI yet — pure logic change visible only by observing that more queries match.

### Changes Required:

#### 1. New helper module

**File**: `src/lib/search-utils.ts` (new)

**Intent**: Centralize the matching contract so the filter predicate in `LibraryView` and the highlight renderer in `BookCard` agree on what "matches". A pure module with no React dependencies.

**Contract**:
- `foldDiacritics(s: string): string` — `s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()`.
- `tokenize(query: string): string[]` — trim, split on `/\s+/`, drop empties, fold each token.
- `matchesQuery(book: { title: string; author: string | null }, query: string): boolean` — returns `true` if query is empty OR every token (from `tokenize(query)`) is a substring of `foldDiacritics(title)` OR `foldDiacritics(author ?? "")`. Each token may match either field independently — the "AND across fields combined" semantics from Round 1.

#### 2. Wire the helper into the filter predicate

**File**: `src/app/components/library-view.tsx`

**Intent**: Replace the `q`-based `.includes` block at `:39-44` with a single call to `matchesQuery`. Tag/Untagged logic at `:45-48` is unchanged.

**Contract**: Import `matchesQuery` from `@/lib/search-utils`. Filter predicate becomes `matchesQuery(b, searchQuery) && matchesTags`. The `searchQuery.toLowerCase()` line is removed (folding owns case-insensitivity now).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- No TypeScript errors in changed files

#### Manual Verification:

- Library loads, search bar empty → all confirmed books visible (no regression).
- Type `"heidegger being"` in search → a book titled "Being and Time" by Heidegger appears (previously hidden).
- Type `"borges"` → "Jorge Luis Borges" matches; type `"bronte"` → "Brontë" matches (assuming such a book exists; otherwise add one for the test then trash it).
- Type `"   "` (whitespace only) → all books shown (whitespace-only query treated as empty).
- Search composes with tag chips and Untagged: e.g., search + a tag chip filters by both.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Match highlighting in BookCard

### Overview

Render `<mark>` spans around matched tokens inside the title and author lines of every `BookCard` variant. Reuses the same fold/tokenize primitives from Phase 1.

### Changes Required:

#### 1. Highlight helper

**File**: `src/lib/search-utils.ts`

**Intent**: Add a function that returns the segments to render — a list of `{ text: string; mark: boolean }` chunks — for a given field value and query. The caller (`BookCard`) maps chunks to JSX. Keeping JSX out of `src/lib/` keeps the module reusable and dep-free.

**Contract**: 
- `highlightMatches(text: string, query: string): Array<{ text: string; mark: boolean }>` — returns a single non-mark chunk equal to `text` when query is empty. Otherwise, for each token in `tokenize(query)`, find every occurrence in `foldDiacritics(text)`-position-aligned-to-original, and emit alternating non-mark/mark segments.

**Snippet** (the index-alignment trick is the non-obvious bit — included because Phase 2 depends on this contract being correct):

```ts
export function highlightMatches(text: string, query: string): Array<{ text: string; mark: boolean }> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [{ text, mark: false }];

  // Build a folded-string that mirrors original index positions:
  // walk char-by-char, fold each char individually so positions stay in sync.
  const folded = Array.from(text).map((ch) => foldDiacritics(ch)).join("");
  // Note: this only stays index-aligned because Array.from(text) iterates by code point,
  // and foldDiacritics on a single composed char like "ś" returns "s" — same length 1.
  // For multi-codepoint graphemes it can drift; acceptable for Latin-script titles/authors.

  const ranges: Array<[number, number]> = [];
  for (const tok of tokens) {
    let from = 0;
    while (from <= folded.length - tok.length) {
      const idx = folded.indexOf(tok, from);
      if (idx === -1) break;
      ranges.push([idx, idx + tok.length]);
      from = idx + tok.length;
    }
  }
  if (ranges.length === 0) return [{ text, mark: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const out: Array<{ text: string; mark: boolean }> = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) out.push({ text: text.slice(cursor, s), mark: false });
    out.push({ text: text.slice(s, e), mark: true });
    cursor = e;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), mark: false });
  return out;
}
```

#### 2. New `<Highlighted>` component

**File**: `src/app/components/highlighted.tsx` (new)

**Intent**: Tiny client component that takes `text` and `query`, calls `highlightMatches`, and renders the result with `<mark>` for marked chunks. Used inside `BookCard` to keep the four render branches readable.

**Contract**: `function Highlighted({ text, query }: { text: string; query: string }): React.JSX.Element` — emits a `<>` fragment of string chunks and `<mark>` elements. No styling props; uses default `<mark>` styling. If `text` is empty, renders nothing. Forms a stable key-free child list (segments index suffices).

#### 3. Thread `searchQuery` into `BookCard`

**File**: `src/app/components/book-card.tsx`

**Intent**: Add `searchQuery: string` to `BookCardProps`, replace every `{book.title}` and `{book.author}` in the four render branches with `<Highlighted text={book.title} query={searchQuery} />` and the equivalent for author (guarded by the existing `book.author && …`).

**Contract**: New required prop `searchQuery: string` on `BookCardProps`. All four return branches updated. No styling changes; the `<mark>` element picks up browser-default yellow background within the existing `<p className="… text-zinc-900">` and `<p className="… text-zinc-500">` containers.

#### 4. Pass `searchQuery` from `LibraryView`

**File**: `src/app/components/library-view.tsx`

**Intent**: At the two `BookCard` callsites (`:261-268` and `:275-283`), add `searchQuery={searchQuery}`.

**Contract**: One new prop on each `<BookCard>` JSX use site. Nothing else changes.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- No TypeScript errors

#### Manual Verification:

- Type `"borges"` → in matching cards, the substring "Borges" (or "Borgès" / "Borgés" variants) appears highlighted with the browser-default `<mark>` style.
- Type `"heidegger being"` → "Being" highlighted in title, "Heidegger" highlighted in author.
- Switch to list view → highlights persist on title and author in list rows.
- Toggle selection mode → highlights still appear inside selection-mode card variants.
- Empty query → no `<mark>` elements; title/author render as plain `<p>` contents.
- Highlight survives `line-clamp` truncation (text after the clamp boundary doesn't show, but visible highlighted portion looks correct).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Result count and empty state

### Overview

Always-on "N of M books" count next to the search row, and an empty-state that names the query with a Clear search button.

### Changes Required:

#### 1. "Any filter active" derived flag and count

**File**: `src/app/components/library-view.tsx`

**Intent**: Compute `hasActiveFilter = !!searchQuery || activeTagNames.size > 0 || showUntagged` once per render. Use it to switch the count copy: `hasActiveFilter ? "N of M books" : "M books"`. Place the count as a small text label inside the search row, after the View/Select buttons.

**Contract**: 
- New `const hasActiveFilter = …` placed after `showUntagged` derivation (~`:30`).
- New JSX inside the `.flex.flex-wrap.items-center.gap-3` row at `:134` after the Select button: `<span className="text-sm text-zinc-500">{filtered.length} of {books.length} books</span>` (conditional on `hasActiveFilter`; otherwise show `{books.length} books`).

#### 2. Empty state with named query + Clear search button

**File**: `src/app/components/library-view.tsx`

**Intent**: Replace the generic empty-state `<p>` at `:254-257` with a small block that, when `searchQuery` is non-empty, says `No books match "<query>"` and offers a button. Other zero-result cases (e.g., tag filter alone) keep the generic copy.

**Contract**: 
- The `filtered.length === 0` branch becomes a small conditional: if `searchQuery` is non-empty, render the named-query message + `<button onClick={() => updateParams(p => p.delete("q"))} className="…">Clear search</button>`; else if `books.length === 0` render "No books yet."; else render "No books match your filters."
- Button styling matches the existing chip-button class palette (`rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200`).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Default load: count reads "M books" (no "of"), where M = total confirmed books.
- Type a search query: count switches to "N of M books" and N updates per keystroke.
- Clear search via the input: count returns to "M books".
- Search to zero results: empty state shows `No books match "<query>"` and the Clear search button.
- Click Clear search: `q` is removed from URL; any active tag chips remain selected; library returns to the tag-filtered view.
- Tag filter alone produces zero results: empty state shows the generic "No books match your filters." copy (not the named-query variant).
- Library with zero books overall: empty state shows "No books yet." (unchanged from current behavior).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: Cmd-K / Ctrl-K focus shortcut

### Overview

Wire a keyboard shortcut that focuses the search input from anywhere on the library page, with the right guards.

### Changes Required:

#### 1. Search-input ref + global keydown listener

**File**: `src/app/components/library-view.tsx`

**Intent**: Attach a `ref` to the search `<input>`. On mount, attach a `keydown` listener to `document` that focuses the input when the user presses Cmd-K (Mac) or Ctrl-K (other), unless focus is already inside an editable element.

**Contract**:
- New `const searchInputRef = useRef<HTMLInputElement>(null)`.
- Add `ref={searchInputRef}` to the existing search input at `:135-146`.
- New `useEffect` that registers a `document.addEventListener("keydown", handler)` and removes it on cleanup. Handler:
  - Skip unless `e.key === "k"` AND (`e.metaKey || e.ctrlKey`) AND NOT `e.altKey` AND NOT `e.shiftKey`.
  - Skip if `document.activeElement` matches `INPUT`, `TEXTAREA`, or has `[contenteditable]` set, UNLESS the active element is the search input itself (allow re-focus / select-all).
  - On match: `e.preventDefault()`, `searchInputRef.current?.focus()`, `searchInputRef.current?.select()`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- On library page, with focus elsewhere (e.g., a tag chip or the page body): press Cmd-K (or Ctrl-K on non-Mac) → search input gains focus and its current value is selected.
- With focus inside the search input already: press Cmd-K → text gets re-selected, no jump.
- With focus inside the bulk-tag input: press Cmd-K → no effect (input keeps focus; user typing isn't hijacked).
- With focus inside a TipTap notes editor on a book detail page: shortcut is bound only on the library page, so it doesn't fire. (Sanity: navigate to `/books/<id>`, press Cmd-K → browser's default Cmd-K behavior should still happen, e.g., focus omnibox in Chrome.)
- Plain `k` typed elsewhere on the page → no focus shift.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Testing Strategy

### Unit Tests:

No test framework is configured in this repo (per `CLAUDE.md`); skip unit-test addition. The matching helpers in `src/lib/search-utils.ts` are pure functions and can be added to a test suite trivially if/when one lands.

### Integration Tests:

N/A — manual verification per phase.

### Manual Testing Steps:

1. Run `npm run dev`, navigate to `/`.
2. Walk through each phase's manual checklist above.
3. Verify no regressions in tag filtering, Untagged chip, view toggle, bulk-tag selection, or book-detail navigation.

## Performance Considerations

- Filter predicate is now `O(books × tokens × max(title.length, author.length))` per render. With <1000 books, <5 tokens, <200-char field lengths, this is sub-millisecond. No memoization needed.
- Highlight helper runs per visible card per render. Same upper bound; trivially cheap.
- Cmd-K listener registers/unregisters once per mount; no per-render cost.

## Migration Notes

None — no schema, no API, no breaking client behavior. Existing `q` URL params keep working; users with bookmarked filter URLs see strictly more results (multi-word + accent-folding only ever broadens matches, never narrows them — except in the theoretical case of a query with leading/trailing whitespace that previously failed to substring-match, which is still a behavior change but only ever toward "more permissive").

## References

- Current search input: `src/app/components/library-view.tsx:135-146`
- Current filter predicate: `src/app/components/library-view.tsx:39-50`
- Books data shape: `src/lib/books.ts:5-12`
- Filter-by-tag plan (where `q` URL persistence was added): `context/changes/filter-by-tag/plan.md`
- PRD line item: `context/foundation/prd.md` FR-012

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Matching engine upgrade

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 38102f0
- [x] 1.2 Build passes: `npm run build` — 38102f0
- [x] 1.3 No TypeScript errors in changed files — 38102f0

#### Manual

- [ ] 1.4 Library loads, search bar empty → all confirmed books visible
- [ ] 1.5 `"heidegger being"` matches "Being and Time" by Heidegger
- [ ] 1.6 `"borges"` / `"bronte"` match accented author names
- [ ] 1.7 Whitespace-only query shows all books
- [ ] 1.8 Search composes with tag chips and Untagged

### Phase 2: Match highlighting in BookCard

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 334dea7
- [x] 2.2 Build passes: `npm run build` — 334dea7
- [x] 2.3 No TypeScript errors — 334dea7

#### Manual

- [ ] 2.4 `"borges"` highlights "Borges" variants in matching cards
- [ ] 2.5 `"heidegger being"` highlights title and author tokens independently
- [ ] 2.6 Highlights persist in list view
- [ ] 2.7 Highlights appear in selection-mode card variants
- [ ] 2.8 Empty query renders no `<mark>` elements
- [ ] 2.9 Highlight survives `line-clamp` truncation

### Phase 3: Result count and empty state

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 282b08e
- [x] 3.2 Build passes: `npm run build` — 282b08e

#### Manual

- [ ] 3.3 Default load shows "M books"
- [ ] 3.4 Typing switches count to "N of M books" and N updates per keystroke
- [ ] 3.5 Clearing search returns count to "M books"
- [ ] 3.6 Zero search results show named-query empty state + Clear search button
- [ ] 3.7 Click Clear search empties only `q`, preserves tag filters
- [ ] 3.8 Tag-only zero results show generic empty-state copy
- [ ] 3.9 Zero-books library shows "No books yet."

### Phase 4: Cmd-K / Ctrl-K focus shortcut

#### Automated

- [x] 4.1 Lint passes: `npm run lint` — 942c184
- [x] 4.2 Build passes: `npm run build` — 942c184

#### Manual

- [ ] 4.3 Cmd-K / Ctrl-K from non-input focus → search input focused and content selected
- [ ] 4.4 Cmd-K while search input already focused → re-selects, no jump
- [ ] 4.5 Cmd-K while bulk-tag input focused → no effect
- [ ] 4.6 Shortcut does not fire on book-detail pages
- [ ] 4.7 Plain `k` keypress does not focus search
