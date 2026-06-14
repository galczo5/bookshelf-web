# Tag Color Implementation Plan

## Overview

Add a `color` field to tags. Colors are chosen from a fixed 16-color muted palette (Tailwind 400-level). New tags get a random color on creation; existing tags default to slate-gray. Color displays as a small filled dot to the left of the tag name in every rendering context. The Tags page gains a swatch column that opens a 4×4 popover grid for changing a tag's color.

## Current State Analysis

Tags have `id`, `user_id`, `name`, `created_at` — no color column. The `Tag` interface in `src/lib/tags.ts` exposes only `id` and `name`. Tags are rendered in five places: the Tags management page, the book detail tag picker, library list view pills, library filter chips, and the quick-tag popover. `BookSummary.tags` in `src/lib/books.ts` is a separate inline type `{ id, name }` also missing color.

## Desired End State

Every tag carries a `color` hex string. The Tags page shows a small colored circle in a dedicated narrow column for each tag; clicking it opens a 4×4 color picker popover. Everywhere else tags appear (book detail pills, library list pills, library filter chips, popover suggestions) a small colored dot precedes the tag name. Library filter chips keep their blue active state when pressed — color dot only shows in the inactive state. When tags are merged, the target tag's color is preserved.

### Key Discoveries

- `src/lib/tags.ts:5-8` — `Tag` interface has only `id` and `name`; all five rendering contexts import this type and will gain `color` for free once updated
- `src/lib/books.ts:11` — `BookSummary.tags` is an inline `{ id, name }[]` type separate from `Tag`; needs a parallel update
- `src/lib/tags.ts:53-76` — `addTagToBook` uses `onConflict doNothing` on insert — color only needs to be provided on the initial insert row; existing tags keep their color naturally
- `src/lib/tags.ts:138-215` — merge path deletes source, keeps target; target's `color` is untouched — no merge-color logic needed
- `radix-ui` Popover is already in the codebase (`src/app/components/quick-tag-popover.tsx`) — reuse it for the color picker
- Next migration number is `0005`

## What We're NOT Doing

- No per-tag text-color calculation — dot is always the tag color, pill background stays neutral zinc
- No color visible on active filter chips (they stay solid blue)
- No custom color input (hex, RGB) — palette of 16 only
- No color shown in the merge confirmation UI — target color wins silently

## Implementation Approach

Three phases: (1) lay the database and TypeScript foundation so color flows end-to-end; (2) build the update action and Tags page picker so users can change colors; (3) thread the colored dot into the four remaining rendering contexts.

## Critical Implementation Details

**`renameOrMergeTag` internal Tag objects**: The function constructs bare `{ id, name }` objects when returning `RenameOutcome`. Once `Tag` requires `color`, these must include color too. The rename path should query color from the row before updating (or after), since it doesn't change. The merge path can derive color from the `target` row already fetched inside the transaction.

**`applyTagsToBooks` bulk insert**: This also uses `onConflict doNothing` on the tag upsert — assign a random color in the insert values. Tags that already exist are unaffected by the no-op conflict path.

---

## Phase 1: DB Migration, Types, and Data Layer

### Overview

Add the `color` column to the database. Update all TypeScript types and Kysely select queries to include color. Assign a random palette color whenever a new tag is created. Existing tags get slate-gray (`#94a3b8`).

### Changes Required

#### 1. Migration

**File**: `src/lib/db/migrations/0005_tag_color.mts`

**Intent**: Add a `color text not null default '#94a3b8'` column to the `tags` table. Backfills all existing rows with the default automatically.

**Contract**: Follows the shape of `0004_book_metadata_fields.mts`. Single `alterTable("tags").addColumn(...)` call — no `down` migration needed (additive change).

---

#### 2. Color palette utility

**File**: `src/lib/tag-colors.ts`

**Intent**: Define the canonical 16-color palette as a constant and export a `randomTagColor()` helper used when creating new tags.

**Contract**: Export `TAG_COLORS: readonly string[]` (16 hex values) and `randomTagColor(): string` (picks one at random). The 16 colors are Tailwind 400-level hues covering the full spectrum, ending with `'#94a3b8'` (slate-400) as the neutral default:

```ts
export const TAG_COLORS = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#facc15",
  "#a3e635",
  "#4ade80",
  "#34d399",
  "#2dd4bf",
  "#22d3ee",
  "#38bdf8",
  "#60a5fa",
  "#818cf8",
  "#a78bfa",
  "#c084fc",
  "#f472b6",
  "#94a3b8",
] as const;
```

---

#### 3. `TagsTable` TypeScript type

**File**: `src/lib/db.ts`

**Intent**: Add `color` to `TagsTable` so Kysely enforces it throughout all queries.

**Contract**: `color: ColumnType<string, string | undefined, string>` — readable always, optional on insert (has DB default), updatable.

---

#### 4. `Tag` interface and all queries in `tags.ts`

**File**: `src/lib/tags.ts`

**Intent**: Add `color: string` to the `Tag` interface and include `color` in every `select` that projects a `Tag`. Assign `randomTagColor()` on new tag creation.

**Contract**:

- `Tag` interface: add `color: string`
- `listUserTags`, `listBookTags`, `getTagById`, `findCollidingTag`: add `"color"` to `.select([...])`
- `listUserTagsWithCount`: add `"tags.color"` to `.select([...])` and include `color: r.color` in the mapping
- `addTagToBook` insert values: add `color: randomTagColor()` — applied only on the initial insert; the `onConflict doNothing` path leaves existing tags unchanged
- `applyTagsToBooks` insert values: add `color: randomTagColor()` — same reasoning
- `renameOrMergeTag` — the two bare `{ id: tagId, name: ... }` object constructions in the rename path must include `color`; retrieve the tag's current color from a pre-update select or from `target.color` in the merge branch

---

#### 5. `BookSummary.tags` type and queries in `books.ts`

**File**: `src/lib/books.ts`

**Intent**: Add `color` to the inline `tags` type on `BookSummary` and update all three tag-fetching queries so library list view pills receive color.

**Contract**:

- `BookSummary.tags` type: change to `Array<{ id: string; name: string; color: string }>`
- All three `selectFrom("book_tags").innerJoin("tags", ...)` blocks: add `"tags.color as tag_color"` to `.select([...])` and `color: r.tag_color` in the mapping

### Success Criteria

#### Automated Verification

- Migration applies cleanly: `npm run db:migrate`
- TypeScript compiles: `npx tsc --noEmit`
- Existing tests pass: `npm test`

#### Manual Verification

- Seed the dev DB and confirm new tags in the tag picker get colored dots in the browser after Phase 3 lands (database is ready now; UI comes later)

---

## Phase 2: Color Update Action + Tags Page Picker UI

### Overview

Add a `updateTagColor` data function, a server action, a reusable color picker popover component, and wire the Tags management table to show a clickable swatch column.

### Changes Required

#### 1. `updateTagColor` function

**File**: `src/lib/tags.ts`

**Intent**: Update a tag's `color` in the database. Validates ownership via `user_id`.

**Contract**: `updateTagColor(userId: string, tagId: string, color: string): Promise<void>` — simple `updateTable("tags").set({ color }).where("id", tagId).where("user_id", userId)`. No return value needed.

---

#### 2. `updateTagColorAction` server action

**File**: `src/app/actions/tags.ts`

**Intent**: Wrap `updateTagColor` as a Next.js server action callable from the Tags page client component.

**Contract**: Accepts a `FormData` with `tagId: string` and `color: string`. Validates `color` is a member of `TAG_COLORS` before calling `updateTagColor`. Returns a simple `{ ok: boolean; message?: string }` state type consistent with the other tag actions in this file.

---

#### 3. `TagColorPicker` component

**File**: `src/components/tag-color-picker.tsx`

**Intent**: A small Radix UI Popover containing a 4×4 grid of colored circles. Selecting a circle calls `onSelect(hexColor)` and closes the popover.

**Contract**:

```ts
interface TagColorPickerProps {
  currentColor: string;
  onSelect: (color: string) => void;
  disabled?: boolean;
}
```

Trigger is a `w-5 h-5` filled circle in `currentColor` (inline style). Grid renders `TAG_COLORS` as 16 circles; selected color gets a ring. Uses `radix-ui` `Popover.Root/Trigger/Content` — same import pattern as `quick-tag-popover.tsx`.

---

#### 4. Tags manager — swatch column + picker wiring

**File**: `src/app/(app)/tags/tags-manager.tsx`

**Intent**: Add a narrow first column to the tags table showing each tag's color swatch. Clicking it opens the `TagColorPicker` popover and fires `updateTagColorAction`, then refreshes the route.

**Contract**:

- `TagWithCount` type: gains `color: string` (already flows from `listUserTagsWithCount` after Phase 1)
- `TableHead`: add a new `w-10` header cell before the "Tag" header
- Non-editing row: render `<TagColorPicker currentColor={tag.color} onSelect={...} />` in the new first cell
- `onSelect` handler: calls `updateTagColorAction` via `startTransition`, then `router.refresh()` on success
- Editing row (`colSpan={2}` → `colSpan={3}`) to span the new column

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification

- Tags page shows a colored circle for each tag
- Clicking the circle opens a 4×4 color grid popover
- Selecting a new color updates the swatch immediately and persists after page refresh
- Rename flow is unaffected by the new column

---

## Phase 3: Color in All Other Rendering Contexts

### Overview

Add the colored dot to the four remaining places tags are shown: book detail tag pills, library list view tag pills, library filter chips (inactive state only), and quick-tag popover suggestions.

### Changes Required

#### 1. Book detail tag pills

**File**: `src/app/(app)/books/[id]/tag-picker.tsx`

**Intent**: Prefix each tag pill in the book detail view with a small colored dot.

**Contract**: Inside the `bookTags.map(...)` pill span, add a `<span>` before `{t.name}`:

```tsx
<span
  className="inline-block h-2 w-2 rounded-full flex-shrink-0"
  style={{ backgroundColor: t.color }}
/>
```

The outer pill keeps its existing `bg-zinc-100` background. `Tag` now has `color` so no prop changes are needed.

---

#### 2. Library list view tag pills

**File**: `src/app/components/book-card.tsx`

**Intent**: Add a colored dot to the small tag pills rendered in the list-view book card.

**Contract**: In the `book.tags.map(...)` block (line ~168), add the same `<span>` dot before `{t.name}`. `BookSummary.tags` now includes `color` after Phase 1.

---

#### 3. Library filter chips — inactive state

**File**: `src/app/components/library-view.tsx`

**Intent**: Show a colored dot inside inactive filter chips. Active chips (solid blue) stay unchanged.

**Contract**: Inside the `tags.map(...)` chip button (~line 244), add the dot conditionally — only when the chip is inactive:

```tsx
{
  !activeTagNames.has(t.name) && (
    <span
      className="inline-block h-2 w-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: t.color }}
    />
  );
}
{
  t.name;
}
```

`Tag` now has `color`; no prop changes needed (`tags: Tag[]` is already passed to `LibraryView`).

---

#### 4. Quick-tag popover suggestions

**File**: `src/app/components/quick-tag-popover.tsx`

**Intent**: Add a colored dot to each tag suggestion item in the popover dropdown.

**Contract**: In the `suggestions.map(...)` list item button, add the dot before `{t.name}`. `Tag` now has `color`; `allUserTags: Tag[]` already carries it.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Existing Playwright e2e tests pass: `npm run test:e2e`

#### Manual Verification

- Book detail page: tag pills show colored dots
- Library grid view: no change (tags not shown in grid cards)
- Library list view: tag pills under book titles show colored dots
- Library filter chips: inactive chips show colored dot; active chip (when clicked) shows solid blue with no dot
- Quick-tag popover: suggestion items show colored dot to the left of tag name

---

## Testing Strategy

### Unit Tests

- None needed: the palette utility is trivial and the color picker is purely presentational

### Integration Tests

- None needed beyond what's already covered; the DB change is additive with a safe default

### Manual Testing Steps

1. Run `npm run db:migrate` — confirm migration applies
2. Run `npm run db:seed` — seeded tags should have random colors (all distinct from slate-gray)
3. Open Tags page — confirm each row shows a swatch circle in a narrow first column
4. Click a swatch — confirm 4×4 color grid popover opens with the current color highlighted
5. Select a new color — confirm swatch updates and persists after page refresh
6. Open a book detail page — confirm tag pills have colored dots
7. Open library in list view — confirm book tag pills have colored dots
8. Click a filter chip — confirm dot disappears (active state is blue) and reappears on second click (inactive)
9. Open quick-tag popover from library — confirm suggestions have colored dots
10. Rename a tag to cause a merge — confirm merged tag keeps target's color (no color change)

## References

- Radix UI Popover pattern: `src/app/components/quick-tag-popover.tsx`
- Migration pattern: `src/lib/db/migrations/0004_book_metadata_fields.mts`
- Tag action pattern: `src/app/actions/tags.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB Migration, Types, and Data Layer

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:migrate` — 2ddf05b
- [x] 1.2 TypeScript compiles: `npx tsc --noEmit` — 2ddf05b
- [x] 1.3 Existing tests pass: `npm test` — 2ddf05b

#### Manual

- [ ] 1.4 New tags in the tag picker get colored dots in the browser after Phase 3 lands

### Phase 2: Color Update Action + Tags Page Picker UI

#### Automated

- [x] 2.1 TypeScript compiles: `npx tsc --noEmit` — 853b30e
- [x] 2.2 Lint passes: `npm run lint` — 853b30e

#### Manual

- [ ] 2.3 Tags page shows a colored circle for each tag
- [ ] 2.4 Clicking the circle opens a 4×4 color grid popover
- [ ] 2.5 Selecting a new color updates the swatch immediately and persists after page refresh
- [ ] 2.6 Rename flow is unaffected by the new column

### Phase 3: Color in All Other Rendering Contexts

#### Automated

- [x] 3.1 TypeScript compiles: `npx tsc --noEmit` — 454265b
- [x] 3.2 Lint passes: `npm run lint` — 454265b
- [x] 3.3 Existing Playwright e2e tests pass: `npm run test:e2e` — 454265b

#### Manual

- [ ] 3.4 Book detail page: tag pills show colored dots
- [ ] 3.5 Library list view: tag pills under book titles show colored dots
- [ ] 3.6 Library filter chips: inactive chips show colored dot; active chip shows solid blue with no dot
- [ ] 3.7 Quick-tag popover: suggestion items show colored dot to the left of tag name
