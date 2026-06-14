# Book Detail Metadata & Drive Download — Plan Brief

> Full plan: `context/changes/book-detail-metadata-download/plan.md`

## What & Why

The single-book view hides empty metadata and exposes no way to get the original file back. This adds a **Details** card that always lists every bibliographic field (showing `<empty>` when blank) and a **Download** button that pulls the epub from Google Drive to local disk.

## Starting Point

`/books/[id]` (`src/app/(app)/books/[id]/page.tsx`) shows cover + title and conditionally author/ISBN, so empty fields vanish. The schema and epub parser only know title/author/isbn/cover; the OPF's `dc:publisher`/`dc:language`/`dc:date`/`dc:description` are parsed-but-discarded. `books.drive_file_id` already holds the Drive handle but no download route exists.

## Desired End State

Every confirmed book shows a Details card with Title, Author, ISBN, Publisher, Language, Published date, Description — `<empty>` where blank. New imports populate the four new fields from the epub. A Download button (active and trashed books) saves the original epub locally via a Drive link.

## Key Decisions Made

| Decision                 | Choice                                                                              | Why                                                                    | Source |
| ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| Field set                | Bibliographic + 4 new DB columns (publisher, language, published date, description) | Matches what users expect on a book page; all single-valued            | Plan   |
| Existing books           | Show `<empty>`; only new imports populate                                           | Zero backfill; confirmed books no longer hold staged bytes to re-parse | Plan   |
| Download mechanism       | Redirect to a Drive `webContentLink`                                                | User-chosen; keeps bytes off our server                                | Plan   |
| Button placement         | Header actions; shown for active + trashed                                          | Primary action; trashed files still live in Drive                      | Plan   |
| `published_date` storage | `text` column                                                                       | `dc:date` is free-form; a date type would fail to parse                | Plan   |
| Confirm path             | Unchanged                                                                           | `confirmDraft` preserves columns it doesn't set                        | Plan   |

## Scope

**In scope:** 4 new nullable columns + migration; epub extraction of publisher/language/date/description; Details card with `<empty>`; download route + button.

**Out of scope:** multi-valued fields (subjects/contributors); backfilling existing/seed books; enriching or editing the new fields; proxying download bytes through our server; review-UI changes.

## Architecture / Approach

Phase 1 is one vertical slice: migration `0004` → `BooksTable` type → `parseEpub` extraction → `import-epub`/`createDraft` persistence → `getOwnedBook`/`getConfirmedBook` selects → Details card. New fields are written once at draft creation and survive confirm untouched. Phase 2 adds `GET /api/books/[id]/download` (auth → ownership → `drive_file_id` → `getDriveClient` → `files.get` `webContentLink` → 302) plus a header button, modeled on the existing cover route.

## Phases at a Glance

| Phase                   | What it delivers                                   | Key risk                                                             |
| ----------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| 1. All-metadata display | Columns + extraction + Details card with `<empty>` | OPF field shapes vary; description may carry HTML                    |
| 2. Drive download       | Download route + header button                     | `webContentLink` redirect depends on browser Google auth / file size |

**Prerequisites:** local Postgres + Drive OAuth configured (existing dev setup).
**Estimated effort:** ~1-2 sessions across 2 phases.

## Open Risks & Assumptions

- **`webContentLink` redirect reliability**: the browser must be signed into the owning Google account; very large files trigger Google's virus-scan interstitial. Epubs are small and single-user, so this is expected to work, but it's the main correctness risk of the chosen download approach. Fallback if it proves flaky: proxy-stream via `files.get({ alt: "media" })`.
- Assumes `dc:date`/`dc:publisher`/etc. arrive as scalars handled by the existing `extractFirst` helper (they're not in the parser's `isArray` set).

## Success Criteria (Summary)

- Detail page lists all bibliographic fields, `<empty>` for blanks, for active and trashed books.
- A freshly imported epub's publisher/language/date/description appear after confirm.
- Download saves the original epub locally for both active and trashed books; bad/non-owner ids 404.
