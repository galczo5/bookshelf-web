# Epub vs DB Metadata Comparison — Plan Brief

> Full plan: `context/changes/book-preview-epub-metadata/plan.md`

## What & Why

Add a two-column metadata comparison grid to the `/books/[id]` detail page, showing "In library" (current DB values) and "From epub" (original epub-embedded values) side by side for 7 fields: title, author, ISBN, publisher, language, published date, and description. The goal is to let the user see at a glance what the epub contained vs what was saved (and potentially edited or enriched) in the app.

## Starting Point

The book detail page currently shows a simple `<dl>` with 5 fields (ISBN, Publisher, Language, Published, Description). Title and author appear above it. All values come from the DB; the original epub metadata is not stored after import confirmation — it's only live during the draft review phase.

## Desired End State

The metadata section renders a 3-column grid with column headers "In library" and "From epub." The "In library" column is populated on first paint; "From epub" shows a skeleton for 1–3 s while the epub is re-downloaded from Drive and re-parsed, then fills in. Cells where the two values differ are highlighted in amber. When Drive is unavailable, epub cells show "—" with an explanatory note.

## Key Decisions Made

| Decision               | Choice                                  | Why (1 sentence)                                                         |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| Epub data source       | Re-parse from Drive on demand           | No migration needed; always reflects actual epub file                    |
| Loading strategy       | Client-side fetch + skeleton            | Page loads instantly; Drive+parse latency (~1-3s) is acceptable async    |
| Existing book fallback | Show "—" + note                         | Consistent layout; avoids hiding the feature from users with older books |
| Fields shown           | All 7 text fields (incl. title, author) | Complete comparison including fields editable during review              |
| Layout                 | Replace current `<dl>` in-place         | Metadata stays in one place; additive panel would duplicate values       |

## Scope

**In scope:**

- New API route: `GET /api/books/[id]/epub-metadata`
- New client component: `EpubMetadataComparison`
- Replace `<dl>` in `src/app/(app)/books/[id]/page.tsx`

**Out of scope:**

- Cover image comparison
- Caching epub parse results in DB
- Editing metadata from this component
- Cover image comparison

## Architecture / Approach

The route downloads the epub via the existing `getDriveClient()` using `alt: 'media'` + `responseType: 'arraybuffer'`, pipes the bytes through `parseEpub()`, and returns a typed JSON response. The client component mounts, fires a fetch to that route, and swaps skeleton rows for real values. Differing cells get an amber highlight.

## Phases at a Glance

| Phase               | What it delivers                                       | Key risk                                                        |
| ------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| 1. API route        | Endpoint that re-downloads + re-parses epub from Drive | Drive byte-download pattern is new to this codebase             |
| 2. Client component | Skeleton + comparison grid with diff highlighting      | Skeleton/loading state UX                                       |
| 3. Wire into page   | Replace `<dl>` with new component                      | E2e tests referencing the old metadata layout may need updating |

**Prerequisites:** Google Drive credentials configured (already required for book import)  
**Estimated effort:** ~1 session across 3 phases

## Open Risks & Assumptions

- Drive re-parse adds ~1–3 s per page visit; if this feels too slow in practice, a DB cache can be added later
- E2e tests in `e2e/` may select metadata by the existing `<dl>` structure — check `npm run test:e2e` after Phase 3

## Success Criteria (Summary)

- "From epub" column skeleton appears immediately on page load and resolves within ~3 s for a book with a valid Drive file
- Cells where DB and epub values differ show an amber highlight
- Drive-unavailable and no-`drive_file_id` cases render gracefully with "—" placeholders
