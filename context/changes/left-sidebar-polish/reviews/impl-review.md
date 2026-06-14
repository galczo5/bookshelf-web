<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Left Sidebar Polish

- **Plan**: context/changes/left-sidebar-polish/plan.md
- **Scope**: All phases (Phase 1 + Phase 2)
- **Date**: 2026-06-14
- **Verdict**: NEEDS ATTENTION (resolved via triage)
- **Findings**: 0 critical · 2 warnings · 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Unhandled DB error from user resolution crashes the entire app shell

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/layout.tsx:14–15
- **Detail**: The layout calls upsertUserByEmail + getUserIdByEmail on every navigation. If the DB is unreachable, the unhandled throw produces a raw Next.js 500 for every page in the app. The home page has the same gap but only affects a single page.
- **Fix A ⭐ Applied**: Wrap upsert+getUserId in try/catch; redirect to /signin on error.
  - Strength: Graceful degradation — user sees an actionable page.
  - Tradeoff: A few boilerplate lines in the layout.
  - Confidence: HIGH
  - Blind spot: Doesn't fix page.tsx (same pattern there).
- **Decision**: FIXED via Fix A

### F2 — Inconsistent eslint-disable style for `<img>` across sidebar and book-card

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/components/app-sidebar.tsx:127
- **Detail**: The sidebar had a `// eslint-disable-next-line @next/next/no-img-element` comment before its cover `<img>`. book-card.tsx uses bare `<img>` at four places without any suppression comment. The project clearly accepts bare `<img>` throughout; the per-line suppression was inconsistent.
- **Fix**: Remove the `// eslint-disable-next-line` comment so both files show the same warning.
- **Decision**: FIXED

### F3 — Stats strip uses richer shadcn primitives than the plan described

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/components/app-sidebar.tsx:45–56
- **Detail**: The plan said "replace the single `<span>` with a two-line `<div>`." The implementation keeps the existing SidebarMenuButton size="lg" with the BookOpen icon avatar and only expands the text slot. Positive drift — follows the established shadcn sidebar pattern for branded headers.
- **Decision**: SKIPPED (positive drift)

### F4 — Untagged badge was unstyled count text, not a visual pill

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/components/app-sidebar.tsx:70–73
- **Detail**: The plan says "render a small count badge." Implementation initially rendered a muted `ml-auto <span>` with just the number — no background or pill shape.
- **Fix**: Added `rounded-full bg-muted px-1.5 py-0.5` to make it a visible pill badge.
- **Decision**: FIXED

### F5 — totalTags counts tags attached to trashed books

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/books.ts:325–328
- **Detail**: listUserBookStats counts all tags for the user regardless of whether they are attached only to trashed books. Tags are user-level entities; this is intentional.
- **Decision**: SKIPPED (intentional)

### F6 — 7 DB queries per navigation; plan implied 3 additional

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/layout.tsx:14–21
- **Detail**: The plan said "three additional DB queries." Actual count is 7 (listUserBookStats itself fires 3 parallel sub-queries). All are lightweight aggregations at single-user scale; the plan explicitly accepted the performance trade-off.
- **Decision**: SKIPPED (plan accepted trade-off)

### F7 — Untagged badge keyed on href === "/" literal; silent if Library route moves

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/components/app-sidebar.tsx:70
- **Detail**: Badge rendered only when `item.href === "/"`. If the Library route changes, the badge silently disappears with no type error.
- **Fix**: Moved navItems array inside the component; added a `badge` field set to `stats.untaggedBooks || undefined`. Badge now renders via `item.badge !== undefined`.
- **Decision**: FIXED
