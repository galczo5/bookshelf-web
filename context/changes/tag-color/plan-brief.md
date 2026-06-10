# Tag Color — Plan Brief

> Full plan: `context/changes/tag-color/plan.md`

## What & Why

Tags currently have no color — they all look identical wherever they appear. This change adds a `color` field to tags, a 16-color muted palette, and a color picker on the Tags page. The goal is to let the user visually distinguish tags at a glance across the whole app.

## Starting Point

The `tags` table has `id`, `user_id`, `name`, `created_at`. The `Tag` TypeScript interface exposes only `id` and `name`. Tags are rendered in five places and all use a flat neutral zinc style with no color differentiation.

## Desired End State

Every tag has a hex color. The Tags page shows a clickable swatch circle per row that opens a 4×4 color popover. Everywhere else a tag appears — book detail pills, library list pills, library filter chips (inactive), and quick-tag popover suggestions — a small filled dot in the tag's color sits to the left of the name. New tags get a random color; existing tags default to slate-gray.

## Key Decisions Made

| Decision            | Choice                                      | Why (1 sentence)                                                                | Source |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| Color storage       | Hex string (e.g. `#60a5fa`)                 | Self-documenting, directly usable in CSS inline style, no mapping table         | Plan   |
| Palette             | 16 muted Tailwind 400-level hues            | Distinct but not garish; work as small dots against any background              | Plan   |
| Tag pill appearance | Small colored dot + neutral pill            | Works with any color without contrast calculation; fits existing zinc-100 style | Plan   |
| Color picker UX     | Swatch column in tags table → Radix popover | One-click color change without coupling to the rename flow                      | Plan   |
| Merge behavior      | Target tag's color wins                     | Consistent with merge semantics — target is the survivor in all respects        | Plan   |
| Migration default   | `#94a3b8` (slate-400) for all existing rows | Safe and visible; users can reassign on the tags page                           | Plan   |
| Active filter chip  | Stays solid blue (status wins)              | Active/inactive state must remain immediately obvious                           | Plan   |

## Scope

**In scope:**

- `color` column on `tags` table (migration 0005)
- `Tag` interface and `TagsTable` type updates
- All Kysely select queries that return `Tag` objects
- Random color assignment on new tag creation
- `updateTagColor` function + server action
- `TagColorPicker` component (4×4 Radix popover grid)
- Colored dot in all five rendering contexts

**Out of scope:**

- Custom hex/RGB color input
- Per-tag text contrast calculation
- Color on active filter chips
- Color in the merge confirmation UI

## Architecture / Approach

Additive DB migration → TypeScript propagation → new picker component → UI wiring. Color flows end-to-end through the existing `Tag` type so all five rendering contexts just need a dot span added. The picker reuses the Radix Popover already in the codebase.

## Phases at a Glance

| Phase                          | What it delivers                                           | Key risk                                                                          |
| ------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1. DB + Types + Data Layer     | Color in DB and all TS types; random color on create       | `renameOrMergeTag` constructs bare `{ id, name }` objects that need `color` added |
| 2. Color Action + Tags Page UI | Color picker on tags page; users can change tag colors     | Radix popover in a Radix-based table row needs z-index/scroll care                |
| 3. Color in All Contexts       | Colored dot in library, book detail, filter chips, popover | Library filter chips have two states; dot must only appear on inactive state      |

**Prerequisites:** Docker Postgres running for migration; dev seed refreshed after migration  
**Estimated effort:** ~2 sessions across 3 phases

## Open Risks & Assumptions

- `BookSummary.tags` in `books.ts` is a separate inline type from `Tag` in `tags.ts` — both must be updated in Phase 1 or the library list view will lose type safety
- The seed script (`scripts/seed.mts`) may hard-code tag inserts without a `color` field — check and add `randomTagColor()` calls there too if so

## Success Criteria (Summary)

- Tags page: every tag row has a clickable swatch; selecting a color persists immediately
- All rendering contexts show a colored dot to the left of the tag name
- Merge, rename, and filter behavior are unaffected
