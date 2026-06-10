# Epub vs DB Metadata Comparison on Book Detail Page

## Overview

Add a two-column metadata comparison grid to `/books/[id]` that shows current DB values alongside the original epub-embedded values. The epub values are fetched on-demand by re-downloading and re-parsing the epub from Google Drive client-side, so the page loads instantly and the epub column fills in asynchronously.

## Current State Analysis

The book detail page (`src/app/(app)/books/[id]/page.tsx:77–96`) renders a simple `<dl>` with 5 fields (ISBN, Publisher, Language, Published, Description). Title and author appear above it. All values come from the DB.

The epub-embedded metadata is NOT stored after a book is confirmed. `createDraft()` writes epub values to the `books` table, but `confirmDraft()` overwrites title/author/isbn/cover with the user's review-form choices and deletes the `book_drafts` row. `publisher`, `language`, `published_date`, and `description` survive unmodified unless enrichment is later applied via `updateBookMetadata()`.

The Google Drive epub is accessible via the book's `drive_file_id`. The download pattern in `src/app/api/books/[id]/download/route.ts` uses `getDriveClient()` + `drive.files.get()`.

### Key Discoveries

- `parseEpub()` at `src/lib/epub/parse.ts:26` extracts 7 text fields: title, author, isbn, publisher, language, publishedDate, description (plus cover bytes — excluded from comparison)
- Drive download for content requires `alt: 'media'` + `responseType: 'arraybuffer'`; the existing `/download` route uses a redirect to `webContentLink` instead — our route is the first to stream bytes back directly
- JSZip (used by `parseEpub`) requires the Node.js runtime; `export const runtime = "nodejs"` is mandatory on the new API route
- `src/lib/drive/errors.ts` exports `DriveAuthError`; pattern in download route is: catch it → redirect to `/signin`
- The existing `EnrichMetadataPanel` and `SuggestionsPanel` show the client-component fetch-on-mount pattern to follow

## Desired End State

On the `/books/[id]` page, the metadata section shows a 3-column grid:

| Field     | In library     | From epub      |
| --------- | -------------- | -------------- |
| Title     | Pride and Prej | Pride and Prej |
| Author    | Jane Austen    | Jane Austen    |
| ISBN      | —              | —              |
| Publisher | —              | Gutenberg      |
| ...       | ...            | ...            |

- "In library" column: current DB values, available on first paint
- "From epub" column: skeleton while loading, fills in after Drive re-parse (~1–3 s)
- When Drive re-parse fails or `drive_file_id` is null: epub cells show "—" with an italic note beneath the table
- Values that differ between columns are visually distinguished (e.g., amber background)

Verify: open any book detail page, confirm the epub column skeleton appears then resolves. Open a book without a `drive_file_id` (edge case), confirm "—" + note renders correctly.

## What We're NOT Doing

- No DB migration — epub metadata is not persisted between page loads
- No cover comparison — binary data; excluded from the text-field grid
- No caching of epub parse results — each page visit re-fetches from Drive (acceptable given infrequent access)
- No inline editing of metadata from this component

## Implementation Approach

Three targeted additions: a new API route that does the Drive download + epub parse, a new client component that fetches it and renders the comparison grid, and a minimal change to `page.tsx` to swap the `<dl>` for the new component.

## Critical Implementation Details

- **Node.js runtime required**: `parseEpub` uses `JSZip.loadAsync` which requires Node. Add `export const runtime = "nodejs"` as the first line of the new route — without it, Next.js defaults to the Edge runtime and the import will fail at build time.
- **Drive bytes download**: use `drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })`. The response `.data` is `ArrayBuffer`; wrap with `Buffer.from(res.data as ArrayBuffer)` before passing to `parseEpub`.

---

## Phase 1: API route — GET /api/books/[id]/epub-metadata

### Overview

New route that looks up the book's `drive_file_id`, downloads the epub bytes from Drive, re-parses with `parseEpub()`, and returns the 7 text fields as JSON.

### Changes Required

#### 1. New API route

**File**: `src/app/api/books/[id]/epub-metadata/route.ts`

**Intent**: Authenticate the user, verify they own the book, download the epub bytes from Drive, parse with `parseEpub()`, and return the 7 text fields as JSON. Return `{ available: false, reason }` for the error states instead of HTTP errors, so the client can render graceful placeholders without treating it as a fetch failure.

**Contract**: GET handler following the same auth + ownership pattern as `src/app/api/books/[id]/download/route.ts`. Response shape:

```typescript
// success
{
  available: true;
  title: string | null;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  language: string | null;
  publishedDate: string | null;
  description: string | null;
}

// failure — client renders "—" with a note
{
  available: false;
  reason: "no_drive_file" | "drive_error" | "parse_error";
}
```

HTTP 401 for unauthenticated, 404 for unknown/unowned book. Drive or parse errors return 200 with `available: false` and the matching reason string so the client can distinguish "not uploaded yet" from "Drive down."

### Success Criteria

#### Automated Verification

- TypeScript compiles without errors: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- `GET /api/books/<valid-id>/epub-metadata` while signed in returns `{ available: true, ... }` with the 7 fields populated (null for missing)
- `GET /api/books/<valid-id>/epub-metadata` for a book the user doesn't own returns 404
- Unauthenticated request returns 401

**Implementation Note**: Pause after this phase and confirm the API route returns correct data for at least one real book before building the UI on top of it.

---

## Phase 2: EpubMetadataComparison client component

### Overview

New client component that accepts the current DB metadata as props, fetches epub metadata from the Phase 1 route, and renders the 3-column comparison grid with a skeleton loading state.

### Changes Required

#### 1. New client component

**File**: `src/app/(app)/books/[id]/epub-metadata-comparison.tsx`

**Intent**: Render a 3-column metadata grid. On mount, fetch `/api/books/${bookId}/epub-metadata`. While loading, show skeleton rows in the epub column. After fetch, fill in epub values (or "—" if `available: false`). Highlight cells where DB value and epub value differ.

**Contract**:

```typescript
interface Props {
  bookId: string;
  db: {
    title: string;
    author: string | null;
    isbn: string | null;
    publisher: string | null;
    language: string | null;
    publishedDate: string | null;
    description: string | null;
  };
}
```

Column headers: `"In library"` (left) and `"From epub"` (right). Row order: Title, Author, ISBN, Publisher, Language, Published, Description. A cell with a differing value gets a subtle amber/yellow background (`bg-amber-50 text-amber-900`). When `available: false`, show all epub cells as "—" and render a small italic note below the grid: `"Epub metadata unavailable (reason)"`. Empty values render as `—` (not `<empty>`).

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- Epub column shows skeleton rows on initial render, then fills in after ~1-3 s
- Cells that differ between DB and epub show amber highlight
- When Drive is unavailable or `drive_file_id` is null, epub cells show "—" and the note renders below

**Implementation Note**: Can be tested by temporarily mounting the component in isolation or by completing Phase 3 and observing in the browser.

---

## Phase 3: Wire into book detail page

### Overview

Replace the existing `<dl>` metadata block in `page.tsx` with the new `EpubMetadataComparison` component.

### Changes Required

#### 1. Swap `<dl>` for component

**File**: `src/app/(app)/books/[id]/page.tsx`

**Intent**: Remove the `<dl>` grid at lines 77–96 and replace it with `<EpubMetadataComparison bookId={book.id} db={{ title: book.title, author: book.author, isbn: book.isbn, publisher: book.publisher, language: book.language, publishedDate: book.publishedDate, description: book.description }} />`.

**Contract**: Import `EpubMetadataComparison` from `./epub-metadata-comparison`. Pass all 7 fields from the already-loaded `book` object. No new data fetching needed in `page.tsx`.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npm run build`
- Lint passes: `npm run lint`
- E2e harness stays green: `npm run test:e2e`

#### Manual Verification

- Opening `/books/<id>` shows DB column immediately and epub column skeleton, which resolves within ~3 s
- The page layout matches the screenshot mock: cover + title/author area unchanged, comparison grid below Download button
- Trashed books render correctly (epub comparison visible even for trashed books)
- No console errors on load

---

## Testing Strategy

### Manual Testing Steps

1. Open a confirmed book detail page; observe the epub column skeleton then resolve
2. Check a book that was enriched after import — publisher/language/description may differ between columns
3. Check a book where the user edited the title/author during review — title/author rows should show amber highlight
4. (If available) open a book with a missing `drive_file_id` — epub cells show "—" + note

## References

- Book detail page: `src/app/(app)/books/[id]/page.tsx`
- Epub parser: `src/lib/epub/parse.ts`
- Drive client: `src/lib/drive/client.ts`
- Download route (auth + Drive pattern): `src/app/api/books/[id]/download/route.ts`
- Client-component fetch pattern: `src/app/(app)/books/[id]/enrich-metadata-panel.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API route — GET /api/books/[id]/epub-metadata

#### Automated

- [x] 1.1 TypeScript compiles without errors: `npm run build` — d5002f4
- [x] 1.2 Lint passes: `npm run lint` — d5002f4

#### Manual

- [ ] 1.3 `GET /api/books/<valid-id>/epub-metadata` returns `{ available: true, ... }` for owned book
- [ ] 1.4 Returns 404 for unowned book; 401 for unauthenticated request

### Phase 2: EpubMetadataComparison client component

#### Automated

- [x] 2.1 TypeScript compiles: `npm run build` — 59ad814
- [x] 2.2 Lint passes: `npm run lint` — 59ad814

#### Manual

- [ ] 2.3 Epub column shows skeleton then fills in
- [ ] 2.4 Differing values show amber highlight
- [ ] 2.5 Unavailable state renders "—" cells + note

### Phase 3: Wire into book detail page

#### Automated

- [x] 3.1 TypeScript compiles: `npm run build`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 E2e harness stays green: `npm run test:e2e`

#### Manual

- [ ] 3.4 Opening `/books/<id>` shows DB column immediately + epub skeleton resolving
- [ ] 3.5 Cover/title area unchanged; no console errors
- [ ] 3.6 Trashed books render correctly
