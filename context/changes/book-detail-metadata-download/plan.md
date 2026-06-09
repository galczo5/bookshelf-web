# Book Detail Metadata & Drive Download Implementation Plan

## Overview

Two user-facing additions to the single-book view (`/books/[id]`):

1. A **Details** card that lists every bibliographic metadata field — Title, Author, ISBN, Publisher, Language, Published date, Description — always rendered, with an `<empty>` placeholder when a field is null/blank. This requires capturing four new fields (publisher, language, published date, description) from the epub on import, since the schema currently stores only title/author/isbn/cover.
2. A **Download** button in the header actions that delivers the original epub from Google Drive to the user's local disk by redirecting the browser to a Drive download link.

## Current State Analysis

- The detail page (`src/app/(app)/books/[id]/page.tsx`) shows the cover, title, and **conditionally** author (`{book.author && …}`, line 67) and ISBN (`{book.isbn && …}`, line 68) — so empty fields disappear entirely. There is no metadata section.
- `BookDetail` (`src/lib/books.ts:14-19`) exposes `title`, `author`, `isbn`, `coverMime`, `hasCover`, `createdAt`, `updatedAt`, `trashedAt`, `tags`. The `books` table (`src/lib/db.ts:18-31`) has no publisher/language/date/description columns.
- The epub parser (`src/lib/epub/parse.ts`) extracts only `title`, `author`, `isbn`, `cover` (`EpubMetadata`, lines 5-10). The OPF `<metadata>` element it already reads (line 69) also carries `dc:publisher`, `dc:language`, `dc:date`, `dc:description` — parsed-but-discarded today.
- Import flow: `importEpubAction` (`src/app/actions/import-epub.ts`) → `createDraft` (`src/lib/book-drafts.ts:41`) inserts the `books` row at draft time → `confirmDraft` (`src/lib/book-drafts.ts:128`) updates only `title/author/isbn/cover/drive_file_id/review_state/updated_at` on confirm. **Columns it does not set are preserved**, so fields written at `createDraft` survive review untouched.
- `books.drive_file_id` (text, nullable) holds the Drive file handle for confirmed books; it is set on confirm (`confirmDraft`, line 137). The detail-page queries don't currently select it.
- The cover route (`src/app/api/books/[id]/cover/route.ts`) is the template for a per-book GET route: `auth()` → `getUserIdByEmail` → ownership-scoped query → `Response`. The Drive client is `getDriveClient()` (`src/lib/drive/client.ts:7`), which throws `DriveAuthError` when the session lacks a valid access token. No `files.get` download (`alt: media` or `webContentLink`) exists yet.
- Drive files for trashed books are **moved** to a Drive trash folder, not deleted (`src/lib/drive/trash.ts`), so `drive_file_id` stays valid and downloadable while a book is trashed.

## Desired End State

- Opening any confirmed book shows a **Details** card listing all seven bibliographic fields. Newly imported epubs populate Publisher/Language/Published date/Description where the file carries them; every field that is null/blank shows `<empty>`.
- A **Download** button in the header (active and trashed books alike) downloads the original epub from the user's Google Drive to their local disk.
- Verify: import a fresh epub that carries `dc:publisher`/`dc:language`/`dc:date`/`dc:description` → all show on the detail page; an epub missing them shows `<empty>` for those rows; clicking Download saves the `.epub` locally.

### Key Discoveries:

- `confirmDraft` (`src/lib/book-drafts.ts:128-157`) does not touch columns outside its `set({…})`, so new metadata columns set in `createDraft` survive confirmation with no change to the confirm path.
- The page already imports its book via `getOwnedBook` (`src/lib/books.ts:155`), which includes trashed books — so the Download button gets a valid `drive_file_id` for trashed books too.
- `published_date` should be stored as **text**, not a date column: `dc:date` is free-form (year-only, ISO datetime, or arbitrary string) and must not fail to parse.
- `dc:description` can contain inline HTML; extraction strips tags to plain text so the card renders clean copy and never injects markup.
- The XML parser (`parse.ts:16-20`) does not list `dc:publisher`/`dc:language`/`dc:date`/`dc:description` in its `isArray` set, so each arrives as a scalar/object handled by the existing `extractFirst` helper.

## What We're NOT Doing

- **No multi-valued fields** — `dc:subject` and `dc:contributor` are out of scope (would need array storage + join UI).
- **No backfill of existing books** — confirmed books deleted their staged epub bytes, so the 50 seed books and any prior imports will show `<empty>` for the new fields until re-imported. The seed script is not modified.
- **No enrichment of the new fields** — the AI "Enrich metadata" panel continues to handle only title/author/isbn/cover. New fields are populated from embedded epub metadata only.
- **No streaming of bytes through our server** — download is a redirect to a Drive link, not a proxied stream (cover route's pattern is the model only for auth/ownership, not for the response body).
- **No editing of the new metadata fields** in the UI — display only.
- **No changes to the review/confirm UI** — the new columns ride along silently through the existing draft→confirm path.

## Implementation Approach

Phase 1 is a single vertical slice for the metadata feature: add the columns, capture them on import, surface them on the page. Phase 2 adds the download route and button. The two phases are independent and can be verified separately.

The new columns are written once, at `createDraft`, and read back by the detail-page queries — no change to `confirmDraft` is required because it preserves untouched columns.

## Phase 1: All-metadata display

### Overview

Add four nullable metadata columns, extract them from the epub OPF on import, thread them through draft creation, and render a Details card on the book detail page with `<empty>` placeholders for blank fields.

### Changes Required:

#### 1. Migration — new metadata columns

**File**: `src/lib/db/migrations/0004_book_metadata_fields.mts` (new)

**Intent**: Add the four new bibliographic fields to the `books` table so new imports can persist them.

**Contract**: `up` adds nullable `text` columns `publisher`, `language`, `published_date`, `description` to `books`. `down` drops all four. Follow the `alterTable("books").addColumn(...)` style of `0003_book_drafts.mts`.

#### 2. Kysely table type

**File**: `src/lib/db.ts`

**Intent**: Reflect the new columns in `BooksTable` so queries are type-checked.

**Contract**: Add `publisher: string | null`, `language: string | null`, `published_date: string | null`, `description: string | null` to `BooksTable` (`src/lib/db.ts:18-31`).

#### 3. Epub metadata extraction

**File**: `src/lib/epub/parse.ts`

**Intent**: Extract publisher/language/published date/description from the OPF `<metadata>` and return them alongside the existing fields.

**Contract**: Extend `EpubMetadata` (lines 5-10) with `publisher`, `language`, `publishedDate`, `description` (all `string | null`). In `parseEpub`, read `dc:publisher`, `dc:language`, `dc:date` via the existing `extractFirst` helper; read `dc:description` and strip HTML tags to plain text. Return them in the result object (line 92).

#### 4. Import action passes new fields

**File**: `src/app/actions/import-epub.ts`

**Intent**: Forward the newly extracted fields into draft creation.

**Contract**: Extend the `embeddedMetadata` object passed to `createDraft` (lines 43-49) with `publisher`, `language`, `publishedDate`, `description` from `metadata`.

#### 5. Draft creation persists new fields

**File**: `src/lib/book-drafts.ts`

**Intent**: Store the new fields on the `books` row at draft time; they survive confirm untouched.

**Contract**: Extend `CreateDraftInput.embeddedMetadata` (lines 9-14) with the four new fields, and add them to the `insertInto("books").values({…})` call in `createDraft` (lines 45-54): `publisher`, `language`, `published_date`, `description`. No change to `confirmDraft`.

#### 6. Book detail query selects new fields

**File**: `src/lib/books.ts`

**Intent**: Expose the new fields on `BookDetail` so the page can render them.

**Contract**: Add `publisher`, `language`, `publishedDate`, `description` (all `string | null`) to `BookDetail` (lines 14-19). Add the four columns to the `.select([…])` in `getOwnedBook` (lines 158-168) and `getConfirmedBook` (lines 71-80), and map them into the returned object (camelCase) in both functions.

#### 7. Details card on the page

**File**: `src/app/(app)/books/[id]/page.tsx`

**Intent**: Render a Details card listing all bibliographic fields, each always shown, with `<empty>` for null/blank values.

**Contract**: Add a card (styled like the existing `rounded-xl border …` sections) listing label/value rows for Title, Author, ISBN, Publisher, Language, Published date, Description. A small helper renders the value or a muted `<empty>` placeholder when null/empty. Remove the now-redundant inline ISBN line (line 68); keep the header title/author as the visual identity. Show the card for both active and trashed books.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:migrate`
- Migration replay (up/down/up) passes: `npm run test:migrate-replay`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit/integration tests pass: `npm test`

#### Manual Verification:

- Importing an epub that carries `dc:publisher`/`dc:language`/`dc:date`/`dc:description` shows all four on the detail page after confirm.
- Importing an epub missing those fields shows `<empty>` for those rows (and for a missing author/ISBN).
- An existing seed book renders the new rows as `<empty>` without error.
- The Details card appears for a trashed book as well.
- Description with embedded HTML renders as clean plain text (no literal tags, no injected markup).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Drive download

### Overview

Add a route that redirects the browser to a Google Drive download link for the book's epub, and a Download button in the header actions available for active and trashed books.

### Changes Required:

#### 1. Download route

**File**: `src/app/api/books/[id]/download/route.ts` (new)

**Intent**: Resolve the book's Drive file and redirect the browser to a Drive download link, scoped to the authenticated owner.

**Contract**: `GET(_req, { params })` mirroring the cover route's auth/ownership preamble (`auth()` → 401 if no session email → `getUserIdByEmail` → query `books` for `drive_file_id` where `id` + `user_id`). Behavior:

- No row or null `drive_file_id` → `404`.
- `getDriveClient()` then `drive.files.get({ fileId, fields: "webContentLink" })`; redirect (`Response.redirect(webContentLink, 302)` / `NextResponse.redirect`) to the link.
- `DriveAuthError` (or missing `webContentLink`) → surface a clear failure (redirect to sign-in for auth error; `502`/error response when the link can't be obtained). Set `export const runtime = "nodejs"` as in the cover/nextauth routes.

#### 2. Download button

**File**: `src/app/(app)/books/[id]/page.tsx` (and a small control component if a client affordance is wanted, e.g. `src/app/(app)/books/[id]/download-book-control.tsx`)

**Intent**: Give the user a header action to download the epub.

**Contract**: An anchor/button pointing at `/api/books/${book.id}/download`, placed in the header actions next to the trash/restore control (lines 71-77), styled consistently. Rendered for both active and trashed books. A plain `<a>` is sufficient since the route returns a redirect; a client component is only needed if a loading/disabled state is desired.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Tests pass: `npm test`

#### Manual Verification:

- Clicking Download on a book with a Drive file saves the `.epub` to local disk with a sensible filename.
- Download works for a trashed book.
- A book whose `drive_file_id` is null (or a non-owner's id) returns 404 rather than leaking data.
- When the Drive session is expired/disconnected, the user is sent to re-auth (or sees a clear error) rather than a broken download.

**Implementation Note**: After automated verification passes, pause for manual confirmation that download works end-to-end.

---

## Testing Strategy

### Unit Tests:

- `parseEpub` extracts publisher/language/published date/description from a fixture OPF carrying those `dc:` fields; returns null for each when absent; strips HTML from description.

### Integration Tests:

- Import → confirm round-trip persists the new fields and `getOwnedBook` returns them.
- Download route returns 404 for a missing/null `drive_file_id` and for a book owned by another user.

### Manual Testing Steps:

1. Import an epub with full `dc:` metadata; confirm; open the detail page and verify all seven fields populate.
2. Import a sparse epub; verify `<empty>` placeholders.
3. Click Download on an active book and on a trashed book; verify the file lands locally.
4. Disconnect/expire the Drive session and click Download; verify re-auth/error rather than a silent failure.

## Migration Notes

Migration `0004` only adds nullable columns, so it applies to a populated DB without backfill. Existing rows (seed + prior imports) keep the new columns null and render `<empty>`; they are not re-parsed.

## References

- Change: `context/changes/book-detail-metadata-download/change.md`
- Detail page: `src/app/(app)/books/[id]/page.tsx`
- Book queries: `src/lib/books.ts:155` (`getOwnedBook`), `:68` (`getConfirmedBook`)
- Epub parser: `src/lib/epub/parse.ts`
- Draft flow: `src/lib/book-drafts.ts:41` (`createDraft`), `:128` (`confirmDraft`)
- Route template: `src/app/api/books/[id]/cover/route.ts`
- Drive client: `src/lib/drive/client.ts:7`; trash-folder behavior: `src/lib/drive/trash.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: All-metadata display

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:migrate`
- [x] 1.2 Migration replay (up/down/up) passes: `npm run test:migrate-replay`
- [x] 1.3 Type checking passes: `npx tsc --noEmit`
- [x] 1.4 Linting passes: `npm run lint`
- [x] 1.5 Unit/integration tests pass: `npm test`

#### Manual

- [x] 1.6 Import with full `dc:` metadata shows all four new fields after confirm
- [x] 1.7 Import missing fields shows `<empty>` for those rows
- [x] 1.8 Existing seed book renders new rows as `<empty>` without error
- [x] 1.9 Details card appears for a trashed book
- [x] 1.10 Description with embedded HTML renders as clean plain text

### Phase 2: Drive download

#### Automated

- [ ] 2.1 Type checking passes: `npx tsc --noEmit`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Tests pass: `npm test`

#### Manual

- [ ] 2.4 Download on a book with a Drive file saves the `.epub` locally
- [ ] 2.5 Download works for a trashed book
- [ ] 2.6 Null `drive_file_id` / non-owner id returns 404
- [ ] 2.7 Expired/disconnected Drive session sends user to re-auth or clear error
