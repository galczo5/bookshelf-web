# Left Sidebar Polish — Implementation Plan

## Overview

The left sidebar is currently a static nav with no data — just three links, an Import button, and the user's email. This plan adds four content-richness additions to make it feel like a live library dashboard: a stats strip, a pinned tag list with per-tag counts, a "Recently Added" mini-list, and an untagged-books count badge.

## Current State Analysis

- `src/app/components/app-sidebar.tsx` (87 lines): `"use client"` component receiving only `{ email: string }`. No data fetching, no dynamic content.
- `src/app/(app)/layout.tsx` (23 lines): server component that calls `auth()` and passes `email` to `AppSidebar`. No user-ID resolution, no data queries.
- `src/lib/books.ts`: exposes `listConfirmedBooks` (full book list + tag join, 2 queries), no lean stats query.
- `src/lib/tags.ts`: `listUserTagsWithCount` already exists and is proven on the Tags page.
- Library tag filtering uses URL params by **tag name**: `/?tags=<tagName>` (observed in `LibraryView` via `searchParams.getAll("tags")`).
- Book detail route: `/books/[id]`. Cover API: `/api/books/[id]/cover` (authenticated, cached 1h).

### Key Discoveries

- `getUserIdByEmail` throws if the user doesn't exist (`executeTakeFirstOrThrow`). The layout must call `upsertUserByEmail` first — same pattern as the home page. `src/lib/users.ts:4–19`.
- `listConfirmedBooks` does a 2-query approach (books then tag join). A separate `listRecentBooks` avoids the tag join entirely for the sidebar's 3-item fetch.
- `collapsible="icon"` on the `<Sidebar>` means non-icon content must carry `group-data-[collapsible=icon]:hidden` to vanish cleanly in collapsed mode.
- The `SidebarMenuButton size="lg"` variant in the header is designed for a two-line app-name + subtitle layout — the stats strip fits naturally there.

## Desired End State

The sidebar shows: a stats strip (`N books · M tags`) beneath the Bookshelf branding; a Library nav item with an untagged-count badge (when > 0); a "Tags" section with all user tags (capped at 8, "+N more" link to `/tags` when overflow); and a "Recently Added" section with the last 3 books (cover thumbnail + truncated title linking to `/books/[id]`). The "Tags" and "Recently Added" sections are hidden when the sidebar collapses to icon-only mode.

### Key Discoveries

- All content must degrade to nothing in collapsed mode — `group-data-[collapsible=icon]:hidden` on both new `SidebarGroup`s.
- `listUserTagsWithCount` returns tags ordered alphabetically — the plan uses existing ordering (no resorting by count needed).

## What We're NOT Doing

- No tag sorting/reordering in the sidebar (alphabetical is fine)
- No "favorite" or pinned tags distinct from the full list
- No cover lazy-loading or blur-up placeholders (a broken img just shows nothing)
- No caching layer (acceptable at this user scale)
- No mobile-specific sidebar handling (shadcn handles it)
- No search within the sidebar tag list
- No animation on the new sections

## Implementation Approach

Two-phase delivery: data layer first (new query functions + types), then layout wiring and sidebar rendering. The data layer is independently testable; the UI phase completes the feature.

---

## Phase 1: Data Layer

### Overview

Add two new query functions to `src/lib/books.ts` and export their types. The layout will call these in Phase 2.

### Changes Required

#### 1. `BookStats` type and `listUserBookStats` function

**File**: `src/lib/books.ts`

**Intent**: Export a `BookStats` interface and a `listUserBookStats(userId)` function returning total confirmed-book count, total tag count, and untagged confirmed-book count — all in a single round-trip via three parallel sub-queries.

**Contract**:

```ts
export interface BookStats {
  totalBooks: number;
  totalTags: number;
  untaggedBooks: number; // confirmed, not trashed, with zero book_tags rows
}
export async function listUserBookStats(userId: string): Promise<BookStats>;
```

The untagged count uses a `NOT EXISTS` subquery on `book_tags` (not a LEFT JOIN + IS NULL). `Promise.all` over three Kysely count queries keeps the implementation straightforward without raw SQL.

#### 2. `RecentBook` type and `listRecentBooks` function

**File**: `src/lib/books.ts`

**Intent**: Export a `RecentBook` interface and a `listRecentBooks(userId, limit = 3)` function that returns the most recently imported confirmed books — without the tag join, since the sidebar only needs id/title/hasCover.

**Contract**:

```ts
export interface RecentBook {
  id: string;
  title: string;
  hasCover: boolean;
}
export async function listRecentBooks(userId: string, limit?: number): Promise<RecentBook[]>;
```

Mirrors the `listConfirmedBooks` predicates (`review_state = 'confirmed'`, `trashed_at IS NULL`) and ordering (`created_at DESC`), but skips the second tag-join query and applies `LIMIT`.

### Success Criteria

#### Automated Verification

- TypeScript compiles with no errors: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification

- Calling `listUserBookStats` against the dev DB (via `npm run db:seed` first) returns plausible numbers
- Calling `listRecentBooks` returns at most 3 rows, newest first

**Implementation Note**: After Phase 1 automated verification passes, proceed directly to Phase 2 — manual DB spot-check can be done once the sidebar is wired.

---

## Phase 2: Layout Wiring + Sidebar Rendering

### Overview

Extend `(app)/layout.tsx` to fetch sidebar data and pass it as props, then update `AppSidebar` to render the four new UI sections.

### Changes Required

#### 1. Update `(app)/layout.tsx` to fetch and pass sidebar data

**File**: `src/app/(app)/layout.tsx`

**Intent**: After resolving the auth session, call `upsertUserByEmail` + `getUserIdByEmail` (same pattern as the home page), then fetch stats, tags-with-count, and recent books in a single `Promise.all`. Pass all three as new props to `AppSidebar`.

**Contract**: `AppSidebar` call site changes from `<AppSidebar email={...} />` to:

```tsx
<AppSidebar email={session.user.email} stats={stats} tags={tags} recentBooks={recentBooks} />
```

Where `stats: BookStats`, `tags: Array<Tag & { bookCount: number }>`, `recentBooks: RecentBook[]`.

#### 2. Expand `AppSidebar` props interface

**File**: `src/app/components/app-sidebar.tsx`

**Intent**: Widen the component's props from `{ email: string }` to accept the three new data props.

**Contract**:

```ts
interface AppSidebarProps {
  email: string;
  stats: BookStats;
  tags: Array<Tag & { bookCount: number }>;
  recentBooks: RecentBook[];
}
```

Import `BookStats`, `RecentBook` from `@/lib/books` and `Tag` from `@/lib/tags`.

#### 3. Stats strip in `SidebarHeader`

**File**: `src/app/components/app-sidebar.tsx`

**Intent**: Replace the single `<span className="font-semibold">Bookshelf</span>` in the header's `SidebarMenuButton` with a two-line block: the app name on top and `{stats.totalBooks} books · {stats.totalTags} tags` as a small muted line below.

**Contract**: The `SidebarMenuButton size="lg"` already supports a two-line layout (shadcn's app-name + subtitle pattern). No structural changes to the header needed — only the span's content expands to a `<div>` with two child spans.

#### 4. Untagged-books badge on the Library nav item

**File**: `src/app/components/app-sidebar.tsx`

**Intent**: When `stats.untaggedBooks > 0`, render a small count badge after the "Library" label text inside its `SidebarMenuButton`. This nudges the user to tag their books.

**Contract**: Only the Library item (`href: "/"`) gets the badge. The `navItems` array stays static; badge rendering is handled inline in the map with a conditional on `item.href === "/"`. In icon-only collapsed mode the badge is hidden along with the label text (shadcn handles this via its collapsible CSS).

#### 5. Pinned tag list (`SidebarGroup`)

**File**: `src/app/components/app-sidebar.tsx`

**Intent**: Add a new `SidebarGroup` below the nav group, visible only in expanded mode, that lists all user tags (capped at 8 by count) as clickable filter links, each with a small book-count badge. When more than 8 tags exist, a "+N more" item links to `/tags`.

**Contract**:

- Group carries `className="group-data-[collapsible=icon]:hidden"` to vanish when collapsed.
- Include `SidebarGroupLabel` with the text "Tags".
- Each tag item is a `SidebarMenuButton asChild` wrapping `<Link href={`/?tags=${tag.name}`}>`. Displays the tag name + `{tag.bookCount}` count badge.
- `displayedTags = tags.slice(0, 8)`. `overflow = tags.length - 8`. When `overflow > 0`, append a non-link "More" item linking to `/tags` with text `+{overflow} more`.
- Entire group conditionally rendered only when `tags.length > 0`.

#### 6. "Recently Added" book mini-list (`SidebarGroup`)

**File**: `src/app/components/app-sidebar.tsx`

**Intent**: Add a second new `SidebarGroup` below the tag group, visible only in expanded mode, that shows the last 3 imported books with a small cover thumbnail and truncated title. Each item links to `/books/[id]`.

**Contract**:

- Group carries `className="group-data-[collapsible=icon]:hidden"`.
- Include `SidebarGroupLabel` with the text "Recently Added".
- Each item: `SidebarMenuButton asChild` wrapping `<Link href={`/books/${book.id}`}>`. Left side is a 24×24 `<img src={`/api/books/${book.id}/cover`} />` (only rendered when `book.hasCover`; replaced with a neutral placeholder `<div>` otherwise). Right side is a `<span>` with the truncated title.
- Entire group conditionally rendered only when `recentBooks.length > 0`.

### Success Criteria

#### Automated Verification

- TypeScript compiles with no errors: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification

- Stats strip shows correct counts matching actual DB state
- Library nav item shows an untagged-books badge when untagged books exist; badge disappears after all books are tagged
- Tag list appears in sidebar, each tag links to `/?tags=<tagName>` and activates the library filter correctly
- When more than 8 tags exist, "+N more" link appears and navigates to `/tags`
- "Recently Added" section shows the 3 most recently imported books with cover thumbnails
- Clicking a recent book navigates to its detail page
- Collapsing the sidebar (via the trigger) hides the Tags and Recently Added sections; expanding restores them
- No regressions: existing nav items (Library, Tags, Trash, Import) still work; sign-out still works

**Implementation Note**: After completing Phase 2 and automated verification passes, perform the manual checks above before marking the change complete.

---

## Testing Strategy

### Unit Tests

No new unit tests required — the query functions follow identical patterns to `listConfirmedBooks` and `listUserTagsWithCount`, which have been exercised by integration tests already.

### Integration Tests

No new integration tests required for this change. If integration test coverage for `listUserBookStats` is desired, add it alongside existing book query tests in `tests/integration/`.

### Manual Testing Steps

1. Seed the dev DB: `npm run db:seed`
2. Open the app. Verify stats strip shows "50 books · N tags" (seed creates 50 books).
3. Verify "Recently Added" shows 3 book titles with cover images.
4. Verify "Tags" section shows seed tags with correct counts.
5. Click a tag in the sidebar — library should filter to that tag.
6. Navigate to a book and remove all its tags. Return to the sidebar — verify untagged count badge appears on Library.
7. Collapse the sidebar via the trigger button. Verify Tags and Recently Added sections are hidden. Re-expand; verify they return.
8. Verify sign-out still works from the footer.

## Performance Considerations

Three additional DB queries per navigation (stats, tags-with-count, recent books). All are lightweight aggregations or small-limit selects. At single-user scale, this is negligible. No caching layer needed.

## References

- Research doc: `context/changes/left-sidebar-polish/research.md`
- Existing sidebar: `src/app/components/app-sidebar.tsx`
- App layout (data-passing pattern): `src/app/(app)/layout.tsx`
- Tags query (proven existing): `src/lib/tags.ts:21–44`
- Cover URL pattern: `src/app/components/book-card.tsx:30`
- Book detail route: `src/app/components/book-card.tsx:72`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data Layer

#### Automated

- [x] 1.1 TypeScript compiles with no errors: `npx tsc --noEmit`
- [x] 1.2 Lint passes: `npm run lint`

#### Manual

- [ ] 1.3 `listUserBookStats` returns plausible numbers against seeded DB
- [ ] 1.4 `listRecentBooks` returns at most 3 rows, newest first

### Phase 2: Layout Wiring + Sidebar Rendering

#### Automated

- [ ] 2.1 TypeScript compiles with no errors: `npx tsc --noEmit`
- [ ] 2.2 Lint passes: `npm run lint`

#### Manual

- [ ] 2.3 Stats strip shows correct counts
- [ ] 2.4 Library nav item shows untagged badge; badge disappears when all books are tagged
- [ ] 2.5 Tag list links to `/?tags=<tagName>` and filters correctly
- [ ] 2.6 "+N more" link appears when > 8 tags and navigates to `/tags`
- [ ] 2.7 "Recently Added" shows 3 books with covers; clicking navigates to detail page
- [ ] 2.8 Collapsing sidebar hides Tags and Recently Added sections
- [ ] 2.9 No regressions in existing nav, Import button, or sign-out
