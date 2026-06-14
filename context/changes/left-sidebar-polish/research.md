---
date: 2026-06-13T00:00:00+02:00
researcher: Claude Sonnet 4.6
git_commit: 9a59dab1c11b246089b888c8c5123707b23bd7e6
branch: test/playwright-e2e-harness
repository: bookshelf
topic: "Left sidebar polish — content richness"
tags: [research, codebase, sidebar, ui, library-stats, tags]
status: complete
last_updated: 2026-06-13
last_updated_by: Claude Sonnet 4.6
---

# Research: Left Sidebar Polish — Content Richness

**Date**: 2026-06-13  
**Researcher**: Claude Sonnet 4.6  
**Git Commit**: `9a59dab1c11b246089b888c8c5123707b23bd7e6`  
**Branch**: `test/playwright-e2e-harness`  
**Repository**: bookshelf

## Research Question

The left sidebar looks empty. What's currently in it, and what data is already available to make it richer?

## Summary

The sidebar is a static client component with no data — just nav links and an email display. The database and existing query layer already have everything needed to show a rich stats block and a pinned tag list with counts. The only work is (1) a new lightweight stats query, (2) extending `(app)/layout.tsx` to fetch and pass it down, and (3) rendering it in `AppSidebar`.

## Detailed Findings

### Current Sidebar Structure

**File**: `src/app/components/app-sidebar.tsx` (87 lines, client component)

The sidebar has three zones:

**Header** (lines 29–40):

- "Bookshelf" label + `BookOpen` icon — non-interactive branding block.

**Main nav** (lines 42–62):

- Library → `/` (`BookOpen`)
- Tags → `/tags` (`Tag`)
- Trash → `/trash` (`Trash2`)
- Import — `SidebarImport` component, triggers epub file picker

**Footer** (lines 64–81):

- User email (truncated, read-only display)
- Sign out form → `signOutAction`

The component receives only `{ email: string }` as props. There is no data fetching anywhere in the sidebar.

**App layout** (`src/app/(app)/layout.tsx`, lines 12–21) wraps the page tree in `<SidebarProvider>` and mounts `<AppSidebar email={session.user.email} />`. This is where additional props would be passed.

### Available Data for Content Richness

Everything below is already in the DB and query layer — no schema changes needed.

#### Ready to use now

| Data                                               | Source                          | File:Line              |
| -------------------------------------------------- | ------------------------------- | ---------------------- |
| All confirmed books (ordered by `created_at DESC`) | `listConfirmedBooks(userId)`    | `src/lib/books.ts:35`  |
| Tags with per-tag book count                       | `listUserTagsWithCount(userId)` | `src/lib/tags.ts:21`   |
| Trashed books list                                 | `listTrashedBooks(userId)`      | `src/lib/books.ts:145` |

`listUserTagsWithCount` is **already called** in the Tags page (`src/app/(app)/tags/page.tsx:12`) — the query exists and is proven.

#### Easy to add (one new function)

A single `listUserBookStats(userId)` query using COUNT aggregates would return:

```ts
{
  totalBooks: number; // confirmed, not trashed
  totalTags: number; // all user tags
  trashedBooks: number; // trashed count
  untaggedBooks: number; // confirmed books with no tag
}
```

This is a single SQL round-trip (three CTEs or sub-selects on existing predicates).

#### Database schema reference

- `src/lib/db.ts:28–55` — `books` table: `id, user_id, title, author, cover_bytes, review_state, trashed_at, created_at`
- `src/lib/db.ts:69–75` — `tags` table: `id, user_id, name, color`
- `src/lib/db.ts:77–81` — `book_tags` join table
- `src/lib/db.ts:83–89` — `notes` table

### Data-Fetching Pattern in This App

All data fetching is `server-only`, called from page/layout server components, then passed as props to client components. The sidebar already follows this: `(app)/layout.tsx` fetches session and passes `email` prop. The same layout is the right place to call a stats query and pass additional props to `AppSidebar`.

## Concrete Improvement Options

These are ordered by richness-to-effort ratio:

### Option A — Stats strip in sidebar header (low effort, high impact)

Show a compact `N books · M tags` line beneath the "Bookshelf" branding. Requires: new `listUserBookStats` query, one extra prop on `AppSidebar`, 3–4 lines of JSX. No layout change needed.

### Option B — Pinned tag list with counts (medium effort, high content richness)

Show the top N tags (by book count, or all tags if count < 8) directly in the sidebar as clickable filter shortcuts, each with a small count badge. `listUserTagsWithCount` already exists. Requires: pass tags as prop, add a `SidebarGroup` section, wire clicks to library filter state (which already uses URL params or React state on the home page).

### Option C — Recently added books mini-list (medium effort)

Show the last 3 book titles (from `listConfirmedBooks`, first 3 rows) with a small cover thumbnail. Covers are stored as bytes in DB (`cover_bytes`/`cover_mime`) and served via an existing route. This makes the sidebar feel like a live library dashboard rather than a static nav.

### Option D — "Needs attention" badge (low effort)

Add a badge to the Library nav item showing untagged book count — a nudge to curate the library. Pure count, no extra UI structure.

## Code References

- `src/app/components/app-sidebar.tsx:1–87` — full sidebar component
- `src/app/(app)/layout.tsx:12–21` — where sidebar is mounted and email prop is passed
- `src/app/components/sidebar-import.tsx:1–39` — Import button (epub file picker)
- `src/lib/books.ts:35–81` — `listConfirmedBooks` (returns recent books sorted by created_at)
- `src/lib/tags.ts:21–44` — `listUserTagsWithCount` (tags + per-tag book count, already used)
- `src/lib/db.ts:28–89` — full DB schema interfaces
- `src/app/(app)/tags/page.tsx:12` — example caller of `listUserTagsWithCount`

## Architecture Insights

- The `collapsible="icon"` mode on `<Sidebar>` means content richness additions must degrade gracefully to icon-only when collapsed. Counts and labels will be hidden automatically by shadcn's sidebar primitives; covers would need explicit `group-data-[collapsible=icon]:hidden` guards.
- All shadcn sidebar primitives (`SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`) support adding new sections without touching the nav items — minimal risk of regressions.
- The sidebar uses `SidebarMenuButton` with `tooltip` prop — tooltips already fire in icon-only mode, so collapsed-state UX is handled.

## Open Questions

1. For Option B (tag filter shortcuts in sidebar): does clicking a tag in the sidebar navigate to `/?tag=X` (URL-param filter) or use shared React state? Check how `LibraryView` currently handles tag filtering.
2. For Option C (recent books): are cover images served via a dedicated route or inline data URLs? Check `src/app/(app)/books/[id]/cover/route.ts` or similar.
3. How many tags does a typical user have? If > 10, the sidebar tag list needs a "show more" affordance or a count cap.
