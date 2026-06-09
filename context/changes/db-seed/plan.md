# DB Seed — 50 Public-Domain Books Implementation Plan

## Overview

Add a re-runnable `npm run db:seed` command that prefills a local development database with **50 public-domain books** so the library, tag-filter, search, note, and trash/restore surfaces all have realistic data without a live Google Drive or a real import flow.

Each seeded book is backed by a **generated mock "empty" epub file** (valid EPUB 3 structure, placeholder body, real embedded metadata + cover) committed in the repo. Covers come from web research (Standard Ebooks primary, Open Library fallback) and are committed as image files. The seed also creates a handful of tags, assigns them across books, attaches a few Markdown notes, and leaves ~5 books deliberately incomplete (missing author and/or cover) to exercise empty-state rendering.

## Current State Analysis

- **No seed mechanism exists.** The only ways data enters the DB today are the real import flow (`src/lib/book-drafts.ts` → Drive upload → confirm) and the e2e helpers (`e2e/helpers/db.ts`), which seed one row at a time via raw SQL for a single test user.
- **Books are user-owned and review-gated.** The library query (`src/lib/books.ts:24` `listConfirmedBooks`) only returns rows with `review_state = 'confirmed'`, `trashed_at IS NULL`, scoped to a `user_id`. Seed rows must be `confirmed`, non-trashed, and attached to a real `users` row.
- **`drive_file_id` is nullable.** Migration `0003_book_drafts.mts:11` dropped the `NOT NULL` constraint. Trash/restore (`src/app/actions/books.ts:35`, `:149`) explicitly handle a null `drive_file_id` by taking a **DB-only path that skips Drive entirely**. So seeding with `drive_file_id = NULL` makes trash/restore work in dev with no Drive credentials — a non-null synthetic id would instead force a Drive API call that fails.
- **Covers are bytes in the DB.** `books.cover_bytes` (`bytea`) + `cover_mime`, served by `/api/books/[id]/cover/route.ts`. There is no blob/file store — the seed must embed the actual image bytes.
- **`server-only` boundary.** Both `src/lib/db.ts` and `src/lib/epub/parse.ts` start with `import "server-only"`, which throws outside a React Server context. A plain `tsx` CLI therefore **cannot** import them. The established workaround (see `scripts/migrate.mts` and `e2e/helpers/db.ts`) is to construct a raw `pg` `Pool` and run SQL directly.
- **Script + epub-generation patterns already exist.** `scripts/migrate.mts` is the canonical `tsx` script wired as `npm run db:migrate`. `scripts/generate-epub-fixture.mts` already builds a minimal valid EPUB 3 with `JSZip` (mimetype stored-first, container.xml, content.opf with `dc:title`/`dc:creator`/`dc:identifier`, a cover-image item, one chapter). Both are directly reusable.
- **Public-domain classics generally predate ISBN**, so a null `isbn` on most rows is realistic, not a gap to fill.

## Desired End State

Running `DATABASE_URL=... npm run db:seed` against a fresh local Postgres produces a library that, when the developer signs in locally, shows 50 books with covers, working tag filters, a few books carrying Markdown notes, and a few books with empty-state covers/authors. Re-running the command leaves exactly 50 seed books (no duplicates) and never touches the developer's real imported books. Trashing and restoring a seeded book works without Drive.

Verify by: `npm run db:seed` exits 0 and reports "Seeded 50 books"; a second run reports the same; `SELECT count(*)` for the seed user = 50; the library page renders 50 covers; a tag filter narrows the list; a seeded book can be trashed and restored.

### Key Discoveries:

- Library visibility rule: `src/lib/books.ts:24` — must be `confirmed` + non-trashed.
- Null-`drive_file_id` → DB-only trash/restore: `src/app/actions/books.ts:35`.
- `server-only` blocks importing `@/lib/db` and `@/lib/epub/parse` from a CLI: `src/lib/db.ts:1`, `src/lib/epub/parse.ts:1`. Use raw `pg` like `scripts/migrate.mts`.
- Epub generation recipe to copy: `scripts/generate-epub-fixture.mts`.
- User upsert-by-email shape (for SQL): `e2e/helpers/db.ts:26`.

## What We're NOT Doing

- **No schema/migration changes.** No new columns, no "is_seed" flag — seed rows are identified by their exact titles from the manifest.
- **No live web fetching at seed time.** All web research (finding books, downloading covers) happens once during implementation; the results are committed. `npm run db:seed` is fully offline and deterministic.
- **No Drive upload.** Seed books have `drive_file_id = NULL` by design.
- **No real epub bodies.** The mock epubs are structurally valid but their content is a single placeholder chapter — they are not real book text (and the PRD forbids storing book bodies for AI anyway).
- **No production seeding.** The script refuses to run when `NODE_ENV === 'production'` unless `--force` is passed.
- **No importing the app's `parseEpub` / `@/lib/db`** from the seed script (server-only). The seed sources metadata from the manifest and cover bytes from the committed cover files.

## Implementation Approach

A small `scripts/seed/` asset bundle plus one seed runner:

```
scripts/
  seed.mts                 # the runner: pg Pool, prod guard, idempotent insert
  seed/
    books.json             # manifest: 50 entries (metadata + tags + notes + flags)
    covers/<slug>.jpg      # committed cover images (downloaded once)
    epubs/<slug>.epub      # committed generated mock epubs (one per book)
    generate-epubs.mts     # regenerates epubs/ from books.json + covers/
```

`books.json` is the single editable source of truth. `generate-epubs.mts` derives the committed `.epub` files from it (embedding the cover so each epub is self-consistent and reusable as an import fixture). `seed.mts` reads `books.json` for metadata/tags/notes and reads cover bytes from `covers/`, then inserts via raw SQL. The mock epubs are committed deliverables but are **not** read by `seed.mts` (avoids the `server-only` parser); they exist as realistic per-book library files and a future e2e import-fixture corpus.

## Critical Implementation Details

- **`server-only` trap.** `seed.mts` and `generate-epubs.mts` MUST NOT import `@/lib/db` or `@/lib/epub/parse`. Use `new Pool({ connectionString: process.env.DATABASE_URL })` from `pg` (mirror `scripts/migrate.mts`) and `JSZip` directly (mirror `scripts/generate-epub-fixture.mts`).
- **`drive_file_id` must be `NULL`, not a placeholder string.** A non-null value routes trash/restore through `getDriveClient()` (`src/app/actions/books.ts:46`), which throws in dev. Null takes the DB-only branch.
- **Idempotency without a marker column.** Cleanup is `DELETE FROM books WHERE user_id = $seedUser AND title = ANY($manifestTitles)` (notes/book_tags cascade), run inside the same transaction as the re-insert. This deletes only the manifest's known titles, so a developer's real imports (different titles, non-null drive ids) survive. Document this assumption in the script header.
- **mimetype entry ordering.** When generating epubs, the `mimetype` file must be added first and `STORE`d (uncompressed) per the EPUB spec — `generate-epub-fixture.mts` already does this; preserve it.
- **Cover licensing.** Only commit covers that are public-domain / CC0. Standard Ebooks cover artwork is CC0; prefer it. Record each cover's source URL in the manifest for provenance.

## Phase 1: Curate dataset & download cover assets

### Overview

Produce `scripts/seed/books.json` (50 curated public-domain books) and the committed cover images under `scripts/seed/covers/`. This is the web-research phase.

### Changes Required:

#### 1. Book manifest

**File**: `scripts/seed/books.json`

**Intent**: Curate 50 well-known public-domain titles (Standard Ebooks catalog primary; Open Library as metadata/cover fallback) spanning several genres so tag filtering is meaningful. Capture per-book the fields the seed and the epub generator both consume.

**Contract**: A JSON array of 50 objects, each:
`{ slug, title, author|null, isbn|null, coverFile|null, coverSourceUrl|null, tags: string[], notes?: string[], incomplete?: ("author"|"cover")[] }`.
`slug` is a unique kebab-case id used for filenames. Define ~6–8 tags (e.g. Fiction, Philosophy, Adventure, Poetry, Science, Russian Literature, Favorites) reused across books. Attach Markdown `notes` to ~4 books. Mark ~5 books `incomplete` (null `author` and/or null `coverFile`) to exercise empty states.

#### 2. Cover images

**File**: `scripts/seed/covers/<slug>.jpg` (one per non-incomplete-cover book)

**Intent**: Download each book's cover once from a public-domain/CC0 source and commit it so seeding is offline and reproducible.

**Contract**: Reasonably sized JPEG/PNG (target ≤ ~150 KB each) named by `slug`, matching `coverFile` in the manifest. `cover_mime` is inferred from the file extension at seed time.

### Success Criteria:

#### Automated Verification:

- Manifest parses and has exactly 50 entries: `node -e "const b=require('./scripts/seed/books.json'); if(b.length!==50) process.exit(1)"`
- Every non-incomplete `coverFile` exists on disk (a small check or the seed script's preflight reports missing files).
- Slugs are unique (preflight check).
- Prettier/lint clean on the JSON: `npm run lint`

#### Manual Verification:

- Spot-check 5 covers render correctly and match their titles.
- Genres are spread across the ~6–8 tags (no tag with zero or all books).
- All chosen covers are from public-domain/CC0 sources (Standard Ebooks / verified).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Generate mock epubs

### Overview

Generate one minimal, valid, empty-body EPUB 3 file per manifest entry, embedding that book's metadata and cover, and commit them under `scripts/seed/epubs/`.

### Changes Required:

#### 1. Epub generator

**File**: `scripts/seed/generate-epubs.mts`

**Intent**: Read `books.json`, and for each entry build a minimal valid epub (reusing the structure in `scripts/generate-epub-fixture.mts`) with the book's title/author/isbn in `content.opf` and the committed cover embedded as the cover image. Books flagged `incomplete: ["author"]` omit `dc:creator`; `incomplete: ["cover"]` omit the cover item. Write each to `scripts/seed/epubs/<slug>.epub`. Run via `tsx scripts/seed/generate-epubs.mts`.

**Contract**: Pure generator, no DB. Output is deterministic given the manifest + covers. Preserve the `mimetype`-first/`STORE` ordering. No `server-only` imports (`JSZip` only).

#### 2. Committed epub artifacts

**File**: `scripts/seed/epubs/<slug>.epub` (50 files)

**Intent**: The generated mock library files, committed so the corpus is durable and reusable as import fixtures.

**Contract**: 50 valid `.epub` files named by slug; each opens as a zip with `mimetype`, `META-INF/container.xml`, and an OPF carrying the expected metadata.

### Success Criteria:

#### Automated Verification:

- Generator runs clean: `npx tsx scripts/seed/generate-epubs.mts`
- 50 epub files produced: `ls scripts/seed/epubs/*.epub | wc -l` = 50
- Each epub is a valid zip whose first entry is an uncompressed `mimetype` (a small assertion in the generator or a check script).
- Type check passes: `npx tsc --noEmit` (or the project's typecheck hook)
- Lint passes: `npm run lint`

#### Manual Verification:

- Open 2–3 generated epubs in a reader / unzip them and confirm title/author/cover are present (and correctly absent for incomplete books).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Seed script & npm wiring

### Overview

Add `scripts/seed.mts` — the idempotent, prod-guarded seeder — wire it as `npm run db:seed`, and document it in CLAUDE.md.

### Changes Required:

#### 1. Seed runner

**File**: `scripts/seed.mts`

**Intent**: Read `books.json`, resolve the target user, and (in one transaction) clear prior seed rows for that user and insert 50 confirmed books with cover bytes, tags, book_tags, and notes. Mirror `scripts/migrate.mts` for the `pg` Pool + CLI-entry shape.

**Contract**: Behavior:

- **Prod guard**: if `process.env.NODE_ENV === 'production'` and no `--force`, print a refusal and exit non-zero.
- **DB**: raw `pg` `Pool` from `DATABASE_URL` (no `@/lib/db`). Error + exit 1 if `DATABASE_URL` unset.
- **User**: upsert by email from `--email <addr>` else `process.env.BOOKSHELF_ALLOWED_EMAIL`; `INSERT ... ON CONFLICT (email) DO UPDATE ... RETURNING id` (pattern from `e2e/helpers/db.ts:26`). Error if neither provided.
- **Preflight**: assert 50 entries, unique slugs, and that every referenced `coverFile` exists.
- **Idempotent cleanup**: `DELETE FROM books WHERE user_id = $1 AND title = ANY($2)` with the manifest titles.
- **Insert per book**: `INSERT INTO books (user_id, drive_file_id, title, author, isbn, cover_bytes, cover_mime, review_state) VALUES ($user, NULL, ..., 'confirmed')`. `cover_bytes` read from `covers/<coverFile>` (or NULL when incomplete); `cover_mime` from extension.
- **Tags**: upsert each distinct tag `INSERT INTO tags (user_id, name) ... ON CONFLICT (user_id, name) DO NOTHING`, then `INSERT INTO book_tags`.
- **Notes**: `INSERT INTO notes (book_id, body)` for each manifest note.
- Wrap inserts in a transaction; print `Seeded 50 books` on success.

#### 2. npm script

**File**: `package.json`

**Intent**: Add `"db:seed": "tsx scripts/seed.mts"` alongside `db:migrate`.

**Contract**: New `scripts` entry; no dependency changes (`tsx`, `pg`, `jszip` already present).

#### 3. Documentation

**File**: `CLAUDE.md`

**Intent**: Add a one-line `npm run db:seed` description to the Commands section, per the project rule that new runners are documented there.

**Contract**: One line noting it prefills local dev with 50 example books and is dev-only (prod-guarded), reads `BOOKSHELF_ALLOWED_EMAIL`/`--email`.

### Success Criteria:

#### Automated Verification:

- Seed runs clean against local Postgres: `DATABASE_URL=... npm run db:seed` exits 0 and prints `Seeded 50 books`.
- Idempotent: a second `npm run db:seed` also exits 0; seed-user book count stays 50 (`SELECT count(*) FROM books WHERE user_id = <seed user>` = 50).
- Prod guard: `NODE_ENV=production npm run db:seed` exits non-zero without `--force`.
- Missing-creds guard: running with neither `--email` nor `BOOKSHELF_ALLOWED_EMAIL` exits non-zero.
- Type check + lint pass: `npx tsc --noEmit`, `npm run lint`.

#### Manual Verification:

- Sign in locally as the seed email; the library shows 50 books with covers.
- A tag filter narrows the list; books with notes render their Markdown in the single-book view.
- The ~5 incomplete books show empty-state cover/author.
- Trash a seeded book, then restore it — both succeed with no Drive error (null-`drive_file_id` path).
- The seed does not delete or alter any non-seed book the developer imported.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit / preflight checks:

- Manifest invariants: 50 entries, unique slugs, referenced cover files exist (enforced in the seed's preflight so a bad manifest fails fast).
- Epub generator: each output is a valid zip with `mimetype` first/uncompressed.

### Integration:

- The seed run itself is the integration test against the Docker Postgres: insert 50, re-run, assert count stable at 50.

### Manual Testing Steps:

1. `docker compose up -d db` then `npm run db:migrate`.
2. `BOOKSHELF_ALLOWED_EMAIL=you@example.com npm run db:seed`.
3. `npm run dev`, sign in, confirm 50 books + covers.
4. Filter by a tag; open a noted book; confirm Markdown renders.
5. Trash + restore a seeded book.
6. Re-run the seed; confirm still 50, no duplicates.

## Performance Considerations

Trivial scale (50 rows, ~50 small images). Embedding cover bytes inline is fine; keep each committed cover ≤ ~150 KB to keep the repo lean. Batch inserts in one transaction.

## Migration Notes

No schema migration. Existing databases need no changes; the seed is additive and idempotent and only touches rows whose titles match the manifest.

## References

- Script + pg pattern: `scripts/migrate.mts`
- Epub generation recipe: `scripts/generate-epub-fixture.mts`
- Raw-SQL seed/cleanup pattern + user upsert: `e2e/helpers/db.ts`
- Library visibility rule: `src/lib/books.ts:24`
- Null-`drive_file_id` trash/restore path: `src/app/actions/books.ts:35`
- `server-only` boundary: `src/lib/db.ts:1`, `src/lib/epub/parse.ts:1`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Curate dataset & download cover assets

#### Automated

- [x] 1.1 Manifest parses and has exactly 50 entries — 8623503
- [x] 1.2 Every non-incomplete coverFile exists on disk — 8623503
- [x] 1.3 Slugs are unique — 8623503
- [x] 1.4 Prettier/lint clean on the JSON — 8623503

#### Manual

- [x] 1.5 Spot-check 5 covers render and match titles — 8623503
- [x] 1.6 Genres spread across the ~6–8 tags — 8623503
- [x] 1.7 All covers are public-domain/CC0 — 8623503

### Phase 2: Generate mock epubs

#### Automated

- [x] 2.1 Generator runs clean — abec007
- [x] 2.2 50 epub files produced — abec007
- [x] 2.3 Each epub is a valid zip with mimetype first/uncompressed — abec007
- [x] 2.4 Type check passes — abec007
- [x] 2.5 Lint passes — abec007

#### Manual

- [x] 2.6 Open 2–3 epubs; metadata/cover correct (and absent for incomplete) — abec007

### Phase 3: Seed script & npm wiring

#### Automated

- [x] 3.1 Seed runs clean and prints "Seeded 50 books"
- [x] 3.2 Idempotent: second run keeps count at 50
- [x] 3.3 Prod guard exits non-zero without --force
- [x] 3.4 Missing-creds guard exits non-zero
- [x] 3.5 Type check + lint pass

#### Manual

- [x] 3.6 Library shows 50 books with covers when signed in
- [x] 3.7 Tag filter narrows; noted books render Markdown
- [x] 3.8 Incomplete books show empty-state cover/author
- [x] 3.9 Trash + restore a seeded book succeeds (no Drive error)
- [x] 3.10 Non-seed imported books are untouched
