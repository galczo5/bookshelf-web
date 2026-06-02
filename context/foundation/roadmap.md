---
project: Bookshelf
version: 1
status: draft
created: 2026-05-25
updated: 2026-06-02
prd_version: 1
main_goal: low-complexity
top_blocker: capacity
---

# Roadmap: Bookshelf

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

A solo reader on Google Drive wants to import epubs, enrich their metadata with AI assistance, tag and annotate them in Markdown, and re-find them later — without leaving the app and without hand-organizing files. Existing tools punish daily use with overpacked feature sets and opaque directory structures; Bookshelf wins by doing less, well, for an audience of one. The MVP is web-on-desktop only, single-user, and strict-epub-only.

The roadmap orders work around closing one loop: **US-01's full happy path — import → enrich → tag → note → re-find — in a single session.** Everything else lives behind it.

## North star

**`S-05`: user can write, edit, and delete a Markdown note attached to a book — closing the US-01 import-enrich-tag-note-retrieve loop end-to-end.**

> The north star here is the smallest end-to-end flow whose successful delivery would prove the core product hypothesis (that the focused single-user loop is worth building). `S-05` is the terminal slice in the US-01 chain — once it ships, every preceding slice (F-01, F-02, S-01, S-02, S-03, S-04) is also live, and the user can run the full loop. Sequenced as early as Prerequisites allow.

## At a glance

| ID    | Change ID                        | Outcome (user can …)                                                | Prerequisites    | PRD refs                  | Status   |
| ----- | -------------------------------- | ------------------------------------------------------------------- | ---------------- | ------------------------- | -------- |
| F-01  | drive-oauth-and-client           | (foundation) Drive OAuth + Drive API client wired                   | —                | Access Control, FR-005    | implemented |
| F-02  | library-data-schema              | (foundation) Postgres schema for books, tags, notes                 | —                | NFR persistence, FR-008+  | implemented |
| S-01  | epub-import-to-drive             | import an epub; embedded metadata extracted; file lands in Drive    | F-01, F-02       | US-01, FR-001, FR-002, FR-005 | implemented |
| S-02  | ai-metadata-enrichment-gate      | review and confirm/reject AI proposals for missing metadata fields  | S-01             | US-01, FR-003, FR-004     | implemented |
| S-03  | library-and-book-view            | browse the library; open a single-book view with metadata + notes   | S-02             | FR-008, FR-013            | implemented |
| S-04  | tag-a-book                       | add and remove custom tags on a book                                | S-03             | FR-009                    | implemented |
| S-05  | book-notes                       | write, edit, and delete a Markdown note attached to a book          | S-03             | US-01, FR-014, FR-015, FR-016 | implemented |
| S-06  | filter-by-tag                    | filter the library by one or more tags                              | S-04             | FR-011                    | implemented |
| S-07  | search-title-author              | search the library by title or author text                          | S-03             | FR-012                    | implemented |
| S-08  | rename-tag-globally              | rename a tag everywhere it appears                                  | S-04             | FR-010                    | implemented |
| S-09  | soft-delete-book                 | move a book to a recoverable trash directory in Drive               | S-03             | FR-006                    | proposed |
| S-10  | restore-trashed-book             | restore a previously trashed book back into the library             | S-09             | FR-007                    | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                       | Chain                                                  | Note                                                                                          |
| ------ | --------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A      | Foundations & first import  | `F-01` → `F-02` → `S-01` → `S-02` → `S-03`             | Critical path to the north star; every other stream joins here at `S-03`.                     |
| B      | US-01 loop closure          | `S-04` → `S-05`                                        | Closes the import-enrich-tag-note loop. `S-05` is the north star. Joins Stream A at `S-03`.   |
| C      | Title / author search       | `S-07`                                                 | Standalone. Joins Stream A at `S-03`. Independent of tags.                                    |
| D      | Tag system extras           | `S-06` / `S-08`                                        | Filter-by-tag and global rename. Both join Stream B at `S-04`; independent of each other.     |
| E      | Trash lifecycle             | `S-09` → `S-10`                                        | Soft-delete + restore. Joins Stream A at `S-03`. Independent of all other streams.            |

## Baseline

What's already in place in the codebase as of `2026-05-25` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Next.js 16 + React 19 scaffold (`src/app/{layout,page,globals.css}`), Tailwind v4 per `tech-stack.md`.
- **Backend / API:** partial — App Router can host route handlers, but no API routes exist yet beyond the demo `page.tsx`.
- **Data:** absent — `package.json` has no DB driver, ORM, or migration tooling. `render.yaml` declares a Postgres free instance (`bookshelf-db`) but the app has no connection code.
- **Auth:** absent — no auth library; Google Drive OAuth flow (required by PRD §Access Control) is not implemented.
- **Deploy / infra:** present — `render.yaml` (Docker runtime, Frankfurt, auto-deploy on merge), `Dockerfile`, Render's GitHub integration in place. No `.github/workflows` needed.
- **Observability:** absent — no logging library, error tracking, or metrics.

## Foundations

### F-01: Drive OAuth and Drive API client

- **Outcome:** (foundation) the app can authenticate the operator against Google Drive and call the Drive API on their behalf.
- **Change ID:** drive-oauth-and-client
- **PRD refs:** Access Control (Google Drive auth flow), FR-005 (persist to cloud storage)
- **Unlocks:** `S-01` (epub import to Drive), `S-09` (soft-delete moves the file inside Drive), `S-10` (restore is the inverse Drive move)
- **Prerequisites:** —
- **Parallel with:** F-02 (data schema is independent of OAuth wiring)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** OAuth misconfiguration silently delays everything below it; the redirect/scopes setup is finicky but well-trodden territory.
- **Status:** implemented

### F-02: Library data schema (Postgres)

- **Outcome:** (foundation) Postgres connection, migrations tooling, and the initial schema for books, tags, and notes are in place.
- **Change ID:** library-data-schema
- **PRD refs:** NFR Persistence durability (5-second guarantee), NFR Library responsiveness (1000-book listing in 2 s), FR-008 / FR-009 / FR-014 (entities the schema models)
- **Unlocks:** `S-01` (books table), `S-04` (tags + book_tags), `S-05` (notes table), `S-09` (`trashed_at` flag on book row)
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - Offline-tolerance NFR vs web form-factor (PRD Open Q #3) — Owner: user. Block: no. Affects whether the schema needs to mirror to an IndexedDB local cache, but the v1 schema doesn't change either way.
- **Risk:** schema rigidity could bite when tags/notes patterns evolve; mitigated by deferring indexes and complex constraints until a slice forces them.
- **Status:** implemented

## Slices

### S-01: First epub import to Drive with embedded-metadata extraction

- **Outcome:** user can drop or pick an epub; the app extracts embedded metadata (title, author, cover, ISBN) and persists the file to Drive at a human-navigable path.
- **Change ID:** epub-import-to-drive
- **PRD refs:** US-01, FR-001, FR-002, FR-005
- **Prerequisites:** F-01, F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Target Drive directory layout (e.g., `Bookshelf/<author>/<title>.epub` vs flat) — Owner: user. Block: no. Default to a layout that satisfies the app-independent-library guardrail.
- **Risk:** epub format variability — embedded metadata is sometimes missing or malformed; this is exactly why `S-02` exists, but `S-01` still has to fail gracefully for unreadable files.
- **Status:** implemented

### S-02: AI metadata enrichment with confirmation gate

- **Outcome:** for any missing metadata field, the user sees an AI-proposed value with provenance and alternative suggestions, and accepts/rejects field-by-field before persistence.
- **Change ID:** ai-metadata-enrichment-gate
- **PRD refs:** US-01, FR-003, FR-004, Business Logic, NFR AI enrichment latency, NFR Privacy of book content
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Choice of enrichment provider (search + LLM combination) — Owner: user. Block: no, resolved during `/10x-plan`.
  - Privacy boundary enforcement: which exact fields are allowed to cross the network (filename, embedded title/author/ISBN, front-matter strings — per PRD NFR) — Owner: user. Block: no.
- **Risk:** the 30 s latency budget is a real constraint; if external providers stall, the loading UX must keep the user oriented (PRD NFR). Privacy NFR also gates what can be sent.
- **Status:** implemented

### S-03: Library list view and single-book view

- **Outcome:** user can see every imported book at a glance (cover, title, author) and open a single-book view with full metadata and attached notes.
- **Change ID:** library-and-book-view
- **PRD refs:** FR-008, FR-013, NFR Library responsiveness
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** the 2 s open-to-list NFR for libraries up to 1000 books is the load-bearing performance constraint; naive cover fetching from Drive will violate it without local caching.
- **Status:** implemented

### S-04: Tag a book

- **Outcome:** user can attach or remove custom tags on a single book; tags persist across sessions.
- **Change ID:** tag-a-book
- **PRD refs:** FR-009
- **Prerequisites:** S-03
- **Parallel with:** S-05, S-07, S-09 (all branch off S-03; capacity-friendly to interleave)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** —
- **Status:** implemented

### S-05: Book notes — write, edit, delete (north star)

- **Outcome:** user can write a Markdown note on a book, edit it in place, and delete it. With this slice live, the full US-01 happy path runs end-to-end.
- **Change ID:** book-notes
- **PRD refs:** US-01, FR-014, FR-015, FR-016
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-07, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** persistence-durability NFR (5 s) applies to notes — autosave or explicit save must respect it; trivial under Postgres but worth naming so the implementation doesn't drift into a debounced-localStorage shape.
- **Status:** implemented (delivered as part of `S-03 library-and-book-view`; no separate change folder)

### S-06: Filter library by tag

- **Outcome:** user can filter the library list by one or more tags.
- **Change ID:** filter-by-tag
- **PRD refs:** FR-011
- **Prerequisites:** S-04
- **Parallel with:** S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** the 200 ms filter-on-keystroke NFR applies; for a 1000-book library this is comfortably client-side, but the implementation should not silently re-fetch on every keystroke.
- **Status:** implemented

### S-07: Search library by title or author

- **Outcome:** user can search the library by typing a title or author fragment; results filter as they type.
- **Change ID:** search-title-author
- **PRD refs:** FR-012
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-05, S-06, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** same 200 ms NFR as `S-06`; same client-side answer.
- **Status:** implemented

### S-08: Rename a tag globally

- **Outcome:** user can rename a tag once; every book that carried the old name now carries the new one.
- **Change ID:** rename-tag-globally
- **PRD refs:** FR-010
- **Prerequisites:** S-04
- **Parallel with:** S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** global mutation; must be transactional to avoid half-renamed state.
- **Status:** implemented

### S-09: Soft-delete a book to a Drive trash directory

- **Outcome:** user can trash a book; the underlying file moves to a recoverable directory in Drive and the library no longer lists it.
- **Change ID:** soft-delete-book
- **PRD refs:** FR-006, Success Criteria guardrail (app-independent library)
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - Trash directory location in Drive (`Bookshelf/.trash/` vs sibling `Bookshelf-trash/`) — Owner: user. Block: no. The app-independent-library guardrail requires that the trash is human-navigable.
- **Risk:** Drive API move-with-rename conflict handling; mitigated by an atomic-move + database-flag pattern.
- **Status:** proposed

### S-10: Restore a trashed book

- **Outcome:** user can restore a trashed book; the file moves back to its original Drive location and the book reappears in the library.
- **Change ID:** restore-trashed-book
- **PRD refs:** FR-007
- **Prerequisites:** S-09
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** restore must handle the case where the original directory has been deleted/renamed in Drive between trash and restore; small but real edge.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                       | Ready for `/10x-plan` | Notes                              |
| ---------- | ---------------------------- | ----------------------------------------------------------- | --------------------- | ---------------------------------- |
| F-01       | drive-oauth-and-client       | Wire Google Drive OAuth and Drive API client                | yes                   | Recommended first move.            |
| F-02       | library-data-schema          | Stand up Postgres schema for books, tags, notes             | yes                   | Parallelizable with F-01.          |
| S-01       | epub-import-to-drive         | First epub import lands in Drive with embedded metadata     | no                    | Needs F-01 + F-02.                 |
| S-02       | ai-metadata-enrichment-gate  | AI metadata enrichment with confirmation gate               | no                    | Needs S-01.                        |
| S-03       | library-and-book-view        | Library list view and single-book view                      | no                    | Needs S-02.                        |
| S-04       | tag-a-book                   | Tag a book; add and remove tags                             | no                    | Needs S-03.                        |
| S-05       | book-notes                   | Book notes — write, edit, delete (north star)               | no                    | Needs S-03.                        |
| S-06       | filter-by-tag                | Filter library by tag                                       | no                    | Needs S-04.                        |
| S-07       | search-title-author          | Search library by title or author                           | no                    | Needs S-03.                        |
| S-08       | rename-tag-globally          | Rename a tag globally                                       | no                    | Needs S-04.                        |
| S-09       | soft-delete-book             | Soft-delete a book to a Drive trash directory               | no                    | Needs S-03.                        |
| S-10       | restore-trashed-book         | Restore a trashed book                                      | no                    | Needs S-09.                        |

## Open Roadmap Questions

1. **Additional user stories not yet drafted** (PRD Open Q #1) — US-02 and beyond (library browsing, tag operations, note management, trash/restore) are a documentation gap. Owner: user. Block: roadmap-wide no; FRs cover the surface area. Resolve before `/10x-plan` on S-03/S-04/S-05/S-09 if you want US-NN trace for each.
2. **`target_scale.qps` and `target_scale.data_volume`** (PRD Open Q #2) — inferred as `low` and `small`. Owner: user. Block: no.
3. **Offline tolerance under a web form factor** (PRD Open Q #3) — keep the NFR as-is (browse/notes/tags work offline) vs relax to "requires network" for v1. Owner: user. Block: no, but resolving early shapes F-02 and S-03 (IndexedDB mirror vs server-only).

## Parked

- **No support for non-epub formats** — Why parked: PRD §Non-Goals.
- **Kobo / device sync (kepub conversion + upload)** — Why parked: PRD §Non-Goals; explicitly deferred from MVP, not abandoned. Lives in the post-MVP backlog per shape-notes `## Forward: roadmap`.
- **In-app reading experience** — Why parked: shape-notes `## Forward: roadmap` left deliberately open for post-MVP revisit; not currently a non-goal.
- **No full-text search of book bodies** — Why parked: PRD §Non-Goals.
- **No building or training our own AI models** — Why parked: PRD §Non-Goals; compose external APIs only.
- **No multi-user features** — Why parked: PRD §Non-Goals; single-user by design.
- **No mobile interface; no native desktop install** — Why parked: PRD §Non-Goals.
- **No modification of the original epub file** — Why parked: PRD §Non-Goals.
- **No offline-first guarantee** — Why parked: PRD §Non-Goals (offline tolerance only, not full offline).
- **No WCAG-AA compliance or formal accessibility audit** — Why parked: PRD §Non-Goals.
- **FR-017: search notes by content** — Why parked: PRD priority `nice-to-have` (Secondary success criterion); deferred under `main_goal: low-complexity` + `top_blocker: capacity`. Resurface post-MVP.
- **FR-018: open epub in OS default reader from the app** — Why parked: PRD priority `nice-to-have`; same deferral rationale as FR-017.

## Done

(Empty. `/10x-archive` will append entries here as roadmap items archive.)
