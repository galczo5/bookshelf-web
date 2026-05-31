# Epub Import to Drive — Plan Brief

> Full plan: `context/changes/epub-import-to-drive/plan.md`

## What & Why

Ship the first end-to-end write path: drop or pick an epub on `/`, the server parses its embedded metadata, uploads the file to a flat `Bookshelf/` folder in Drive named `<author> — <title>.epub`, and inserts a `books` row. This is roadmap S-01 — the import half of US-01. S-02 will fill metadata gaps with AI; S-03 will surface the library list; both depend on this slice landing first.

## Starting Point

F-01 shipped Drive OAuth, the `getDriveClient()` factory, and `DriveAuthError` for expired-session recovery (`src/lib/drive/client.ts`). F-02 shipped the full library schema — `users`, `books`, `tags`, `book_tags`, `notes` (`src/lib/db/migrations/0002_library_schema.mts`) — and the Kysely `Database` type covering them all. Both foundations explicitly deferred two things to this slice: creating the Drive `Bookshelf/` folder, and bootstrapping the `users` row on sign-in. The home page today renders just a sign-out button and the F-01 connection-check button; no upload UI, no epub parser, no Drive write code.

## Desired End State

A signed-in operator drops a `.epub` on `/`. Within a few seconds, an inline `Imported: <title> by <author>` confirmation appears. The file is in Drive at `Bookshelf/<sanitized-author> — <sanitized-title>.epub`. A `books` row holds the title, author, ISBN, cover bytes, and Drive file ID. A second drop of the same file lands cleanly as a sibling with ` (2).epub` and a second row. A malformed or non-epub file shows a clean inline error and writes nothing. A drop while the refresh token has been revoked clears the session and redirects to `/signin?expired=1`.

## Key Decisions Made

| Decision                       | Choice                                                                  | Why (1 sentence)                                                                                                                                       | Source |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Scope boundary                 | Import + per-import confirmation only; no library list                  | S-03 owns the library list; staying narrow respects the roadmap and keeps the slice testable.                                                          | Plan   |
| Epub parser                    | DIY with `jszip` + `fast-xml-parser`                                    | Both deps are popular, typed, and well-maintained; the EPUB 2/3 variation is small enough (~80 LOC) to own; avoids stale-parser-library risk.          | Plan   |
| Drive layout                   | Flat: `Bookshelf/<sanitized-author> — <sanitized-title>.epub`           | One folder, author-first filename for natural sorting; no per-author subfolder problem; PRD app-independent-library guardrail still met.               | Plan   |
| Upload UI                      | Single dropzone, click-to-pick                                          | Satisfies FR-001 (both affordances) with one UI element and a hidden `<input type="file">`; keyboard-accessible.                                       | Plan   |
| Server boundary                | Server Action with `bodySizeLimit: '20mb'`                              | Reuses the `checkDriveAction` / `useActionState` pattern already in the codebase; auth flows naturally via `auth()`; 20MB easily covers typical epubs. | Plan   |
| Ordering & rollback            | Parse → Drive upload → DB insert; best-effort `files.delete` on DB fail | Parse failures cost no Drive call; partial-state leaks are bounded to "DB insert AND delete both fail" — recoverable manually.                         | Plan   |
| Required fields                | Nothing required — filename fallback for title                          | Slice is self-contained; matches PRD FR-002/003 flow where AI fills gaps later in S-02; never blocks a real-world epub.                                | Plan   |
| Duplicate handling             | No detection — numeric suffix on filename collision                     | Minimum scope; solo user can manually trash duplicates via S-09 later; avoids a schema column committed prematurely.                                   | Plan   |
| Failure UX                     | Inline error under the dropzone                                         | Mirrors the existing `CheckDriveButton` / `checkDriveAction` discriminated-union pattern; no new UI primitive needed.                                  | Plan   |
| `users` upsert location        | In the existing `signIn` callback (`src/auth.ts`)                       | F-02's explicit handoff to S-01; idempotent; runs once per sign-in; keeps the import action focused on import.                                         | Plan   |
| Bookshelf folder ID storage    | In-memory `Map<email, folderId>` keyed by email; lazy-create on miss    | One extra Drive list-call per cold start; avoids a schema column; rebuilds cleanly on every container restart.                                         | Plan   |

## Scope

**In scope:**
- `jszip` + `fast-xml-parser` runtime deps
- `experimental.serverActions.bodySizeLimit: '20mb'` in `next.config.ts`
- `users` row upsert in the `signIn` callback
- `src/lib/users.ts` with `upsertUserByEmail` and `getUserIdByEmail`
- `src/lib/epub/parse.ts` — `parseEpub(buffer)` returns title / author / isbn / cover with EPUB 2 and 3 cover-discovery rules
- `src/lib/drive/library-folder.ts` — `getOrCreateLibraryFolder` with module-level cache
- `src/lib/drive/upload.ts` — `uploadBookToDrive`; Phase 2 adds `findAvailableFilename` with numeric-suffix logic
- `src/app/actions/import-epub.ts` — orchestrates parse → upload → DB insert with rollback delete
- `src/app/components/import-dropzone.tsx` — `useActionState`-driven dropzone with click-to-pick fallback
- `src/app/page.tsx` — render the dropzone
- Filename sanitization (replace `/ \ : * ? " < > |`, cap segments at 100 chars, `unknown` substitution for empty)
- `EpubParseError` for malformed-epub flagging

**Out of scope:**
- Library list view, single-book view (S-03)
- AI metadata enrichment, confirmation gate (S-02)
- Content-hash dedup, ISBN-based dedup, edit affordances
- Streaming uploads / direct-to-Drive resumable uploads
- Background workers, retry queues
- `content_hash` column on `books` (no schema change in this slice)
- Test framework introduction
- PDF, MOBI, or any non-epub format

## Architecture / Approach

```
Browser /                           Server                         External
─────────────────                  ─────────────────────           ─────────────
ImportDropzone           ─POST─►   importEpubAction
  (useActionState,                 ├─ auth() / DriveAuthError ───► /signin?expired=1
   dropzone +                      ├─ Buffer.from(file.arrayBuffer())
   hidden <input>)                 ├─ parseEpub(buf) ─────────────► (in-memory zip+xml)
                                   │   └─ EpubParseError? ──► inline error
                                   ├─ getDriveClient()
                                   ├─ getOrCreateLibraryFolder ──► drive.files.list / .create
                                   ├─ composeFilename(author,title)
                                   ├─ findAvailableFilename ─────► drive.files.list (Phase 2)
                                   ├─ uploadBookToDrive ─────────► drive.files.create
                                   ├─ getUserIdByEmail ──────────► postgres
                                   ├─ db.insertInto('books') ────► postgres
                                   │   └─ catch: drive.files.delete (best-effort)
                                   └─ return {ok:true, title, author}
                                                                   ▲
                                signIn callback (auth.ts) ────────►│ users upsert (postgres)
```

Module-level `Map<email, folderId>` in `library-folder.ts` is the only state outside Postgres and Drive. Cache survives container lifetime; rebuilds cleanly on cold start.

## Phases at a Glance

| Phase                              | What it delivers                                                                                                                                                                                                            | Key risk                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Happy-path import end-to-end    | A clean, well-formed epub round-trips from drop to Drive + DB; rollback delete on DB-insert failure; body-size config; new deps; users-upsert in signIn callback; inline `Imported: …` confirmation.                        | EPUB 2 vs EPUB 3 cover-discovery variation may surface on the first real-world epub if the parser only handles one convention — plan covers both rules.   |
| 2. Edge cases and robustness       | Filename-collision numeric suffix; filename fallback for missing `<dc:title>`; `EpubParseError` mapped to clean inline error; top-level error envelope for any other failure.                                               | Drive query-string escaping for filenames containing single quotes — must escape before interpolating into `q: "… name = '…'"`; called out explicitly.    |

**Prerequisites:**
- F-01 deployed (Drive OAuth, `getDriveClient()`, `DriveAuthError`).
- F-02 deployed (schema with `users`, `books`).
- Operator has at least one signed-in session OR is willing to sign out / in once after the Phase 1 deploy so the new signIn callback creates the `users` row.

**Estimated effort:** ~1–2 evening sessions. Phase 1 is the bulk (new modules + UI + config + first end-to-end test); Phase 2 is mostly action-level guard rails once the happy path is proven.

## Open Risks & Assumptions

- **EPUB 2 vs EPUB 3 cover discovery.** Parser implements both rules (manifest `properties="cover-image"` for EPUB 3; `<meta name="cover">` indirection for EPUB 2). Real-world epubs from older sources may use neither — `cover_bytes` falls back to null; S-02's AI enrichment is the safety net.
- **`drive.file` scope and the `Bookshelf/` folder.** Scope only sees app-created files, so a folder the user manually creates won't be found; we'll create our own. If the user later renames or moves "our" folder via Drive's web UI, the next import still finds it by ID-via-list-query; only deletion forces re-create.
- **Body limit applies project-wide.** `experimental.serverActions.bodySizeLimit: '20mb'` raises the cap for every server action, not just import. The only existing action (`checkDriveAction`) has no body, so no risk today, but worth knowing when adding future write-heavy actions.
- **First-import-after-deploy edge case.** If the operator's session predates the Phase 1 deploy, the `users` row isn't bootstrapped yet (signIn callback hasn't re-fired). First import will throw at `getUserIdByEmail`; Phase 2's top-level error envelope renders a generic failure; remedy is sign out + sign in. Documented in plan References.
- **Module-level Drive folder cache vs multi-instance.** Cache is per-process. Single Render free-tier container today, so the cache is consistent. If we ever scale horizontally, each instance does its own first-time lookup — still correct, just less efficient.
- **20MB body limit vs Render free-tier memory.** Whole file lives in memory until Drive upload completes. Free tier has 512MB RAM; a 20MB peak per concurrent import is fine for solo use. Multi-user or multi-concurrent imports would warrant streaming.

## Success Criteria (Summary)

- Operator can drop or pick an epub and see it land in Drive (correct folder, correct filename) and in the DB (correct title, author, ISBN, cover, drive_file_id) — with inline `Imported: …` confirmation.
- Re-importing the same epub produces a visible-but-tolerated second row plus a ` (2).epub` Drive sibling, never an error.
- A malformed file, an empty file, a non-epub-with-`.epub`-extension all yield clean inline errors and write nothing — neither in Drive nor in the DB.
- A revoked refresh token at import time redirects to `/signin?expired=1`, never silently fails or persists a zombie row.
