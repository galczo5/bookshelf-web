# Filter by Tag Implementation Plan

## Overview

URL-persist the library's tag filter, search query, and view mode so refresh, back-button, and shared links all preserve filter state. Add a dedicated "Untagged" chip — mutually exclusive with regular tag chips — to surface books that need tagging. Client-side filtering (AND semantics) stays as-is; no schema, server-query, or auth changes.

## Current State Analysis

The library page (`src/app/(app)/page.tsx`) is a server component that loads all confirmed books and all user tags, then hands off to `LibraryView` (`src/app/components/library-view.tsx`), a client component holding all interactive state in `useState`:

- `searchQuery: string`, `activeTags: Set<string>` (tag IDs), `view: "grid" | "list"`, `selectionMode`, `selected`, and the bulk-tag inputs.
- Filtering happens client-side in one pass (`library-view.tsx:29-38`): AND semantics on tags (`every` selected tag must be on the book), substring match on title/author for search.
- Tag chips render in a flat row (`library-view.tsx:185-202`) with toggle-on-click; no clear-all, no chip counts, no overflow handling.

Refreshing the page, navigating back from `/books/[id]`, or sharing a URL all reset every filter to default because none of the state is in the URL.

`useSearchParams` from `next/navigation` is already imported in other client components in the codebase (no need to install). Next.js 16 supports `window.history.replaceState` / `pushState` as shallow URL updates that sync with `useSearchParams` (verified in `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` lines 341-445) — this avoids server re-renders on every chip click.

## Desired End State

A signed-in user sees their library at `/?tags=fiction&tags=philosophy&q=heidegger&view=list` (or any combination thereof). Reloading the page renders the same filtered view immediately. Clicking the back button from a book detail page returns to the filtered library, not the empty default. Sharing the URL with themselves on another device opens the same view.

The chip strip includes one new chip — "Untagged" — visually distinct (outlined / faded) and positioned at the end of the row. Activating it shows only books with zero tags and visibly deselects any regular tag chips; activating any regular tag chip while Untagged is active visibly deselects Untagged. The mutual exclusion never produces an empty `tags=...&untagged=1` URL.

### Key Discoveries:

- Next.js 16 `window.history.replaceState` integrates with `useSearchParams` (`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md:341-345`) — shallow updates that don't re-execute the server component.
- Tag-name URL encoding is the chosen format (decided in questioning). Tag names can contain spaces and unicode; `URLSearchParams` handles encoding via `append`/`set`.
- Filter currently uses tag IDs (`Set<string>` of UUIDs from `book.tags[].id`); migrating to names requires matching `book.tags[].name` instead. Names are unique per user (DB unique constraint on `(user_id, name)` per `library-and-book-view` plan).
- `BookSummary.tags` is `Array<{ id, name }>` — both fields available, so the matching change is one-line.
- `selectionMode`, `selected`, `bulkInput`, `bulkSuggestions`, `bulkError` stay in `useState` — not in URL (per questioning scope).

## What We're NOT Doing

- **No OR semantics or AND/OR toggle.** AND-only stays (status quo, matches FR-011).
- **No chip polish.** No count badges, no clear-all button, no scroll/collapse for many tags — explicitly out of scope per questioning.
- **No URL persistence of selection state.** Selection mode and selected book IDs stay in `useState`.
- **No schema changes, no new server queries, no API changes.** Filtering remains client-side.
- **No debounce on URL updates.** `window.history.replaceState` is cheap; the input stays controlled and responsive without server roundtrips.
- **No global tag-rename URL invalidation.** If a user renames a tag while a URL filter references the old name, the filter silently matches zero books — acceptable since rename is rare.
- **No migration of the `error` searchParam** that the page already reads. It's orthogonal.

## Implementation Approach

`LibraryView` becomes URL-driven: it reads `tags`, `q`, `view`, `untagged` from `useSearchParams()` at render time and derives `activeTags`, `searchQuery`, `view`, `showUntagged` directly from those values (no mirroring `useState`). User actions call a single helper that mutates a `URLSearchParams` copy and pushes it via `window.history.replaceState`. The Next.js router observes the change and re-invokes `useSearchParams`, causing React to re-render with the new derived values.

The filter predicate gets one new branch: when `showUntagged` is true, match only books with `b.tags.length === 0` (and ignore `activeTags`).

`page.tsx` (server component) gets no logic changes for the filter — it continues to load all books and tags. We only widen its `searchParams` prop type so TypeScript doesn't complain about the additional keys (which the page itself doesn't read).

## Critical Implementation Details

- **Shallow URL updates must use `window.history.replaceState`, not `router.replace()`.** `router.replace()` re-executes the server component (re-runs the books + tags DB query on every keystroke); `window.history.replaceState` does not but still syncs `useSearchParams`. This is the documented Next.js 16 pattern.
- **Controlled-input responsiveness**: the search input's `value` is read from `useSearchParams`. After `replaceState`, the router emits an update that `useSearchParams` picks up synchronously enough for the input to feel native. If observed lag appears during manual testing, the fallback is a local `useState` for the input value with the URL synced via `useEffect` — but try the simple path first.
- **Mutual exclusion is enforced at write time**, not read time. The helper that activates Untagged also `params.delete('tags')`; the helper that toggles a tag also `params.delete('untagged')`. This keeps the URL canonical (never both at once) so the filter predicate stays simple.

## Phase 1: URL-driven filter, search, and view state

### Overview

Migrate `LibraryView` from `useState`-held `searchQuery`, `activeTags`, `view` to URL-derived values. Use `window.history.replaceState` for all updates. Initial server render produces the correctly filtered list because `useSearchParams` reflects the URL during SSR.

### Changes Required:

#### 1. `LibraryView` filter/search/view state

**File**: `src/app/components/library-view.tsx`

**Intent**: Replace the three `useState` hooks for `searchQuery`, `activeTags`, `view` with values derived from `useSearchParams()`. Add a single `updateParams(mutator)` helper that clones the current params, applies the mutation, and calls `window.history.replaceState(null, '', '?' + params.toString() || window.location.pathname)`. Wire the search input, view-toggle button, and tag chips to call helpers built on top of it.

**Contract**:
- Imports: `import { useSearchParams } from "next/navigation"` (replacing one `useState` import line, keep `useState` for `selectionMode`/`selected`/`bulkInput`/`bulkSuggestions`/`bulkError`).
- Derived values:
  - `searchQuery = searchParams.get('q') ?? ''`
  - `activeTagNames = new Set(searchParams.getAll('tags'))` — Set of tag *names*, not IDs.
  - `view = searchParams.get('view') === 'list' ? 'list' : 'grid'`
- Filter predicate at line 36 changes from `b.tags.some((t) => t.id === tagId)` to `b.tags.some((t) => t.name === tagName)`.
- Tag chip click handler replaces the existing `toggleTag(id)` with `toggleTag(name: string)` — appends or removes the name from the `tags` repeated param.
- Removing all chips emits a URL with no `tags` key (rather than `tags=`).
- When the resulting URL has no params, push `window.location.pathname` alone so the URL stays clean.

**Snippet** (the `updateParams` helper — non-obvious because `replaceState` requires hand-built URL and an empty-params guard):

```tsx
const searchParams = useSearchParams();

function updateParams(mutator: (params: URLSearchParams) => void) {
  const next = new URLSearchParams(searchParams.toString());
  mutator(next);
  const qs = next.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}
```

#### 2. `page.tsx` searchParams type widening

**File**: `src/app/(app)/page.tsx`

**Intent**: Expand the `searchParams` prop type so the additional URL keys don't trip TypeScript. The page itself reads only `error`; the new keys are consumed by the client component.

**Contract**: Change `searchParams: Promise<{ error?: string }>` to `searchParams: Promise<{ error?: string; tags?: string | string[]; q?: string; view?: string; untagged?: string }>`. No other logic changes — the server still calls `listConfirmedBooks(userId)` for the full list.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Loading `/?tags=<a-real-tag-name>` shows only books carrying that tag; the tag chip renders as active.
- Toggling a tag chip immediately updates the URL bar (visible in DevTools address bar) without a full page reload (no flash).
- Loading `/?q=heidegger` pre-fills the search box and filters to matching books.
- Loading `/?view=list` renders the list layout; clicking the view-toggle flips between `grid` (no key in URL) and `list` (`view=list` in URL).
- After applying filters, refreshing the page preserves the filter state exactly.
- Clicking a book to navigate to `/books/[id]`, then hitting browser back returns to the filtered library, not the empty default.
- Typing in the search box does not stutter; characters appear in the input as typed.
- Removing the last selected tag chip leaves the URL clean (no trailing `?` or `?tags=`).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: "Untagged" chip

### Overview

Add a single chip — visually distinct from regular tag chips — that filters the library to books with zero tags. Mutually exclusive with regular tag chips at the URL write layer.

### Changes Required:

#### 1. Untagged chip + mutual-exclusion logic in `LibraryView`

**File**: `src/app/components/library-view.tsx`

**Intent**: Add a derived `showUntagged = searchParams.get('untagged') === '1'`. In the filter predicate, when `showUntagged` is true, match books whose `tags.length === 0` (and skip the regular tag match). Render an additional chip at the end of the chip strip (only when `tags.length > 0`, alongside the existing rendering condition) — styled to look distinct (outlined / dashed border + zinc text, vs. solid background for regular chips). Active state mirrors the regular-chip active style (`bg-blue-600 text-white`) so the user reads it as the same affordance.

In the tag-chip toggle handler, also `params.delete('untagged')`. In the Untagged toggle handler, also `params.delete('tags')`. This keeps the URL canonical (never both at once).

**Contract**:
- New constant: `showUntagged = searchParams.get('untagged') === '1'`.
- Filter predicate (current line 34-37) gets one new branch:
  - If `showUntagged`, the tag side of the predicate is `b.tags.length === 0` (replaces the activeTags-based check).
  - Otherwise unchanged — `activeTagNames.size === 0 || [...activeTagNames].every(...)`.
- New helper `toggleUntagged()`: flips the `untagged` param between absent and `1`; when setting, also `delete('tags')`.
- Tag chip `toggleTag(name)` helper additionally `delete('untagged')` when adding (not strictly when removing, but safe to always delete).
- New chip element rendered after the `.map((t) => …)` chip list — same `<button>` shape, distinct className. `aria-pressed={showUntagged}`.

#### 2. Chip strip render guard

**File**: `src/app/components/library-view.tsx`

**Intent**: The chip strip currently only renders when `tags.length > 0`. The Untagged chip should be available even when the user has no tags (a brand-new user with imported books has zero tags — Untagged is meaningful). Change the guard so the strip renders when `tags.length > 0 OR books.length > 0`, and render the Untagged chip unconditionally inside the strip.

**Contract**: Render condition becomes `{(tags.length > 0 || books.length > 0) && (…)`. Inside, regular tag chips still gated on `tags.length > 0`; Untagged chip always present.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A library with at least one tagged and one untagged book shows the Untagged chip in the strip.
- Clicking Untagged hides every tagged book and shows only untagged ones; URL updates to include `untagged=1`.
- Clicking Untagged while regular tag chips are active deselects every regular chip (visibly and in URL); URL has `untagged=1` and no `tags=` entries.
- Clicking any regular tag chip while Untagged is active deselects the Untagged chip; URL has `tags=...` and no `untagged=`.
- A user with no tags but at least one imported book still sees the Untagged chip (filter the all-untagged library to itself — useful for confirming the filter works at all).
- A user with zero books sees no chip strip (existing empty-state hero is reached via the parent page when `books.length === 0`, so this case is unreachable here).
- Loading `/?untagged=1` directly renders the untagged-only view with the Untagged chip pre-active.
- Refresh preserves Untagged state.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human before considering the change complete.

---

## Testing Strategy

### Unit Tests:

No unit test framework is configured in this project (`package.json` has no test script). Changes are exercised via manual verification and TypeScript + lint + build.

### Manual Testing Steps:

1. Load `/` with mixed tagged/untagged books; verify all books visible.
2. Click two tag chips in turn; verify URL acquires `tags=X&tags=Y` and the filter narrows.
3. Type "heid" in search; verify URL acquires `q=heid` per-keystroke without input stutter.
4. Click view-toggle; verify URL toggles `view=list` and back (no key when grid).
5. Reload the page on a fully filtered URL; verify the page renders the same filtered view immediately (no flash of unfiltered list).
6. Navigate to a book, then back; verify filter state restored.
7. Activate Untagged with tags already selected; verify tag chips deselect and only untagged books show.
8. Activate a tag chip with Untagged active; verify Untagged deselects.
9. Remove every tag chip one by one; verify URL trims down to clean root (`/`).
10. Open a filtered URL in a fresh tab (simulating a shared link); verify the filter applies.

## Performance Considerations

Filter operations remain O(books) per render — already fast for the 1000-book NFR ceiling per `context/foundation/prd.md`. `window.history.replaceState` is cheap and does not trigger a server re-render of `page.tsx`, so the books + tags DB query runs only on initial page load (or `router.refresh()`), not on every keystroke.

If a user types fast in the search box, each keystroke triggers `replaceState` + a `useSearchParams` re-render + a client-side re-filter. For 1000 books this is sub-millisecond and well below the 200ms NFR.

## Migration Notes

No data migration. Existing URLs that don't include the new params continue to render the full library (default state).

URLs from before this change (no params) continue to work exactly as before. URLs minted after this change with `tags=...&q=...&view=list&untagged=1` only make sense post-deploy; this is acceptable for a single-user app.

## References

- Current `LibraryView`: `src/app/components/library-view.tsx`
- Library server component: `src/app/(app)/page.tsx`
- `BookSummary` type with tags: `src/lib/books.ts:5-12`
- Next.js 16 shallow-routing docs: `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md:341-445`
- Prior tag work: `context/changes/library-and-book-view/plan.md` (shipped the original filter), `context/changes/tag-a-book/plan.md` (added bulk-tag UI to the same component)
- PRD requirement: FR-011 ("User can filter the library by one or more tags")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: URL-driven filter, search, and view state

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit` — b13f73b
- [x] 1.2 Linting passes: `npm run lint` — b13f73b
- [x] 1.3 Build passes: `npm run build` — b13f73b

#### Manual

- [ ] 1.4 Loading `/?tags=<a-real-tag-name>` shows only books carrying that tag; the tag chip renders as active
- [ ] 1.5 Toggling a tag chip immediately updates the URL bar without a full page reload
- [ ] 1.6 Loading `/?q=heidegger` pre-fills the search box and filters to matching books
- [ ] 1.7 Loading `/?view=list` renders the list layout; view-toggle flips between grid (no key) and list
- [ ] 1.8 After applying filters, refreshing preserves the filter state exactly
- [ ] 1.9 Navigating to `/books/[id]` then hitting back returns to the filtered library
- [ ] 1.10 Typing in the search box does not stutter
- [ ] 1.11 Removing the last selected tag chip leaves the URL clean (no trailing `?` or `?tags=`)

### Phase 2: "Untagged" chip

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` — b13f73b
- [x] 2.2 Linting passes: `npm run lint` — b13f73b
- [x] 2.3 Build passes: `npm run build` — b13f73b

#### Manual

- [ ] 2.4 Mixed tagged/untagged library shows the Untagged chip in the strip
- [ ] 2.5 Clicking Untagged shows only untagged books; URL gets `untagged=1`
- [ ] 2.6 Activating Untagged while tag chips are active deselects the tag chips
- [ ] 2.7 Activating a tag chip while Untagged is active deselects Untagged
- [ ] 2.8 A user with no tags but with imported books still sees the Untagged chip
- [ ] 2.9 Loading `/?untagged=1` directly renders the untagged-only view
- [ ] 2.10 Refresh preserves Untagged state
