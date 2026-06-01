# Library and Book View — Plan Brief

> Full plan: `context/changes/library-and-book-view/plan.md`

## What & Why

Build the primary reading experience that the import flow currently has nowhere to land. Users can import books but have no way to browse, find, or annotate them. This change adds a library grid/list, a book detail page with notes and tags, and a tag management page — turning the app from an importer into a usable library.

## Starting Point

The homepage today is a centered card with an import dropzone and a Drive button. The full database schema (`books`, `tags`, `book_tags`, `notes`) is in place and populated by the import flow. No query functions, no library UI, and no API route to serve cover images exist yet.

## Desired End State

A signed-in user sees their full library on the homepage — browsable as a grid or list, filterable by tag chips, searchable by title/author. Clicking a book opens `/books/[id]` showing metadata, an inline tag picker, and notes rendered from Markdown. Notes are created and edited in a Tiptap modal. A `/tags` page lets the user rename tags globally. When the library is empty, a prominent drop target guides the first import.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Library layout | Switchable grid / list | User requested both views | Plan |
| Import placement | Hero when empty, header button when non-empty | Optimal for first-run vs daily-use without wasting space | Plan |
| Search / filter | Client-side, all books loaded upfront | Zero latency; satisfies 200ms NFR trivially; list data is small without cover bytes | Plan |
| Tag management on book | Inline tag picker in book view | Matches the "same session" user story in the PRD | Plan |
| Book detail routing | `/books/[id]` | Clean, predictable URL matching the DB resource name | Plan |
| Notes UX | Modal editor | User preference | Plan |
| Note editor | Tiptap + `tiptap-markdown` | User specified Tiptap; `tiptap-markdown` enables Markdown import/export while keeping `notes.body` as plain Markdown text | Plan |
| Cover serving | `GET /api/books/[id]/cover` | Embedding base64 in HTML would push 50-book payload to ~6.5MB | Plan |
| Cover fallback | HSL color hash + initials | Every card looks finished; distinguishable without external dependency | Plan |
| Trash/restore | Deferred | Adds Drive file-move async risk; import cancellation already covers the escape hatch | Plan |
| Tag rename location | Dedicated `/tags` settings page | User preference; global rename belongs in a global-management surface | Plan |
| Tag rename scope | Rename only (no delete) | Keeps scope tight; delete is rare and can follow in a future change | Plan |
| Pagination | None — load all books | Client-side filter requires full data; 1000 books ≈ 300KB without cover bytes | Plan |

## Scope

**In scope:**
- Library page: grid/list toggle, search, tag filter, empty-state hero
- Cover image API route (`GET /api/books/[id]/cover`)
- Cover color-hash placeholder for books without covers
- Book detail page: metadata, tags (add/remove inline), notes (create/edit/delete via Tiptap modal)
- `/tags` settings page: list all tags with rename UI
- Navigation links between library, book, and tags pages

**Out of scope:**
- Trash / restore workflow (FR-006, FR-007)
- Global tag delete
- Pagination or virtual scroll
- Kobo sync, epub reading, full-text book search

## Architecture / Approach

New data-layer modules (`src/lib/books.ts`, `src/lib/tags.ts`, `src/lib/notes.ts`) expose typed query functions. Server actions (`src/app/actions/notes.ts`, `src/app/actions/tags.ts`) wrap mutations. Cover images flow through a Next.js API route. The homepage transforms from a stub to a server component that fetches all books + tags, then hands off to a `LibraryView` client component for interactive filtering. The book detail page is a server component with two client sub-components: `TagPicker` and `NotesSection` (which hosts the Tiptap modal). The tags settings page is a server component + `TagsManager` client component.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Data layer | Query functions + server actions for books, tags, notes | Cross-user isolation must be enforced in every query |
| 2. Cover API route | `GET /api/books/[id]/cover` streams bytea cover | Must return 401/404 correctly; no cover bytes in listing queries |
| 3. Library page | Switchable grid/list, search, tag filter, empty-state hero | `cover_bytes` accidentally included in listing payload would break the 2s NFR |
| 4. Book detail page | Metadata, Tiptap note modal, inline tag picker | Tiptap + `tiptap-markdown` Markdown round-trip must preserve note content |
| 5. Tags settings page | Global tag rename with book counts | Unique constraint on `(user_id, name)` must surface as a user-visible error |

**Prerequisites:** Import + metadata enrichment flow complete (books land in DB with `review_state = 'confirmed'`). Tiptap deps installed in Phase 3 step 1.  
**Estimated effort:** ~3–4 sessions across 5 phases.

## Open Risks & Assumptions

- `tiptap-markdown` community package version compatibility with `@tiptap/react` v2 — verify before writing the editor component.
- The Radix `Dialog` primitive is imported from the aggregated `radix-ui` package; confirm the correct import path (`radix-ui/react-dialog`) before wiring the modal.
- Notes rendered in read mode via Tiptap read-only mode adds React re-mount cost per note — if there are many long notes this may be perceptible; a lightweight alternative (Marked.js, remark) can replace read-mode rendering without affecting the edit path.

## Success Criteria (Summary)

- A user can import a book, return to the homepage, see it in the library, click it, add a tag, and write a Markdown note — all without leaving or refreshing the app manually.
- Search and tag filter update visibly within 200ms of user input.
- Renaming a tag on `/tags` is immediately reflected on the affected book's detail page.
