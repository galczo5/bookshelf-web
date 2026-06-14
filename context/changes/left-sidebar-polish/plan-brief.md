# Left Sidebar Polish — Plan Brief

> Full plan: `context/changes/left-sidebar-polish/plan.md`
> Research: `context/changes/left-sidebar-polish/research.md`

## What & Why

The left sidebar is a static nav with no data — three links, an Import button, and an email in the footer. It looks empty and misses the opportunity to surface information the user cares about at a glance. This plan adds four content-richness additions to make the sidebar feel like a live library dashboard.

## Starting Point

`AppSidebar` is a `"use client"` component receiving only `{ email: string }`. The `(app)/layout.tsx` server component calls `auth()` and passes the email — no user-ID resolution, no DB queries. The query layer already has `listUserTagsWithCount` (proven on the Tags page) and `listConfirmedBooks`; a lightweight stats query and a lean recent-books query are the only new additions needed.

## Desired End State

The sidebar shows: a **stats strip** (`N books · M tags`) beneath the Bookshelf branding; a **Library nav badge** with untagged-book count (when > 0); a **Tags section** with per-tag book counts capped at 8 ("+N more" link to `/tags` when overflow); and a **Recently Added section** with the last 3 books (cover + title linking to `/books/[id]`). Tags and Recently Added collapse to nothing in icon-only mode.

## Key Decisions Made

| Decision                | Choice                                   | Why (1 sentence)                                                               | Source   |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| Which content to add    | All four additions                       | User selected all — stats strip, tag list, recent books, untagged badge        | Plan     |
| Tag list cap            | 8 tags, "+N more" link                   | Keeps sidebar compact as library grows; link preserves discoverability         | Plan     |
| Data-fetch location     | `(app)/layout.tsx` (server)              | Follows the established `email` prop pattern; single server round-trip         | Plan     |
| Collapsed-mode behavior | Tags + Recent sections hidden entirely   | `group-data-[collapsible=icon]:hidden`; clean icon bar with no noise           | Plan     |
| Tag filter URL format   | `/?tags=<tagName>`                       | Existing `LibraryView` already reads `searchParams.getAll("tags")` by name     | Research |
| Recent books query      | New lean `listRecentBooks` (no tag join) | Avoids the 2-query overhead of `listConfirmedBooks` for a 3-item sidebar fetch | Plan     |

## Scope

**In scope:**

- Stats strip (book count + tag count) in sidebar header
- Untagged-books count badge on Library nav item
- Pinned tag list with per-tag book counts (max 8 + overflow link)
- "Recently Added" mini-list (last 3 books, cover thumbnail + title)
- New `listUserBookStats` and `listRecentBooks` query functions

**Out of scope:**

- Tag sorting/reordering (alphabetical stays)
- Cover lazy-loading or blur-up
- Caching layer
- Mobile-specific sidebar behavior
- Search within sidebar tag list
- Any other nav items or pages

## Architecture / Approach

`(app)/layout.tsx` gains `upsertUserByEmail` + `getUserIdByEmail` + three parallel DB queries (`listUserBookStats`, `listUserTagsWithCount`, `listRecentBooks`). Results pass as new props to `AppSidebar`, which remains a client component. Two new `SidebarGroup` blocks (Tags, Recently Added) are appended inside `SidebarContent` with `group-data-[collapsible=icon]:hidden`. The untagged badge renders inline in the Library nav item's existing `SidebarMenuButton`. No new routes, no schema changes.

## Phases at a Glance

| Phase               | What it delivers                                                         | Key risk                                                                                   |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1. Data Layer       | `BookStats` + `RecentBook` types, `listUserBookStats`, `listRecentBooks` | None — follows existing Kysely patterns exactly                                            |
| 2. Layout + Sidebar | Data wired through layout, all four UI sections rendered                 | `group-data-[collapsible=icon]:hidden` on the right elements; test collapsed mode manually |

**Prerequisites:** Dev DB running with seed data (`npm run db:seed`)  
**Estimated effort:** ~1 session across 2 phases

## Open Risks & Assumptions

- `getUserIdByEmail` throws if user doesn't exist — the layout must call `upsertUserByEmail` first (same pattern as `page.tsx`; low risk since session auth already gated this path)
- With many tags (> 8), the "+N more" link goes to `/tags` — no in-sidebar pagination

## Success Criteria (Summary)

- Stats strip, tag list, recent books, and untagged badge all appear with correct data from the seeded DB
- Clicking a sidebar tag filters the library; clicking a recent book navigates to its detail page
- Collapsing the sidebar hides the new sections cleanly with no layout shift or leftover elements
