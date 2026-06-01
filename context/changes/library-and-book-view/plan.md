# Library and Book View Implementation Plan

## Overview

Build the primary reading experience: a switchable grid/list library view with client-side search and tag filtering, a book detail page with a modal Tiptap-powered note editor (Markdown), an inline tag picker, a cover image API route, and a `/tags` settings page for global tag rename.

## Current State Analysis

The homepage (`src/app/page.tsx`) is a minimal centered card containing only an import dropzone and a Drive connection check. No library, book detail, or tag management UI exists.

The full database schema is in place: `books`, `tags`, `book_tags`, `notes` (migration `0002_library_schema.mts`), and `book_drafts` (migration `0003_book_drafts.mts`). The `books` table carries `review_state` (`pending` | `confirmed`) — confirmed books are the live library. Cover images are stored as `cover_bytes` (bytea) + `cover_mime` in the `books` table; no API route to serve them exists.

Kysely type definitions for all tables are in `src/lib/db.ts`. Existing data-layer helpers: `getUserIdByEmail` in `src/lib/users.ts`. No query functions for library listing, tags, or notes exist yet. Server actions live in `src/app/actions/`. UI primitives: `Card`, `Button`, `Alert` (`src/components/ui/`); Radix UI (`radix-ui` package) is installed.

### Key Discoveries

- `src/lib/db.ts:62` — `Database` type covers all five tables; new query modules import `db` from here.
- `src/app/page.tsx:11–13` — auth guard pattern: `auth()` → redirect if no session; `getUserIdByEmail(session.user.email)` to get userId.
- `src/app/actions/confirm-review.ts` — server action pattern to follow for notes/tags actions.
- `src/app/review/[id]/review-form.tsx` — `useActionState` pattern for client-side form state; reuse this in tag picker and note modal.
- `src/lib/db/migrations/0002_library_schema.mts:50` — `UNIQUE(user_id, name)` on `tags` enables upsert-or-fetch when adding a tag by name.
- `radix-ui` v1.x is the aggregated Radix package — primitives are imported as `radix-ui/react-dialog`, `radix-ui/react-popover`, etc.
- No test framework is configured; automated verification is TypeScript compilation + ESLint only.

## Desired End State

A signed-in user lands on the homepage and sees their full library in a grid or list (toggleable). They can type in a search box to filter by title/author, and click tags to narrow results — all without a page reload. Clicking a book opens `/books/[id]` showing its cover, metadata, tags, and notes. From the book page they can add/remove tags and create, edit (via Tiptap modal), and delete notes. Navigating to `/tags` shows a list of all tags where any tag name can be renamed globally. When the library is empty, a prominent drop target guides the first import.

### Key Discoveries

- Cover images must be served from a `GET /api/books/[id]/cover` route — embedding base64 data URLs in the page payload would exceed acceptable payload size at library scale.
- Client-side filtering satisfies the 200ms NFR easily — all confirmed book rows (without cover bytes) are small; 1000 books ≈ ~150KB of JSON before gzip.
- `tiptap-markdown` community extension enables Markdown import/export from Tiptap editor, keeping the `notes.body` column as plain Markdown text.

## What We're NOT Doing

- Trash/restore workflow (FR-006, FR-007) — deferred to a dedicated change.
- Global tag delete — only rename is in scope here.
- Pagination or virtual scroll — not needed at expected library scale.
- Kobo sync, epub reading, full-text book search — PRD non-goals for MVP.

## Implementation Approach

Five sequential phases: data layer first (all DB queries and server actions), then the cover route (needed by all UI), then the library page (depends on data layer + cover route), then the book detail page (depends on all prior phases), then the tags settings page (depends on the tags data layer).

## Critical Implementation Details

- **userId scoping**: every DB query must filter by `user_id`. Notes are owned by books; verify ownership by joining `notes → books → user_id`. Never trust the client to pass userId — always read it from `session.user.email → getUserIdByEmail`.
- **Cover payload**: `listConfirmedBooks` must NOT select `cover_bytes` — use a boolean `has_cover` expression (`cover_bytes IS NOT NULL`) so cover bytes stay out of the page payload.
- **Tag add atomicity**: adding a tag by name requires upsert-or-fetch in the `tags` table (use `onConflict('user_id', 'name').doUpdateSet(...)` or `doNothing()` then re-select) followed by upsert into `book_tags`. Wrap in a transaction.
- **Tiptap Markdown round-trip**: store notes as Markdown text. The Tiptap editor reads initial content as Markdown via the `tiptap-markdown` extension and exports Markdown on save. The read view can use Tiptap in read-only mode pointing at the same content.

---

## Phase 1: Data Layer

### Overview

Create all DB query modules and server actions needed by the UI phases. No UI changes in this phase.

### Changes Required

#### 1. Books query module

**File**: `src/lib/books.ts`

**Intent**: Expose two read functions: one that lists all confirmed, non-trashed books for a user (with a boolean cover flag and their tags), and one that fetches a single confirmed book by id (with full cover bytes, tags, and notes).

**Contract**:
```typescript
// Return type for library listing
export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  hasCover: boolean;
  createdAt: Date;
  tags: Array<{ id: string; name: string }>;
}

// Return type for book detail
export interface BookDetail extends BookSummary {
  isbn: string | null;
  coverMime: string | null;
}

export async function listConfirmedBooks(userId: string): Promise<BookSummary[]>
export async function getConfirmedBook(bookId: string, userId: string): Promise<BookDetail | null>
```

For `listConfirmedBooks`: select from `books` where `user_id = userId`, `review_state = 'confirmed'`, `trashed_at IS NULL`, ordered by `created_at DESC`. Use `sql<boolean>` expression for `has_cover`. Join `book_tags` and `tags` and aggregate tags per book — either two separate queries merged in JS, or a single query with `jsonb_agg`.

For `getConfirmedBook`: same where clause plus `id = bookId`. Return `null` if not found.

#### 2. Tags query module

**File**: `src/lib/tags.ts`

**Intent**: Expose all tag operations: listing tags for the user (library filter), listing tags on a specific book, adding a tag to a book (by name, creating the tag if absent), removing a tag from a book, and renaming a tag globally.

**Contract**:
```typescript
export interface Tag { id: string; name: string }

export async function listUserTags(userId: string): Promise<Tag[]>
export async function listBookTags(bookId: string, userId: string): Promise<Tag[]>
export async function addTagToBook(userId: string, bookId: string, tagName: string): Promise<Tag>
export async function removeTagFromBook(userId: string, bookId: string, tagId: string): Promise<void>
export async function renameTag(userId: string, tagId: string, newName: string): Promise<void>
```

`addTagToBook` must run in a transaction: upsert into `tags` on conflict `(user_id, name) DO NOTHING`, then re-select to get the id, then upsert into `book_tags` on conflict `(book_id, tag_id) DO NOTHING`.

`removeTagFromBook` and `renameTag` must scope by `userId` (join through `tags.user_id = userId`) to prevent cross-user mutations.

#### 3. Notes query module

**File**: `src/lib/notes.ts`

**Intent**: Expose CRUD for notes. All mutations verify the note belongs to a book owned by the requesting user.

**Contract**:
```typescript
export interface Note {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listBookNotes(bookId: string, userId: string): Promise<Note[]>
export async function createNote(bookId: string, userId: string, body: string): Promise<Note>
export async function updateNote(noteId: string, userId: string, body: string): Promise<Note>
export async function deleteNote(noteId: string, userId: string): Promise<void>
```

For `listBookNotes`: join `notes → books` to verify `books.user_id = userId`, order by `created_at ASC`.

For `updateNote` and `deleteNote`: join `notes → books` to verify ownership. If no row is found, throw (the action layer translates this to a user-visible error).

#### 4. Notes server actions

**File**: `src/app/actions/notes.ts`

**Intent**: Server actions wrapping the notes query module. Each action reads the session, resolves userId, and calls the appropriate function. Follow the `confirmReviewAction` / `useActionState` pattern.

**Contract**: Export `createNoteAction`, `updateNoteAction`, `deleteNoteAction`. Each accepts `FormData`. `createNoteAction` and `updateNoteAction` take `bookId` (or `noteId`) and `body` fields. All return a typed state object `{ ok: boolean; message?: string }`.

#### 5. Tags server actions

**File**: `src/app/actions/tags.ts`

**Intent**: Server actions for adding a tag to a book, removing a tag from a book, and renaming a tag globally.

**Contract**: Export `addTagAction(formData)`, `removeTagAction(formData)`, `renameTagAction(formData)`. Same session + userId pattern. `addTagAction` takes `bookId` + `tagName`; returns `{ ok: boolean; tag?: { id, name }; message?: string }`. `removeTagAction` takes `bookId` + `tagId`. `renameTagAction` takes `tagId` + `newName`.

### Success Criteria

#### Automated Verification

- TypeScript compiles with no errors: `npm run build`
- No lint errors: `npm run lint`

#### Manual Verification

- Confirm `listConfirmedBooks` returns only confirmed, non-trashed books (verify with a psql query or test import)
- Confirm `addTagToBook` is idempotent — calling it twice with the same name doesn't create duplicate tags
- Confirm cross-user isolation: `getConfirmedBook(bookId, wrongUserId)` returns null

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Cover Image API Route

### Overview

Add a route that streams a book's cover image from the database. Used by all `<img>` tags in the library and book views.

### Changes Required

#### 1. Cover route handler

**File**: `src/app/api/books/[id]/cover/route.ts`

**Intent**: A `GET` handler that reads `cover_bytes` and `cover_mime` from the `books` table for the authenticated user and streams the image with the correct `Content-Type`. Returns 401 if not authenticated, 404 if the book is not found or has no cover.

**Contract**:
```typescript
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response>
```

Auth: call `auth()`, redirect-or-return-401 if no session. Fetch `cover_bytes` and `cover_mime` from `books` where `id = params.id AND user_id = userId`. If null or no cover_bytes, return `new Response(null, { status: 404 })`. Otherwise return `new Response(cover_bytes, { headers: { 'Content-Type': cover_mime, 'Cache-Control': 'private, max-age=3600' } })`.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- No lint errors: `npm run lint`

#### Manual Verification

- Navigate to `/api/books/<id>/cover` for a book with a cover — image renders in the browser
- Navigate with an invalid id or unauthenticated — returns 404/401 respectively

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Library Page

### Overview

Transform the homepage into a full library view. The page server-component fetches all books and user tags; a client component handles search, tag filter, and grid/list toggle. Import is a hero block when the library is empty and a compact header button otherwise.

### Changes Required

#### 1. Install Tiptap dependencies

**File**: `package.json`

**Intent**: Add the packages needed for the Tiptap editor (used in Phase 4). Installing here so Phase 4 doesn't require a separate install step.

**Contract**: Add to `dependencies`:
```json
"@tiptap/react": "^2",
"@tiptap/pm": "^2",
"@tiptap/starter-kit": "^2",
"tiptap-markdown": "^0.8"
```

Run `npm install` after editing.

#### 2. Cover placeholder component

**File**: `src/app/components/cover-placeholder.tsx`

**Intent**: A client-compatible component that renders a colored rectangle with the book's initials. The hue is derived deterministically from the title string using a simple hash, producing a consistent, distinguishable color per book.

**Contract**:
```typescript
export function CoverPlaceholder({
  title,
  className,
}: {
  title: string;
  className?: string;
}): React.JSX.Element
```

Hash function: iterate characters of `title`, accumulate `hash = (hash * 31 + charCode) | 0`, take `Math.abs(hash) % 360` as the HSL hue. Background: `hsl(${hue}, 55%, 65%)`. Initials: first letter of each word in title, up to 2 letters, uppercase.

#### 3. Book card component

**File**: `src/app/components/book-card.tsx`

**Intent**: Renders a single book in either grid or list layout. Accepts a `BookSummary` and a `variant` prop. In grid mode: cover image (or placeholder) on top, title + author below. In list mode: small cover thumbnail on the left, title + author + tags inline.

**Contract**:
```typescript
import type { BookSummary } from "@/lib/books";

export function BookCard({
  book,
  variant,
}: {
  book: BookSummary;
  variant: "grid" | "list";
}): React.JSX.Element
```

Cover image: `<img src={/api/books/${book.id}/cover} ...>` when `book.hasCover`, else `<CoverPlaceholder title={book.title} ...>`. The card is a `<Link href={/books/${book.id}}>` wrapper. No `"use client"` directive needed — this is a pure presentational component with no state.

#### 4. Library view client component

**File**: `src/app/components/library-view.tsx`

**Intent**: Receives all books and user tags as props; owns client-side search, tag-filter, and grid/list toggle state. Renders a search input, tag chips (click to toggle filter), a view toggle button, and the filtered book grid or list.

**Contract**:
```typescript
"use client";
import type { BookSummary } from "@/lib/books";
import type { Tag } from "@/lib/tags";

export function LibraryView({
  books,
  tags,
}: {
  books: BookSummary[];
  tags: Tag[];
}): React.JSX.Element
```

State: `searchQuery: string`, `activeTags: Set<string>` (tag ids), `view: "grid" | "list"`. Filtering logic: book matches if its title or author contains the search query (case-insensitive) AND it carries all active tags. No debounce needed for client-side filtering.

#### 5. Homepage transformation

**File**: `src/app/page.tsx`

**Intent**: Transform from the stub into the library server component. Fetch confirmed books and user tags, pass them to `LibraryView`. Show an import hero (existing `ImportDropzone`) when books is empty; show a compact import button in the page header when books exist.

**Contract**: Server component. Auth guard unchanged. Add `listConfirmedBooks(userId)` and `listUserTags(userId)` calls in parallel (`Promise.all`). Render a two-section layout: a header with the app name, user email, sign-out, and (when books.length > 0) an import button; and a main area with either the `ImportDropzone` hero (empty state) or `<LibraryView books={books} tags={tags} />`.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- No lint errors: `npm run lint`

#### Manual Verification

- Library with books: grid and list toggle work; search filters correctly; tag chips filter correctly
- Library empty: hero drop target visible; no grid renders
- Library with books: import button in header is accessible
- Cover placeholder renders for books without covers, with distinct colors per title
- Clicking a book card navigates to `/books/[id]` (page may 404 until Phase 4)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 4: Book Detail Page

### Overview

Add the `/books/[id]` route. A server component fetches the book with its tags and notes. Client sub-components handle the tag picker and a Tiptap-powered note editor in a Radix Dialog modal.

### Changes Required

#### 1. Tiptap note editor component

**File**: `src/app/books/[id]/note-editor.tsx`

**Intent**: A `"use client"` component wrapping a Tiptap editor pre-loaded with a Markdown document. On mount it initialises Tiptap with `StarterKit` and the `tiptap-markdown` extension. Exposes a `getValue()` method (via `useImperativeHandle`) or a controlled `onChange` callback so the parent can read the current Markdown on save.

**Contract**:
```typescript
"use client";
import type { Editor } from "@tiptap/react";

export interface NoteEditorHandle {
  getMarkdown(): string;
}

export const NoteEditor = React.forwardRef<
  NoteEditorHandle,
  { initialContent: string; placeholder?: string }
>(function NoteEditor({ initialContent, placeholder }, ref): React.JSX.Element
```

Use `useEditor` from `@tiptap/react` with extensions `[StarterKit, Markdown]` (`Markdown` from `tiptap-markdown`). Set `content` as Markdown string (the `tiptap-markdown` extension accepts a Markdown string as initial content). Expose `getMarkdown()` via ref using `editor.storage.markdown.getMarkdown()`.

#### 2. Notes section client component

**File**: `src/app/books/[id]/notes-section.tsx`

**Intent**: Renders the list of existing notes (each as rendered Markdown + edit/delete actions) and a "New note" button. Edit and create both open a Radix Dialog containing the `NoteEditor`. On dialog confirm, calls the appropriate server action.

**Contract**:
```typescript
"use client";
import type { Note } from "@/lib/notes";

export function NotesSection({
  bookId,
  initialNotes,
}: {
  bookId: string;
  initialNotes: Note[];
}): React.JSX.Element
```

State: `notes: Note[]` (initially `initialNotes`; updated optimistically or via router.refresh after action), `editingNote: Note | null`, `isCreating: boolean`. Modal is a Radix `Dialog.Root` controlled by `editingNote !== null || isCreating`. On save: call `createNoteAction` or `updateNoteAction` via `startTransition`; close dialog; call `router.refresh()` to re-fetch from server. On delete: call `deleteNoteAction`; update local state optimistically.

Notes in read mode: render Markdown using Tiptap in read-only mode (`editable: false`) with the same extensions, or use `dangerouslySetInnerHTML` with a Markdown-to-HTML conversion using `tiptap-markdown`'s parser — whichever is simpler to wire. The implementer picks the approach that avoids duplicating the Markdown parsing logic.

#### 3. Tag picker client component

**File**: `src/app/books/[id]/tag-picker.tsx`

**Intent**: Shows current book tags (each with a remove ✕ button) and a text input to add a new tag. Typing a tag name and pressing Enter (or clicking Add) calls `addTagAction`. Clicking ✕ on a tag calls `removeTagAction`. Shows existing user tags as autocomplete suggestions.

**Contract**:
```typescript
"use client";
import type { Tag } from "@/lib/tags";

export function TagPicker({
  bookId,
  initialBookTags,
  allUserTags,
}: {
  bookId: string;
  initialBookTags: Tag[];
  allUserTags: Tag[];
}): React.JSX.Element
```

State: `bookTags: Tag[]`, `input: string`. Suggestions: filter `allUserTags` by input, exclude tags already on book. Use `router.refresh()` after mutations to re-sync server state.

#### 4. Book detail page

**File**: `src/app/books/[id]/page.tsx`

**Intent**: Server component that fetches the full book (with cover flag), its tags, and its notes. Renders: back link to `/`, cover image or placeholder, metadata (title, author, isbn), `TagPicker`, and `NotesSection`. Returns `notFound()` if the book doesn't exist or doesn't belong to the session user.

**Contract**: Server component. Accepts `{ params: Promise<{ id: string }> }`. Auth guard: `auth()` → redirect `/signin` if no session. Fetch `getConfirmedBook`, `listBookTags`, `listBookNotes` in parallel. `notFound()` if book is null.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- No lint errors: `npm run lint`

#### Manual Verification

- Book detail page loads: cover, title, author, isbn visible
- Tag picker: adding a tag by new name creates it and shows it; adding an existing tag name reuses it; remove ✕ works
- Notes: creating a note via the modal shows it in the list; edit opens the modal pre-populated; delete removes it
- Tiptap editor renders Markdown correctly (bold, italic, lists)
- Navigating to `/books/<unknown-id>` returns 404
- Navigating to `/books/<other-users-book-id>` returns 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 5: Tags Settings Page

### Overview

Add `/tags` — a settings page listing all the user's tags with inline rename controls.

### Changes Required

#### 1. Tags manager client component

**File**: `src/app/tags/tags-manager.tsx`

**Intent**: Lists all user tags. Each row shows the tag name, the number of books carrying it, and a rename button. Clicking rename replaces the name with an inline text input + save/cancel. On save, calls `renameTagAction`. After success, `router.refresh()`.

**Contract**:
```typescript
"use client";
import type { Tag } from "@/lib/tags";

export function TagsManager({
  initialTags,
}: {
  initialTags: Array<Tag & { bookCount: number }>;
}): React.JSX.Element
```

State per row: `editingId: string | null`, `editValue: string`. Validation: new name must be non-empty and differ from the current name. Error from action displayed inline below the input.

#### 2. Tags settings page

**File**: `src/app/tags/page.tsx`

**Intent**: Server component that fetches all user tags with their book counts (via a join to `book_tags`) and renders `TagsManager`. Add a nav link back to the library (`/`). Add a nav link to this page from the library header (e.g., a "Tags" link or gear icon).

**Contract**: Server component. Auth guard. Fetch: `listUserTags` augmented with a book count — either add a `listUserTagsWithCount(userId)` variant in `src/lib/tags.ts` returning `Array<Tag & { bookCount: number }>`, or inline the query in the page. Add the `/tags` link to the library header in `src/app/page.tsx`.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- No lint errors: `npm run lint`

#### Manual Verification

- `/tags` lists all tags with their book counts
- Renaming a tag updates it in the tags page and on all affected book detail pages (verify by navigating to a book)
- Attempting to rename a tag to an existing tag name shows an error (DB unique constraint violation surfaced as a user-visible message)
- Navigation: library header → tags page → back to library works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Testing Strategy

### Automated

- Each phase gates on `npm run build` (TypeScript) and `npm run lint` (ESLint) — no test framework is configured.

### Manual Testing Steps

1. Import a book with a cover, confirm it, verify it appears in the library grid and list
2. Import a book without a cover, verify the color placeholder is distinct from other books
3. Search by title and author — verify filtering narrows correctly
4. Add a tag to a book, verify it appears in the library filter chips
5. Filter by tag in library — only tagged books appear
6. Open a book, add two tags (one new, one existing), remove one — verify state is correct
7. Create a note with Markdown (bold, list, link), save, verify rendered output matches
8. Edit the note, verify editor is pre-populated with the original Markdown
9. Delete a note, verify it's removed from the list
10. Navigate to `/tags`, rename a tag, navigate back to the book — verify the new name shows

## Performance Considerations

`listConfirmedBooks` must exclude `cover_bytes` from its select list. At 1000 books, book rows without cover bytes are approximately 200–400 bytes each ≈ ~300KB uncompressed, well within the 2-second page load NFR over a typical connection.

The cover API route returns `Cache-Control: private, max-age=3600` — browsers cache cover images for one hour, avoiding repeated DB reads on re-visit.

## Migration Notes

No new migrations required — all tables were created in migrations `0002` and `0003`.

## References

- Library data schema: `context/changes/library-data-schema/`
- Book drafts + review flow: `context/changes/ai-metadata-enrichment-gate/`
- DB type definitions: `src/lib/db.ts`
- Existing server action pattern: `src/app/actions/confirm-review.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data Layer

#### Automated

- [x] 1.1 TypeScript compiles with no errors: `npm run build` — 44cc7f1
- [x] 1.2 No lint errors: `npm run lint` — 44cc7f1

#### Manual

- [ ] 1.3 `listConfirmedBooks` returns only confirmed, non-trashed books
- [ ] 1.4 `addTagToBook` is idempotent — no duplicate tags on repeated calls
- [ ] 1.5 `getConfirmedBook(bookId, wrongUserId)` returns null

### Phase 2: Cover Image API Route

#### Automated

- [x] 2.1 TypeScript compiles: `npm run build` — 0565b62
- [x] 2.2 No lint errors: `npm run lint` — 0565b62

#### Manual

- [ ] 2.3 `/api/books/<id>/cover` renders the cover image for a book that has one
- [ ] 2.4 Invalid id or unauthenticated request returns 404/401

### Phase 3: Library Page

#### Automated

- [x] 3.1 TypeScript compiles: `npm run build` — a3b076c
- [x] 3.2 No lint errors: `npm run lint` — a3b076c

#### Manual

- [ ] 3.3 Grid and list toggle work; search and tag filter narrow results correctly
- [ ] 3.4 Empty state: hero drop target visible, no grid renders
- [ ] 3.5 Import button visible in header when books exist
- [ ] 3.6 Cover placeholder renders with distinct color per title

### Phase 4: Book Detail Page

#### Automated

- [x] 4.1 TypeScript compiles: `npm run build` — e99e939
- [x] 4.2 No lint errors: `npm run lint` — e99e939

#### Manual

- [x] 4.3 Book detail shows cover, title, author, isbn — e99e939
- [x] 4.4 Tag picker: add new tag, add existing tag, remove tag — all correct — e99e939
- [x] 4.5 Notes: create via modal, edit pre-populated, delete — all correct — e99e939
- [x] 4.6 Tiptap renders Markdown (bold, italic, lists) correctly — e99e939
- [x] 4.7 Unknown or unauthorized book id returns 404 — e99e939

### Phase 5: Tags Settings Page

#### Automated

- [x] 5.1 TypeScript compiles: `npm run build`
- [x] 5.2 No lint errors: `npm run lint`

#### Manual

- [ ] 5.3 `/tags` lists all tags with book counts
- [ ] 5.4 Renaming a tag reflects on affected book pages
- [ ] 5.5 Duplicate tag name on rename shows an error message
- [ ] 5.6 Navigation: library → tags → library works
