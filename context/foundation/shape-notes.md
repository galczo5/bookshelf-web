---
project: "Bookshelf"
context_type: greenfield
created: 2026-05-18
updated: 2026-05-19
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "form factor"
      decision: "MVP shifted from desktop application to web application on 2026-05-19; mobile remains out of scope; native desktop install is not on the roadmap"
    - topic: "persona scope"
      decision: "strict audience-of-one — the project author is the sole intended user"
    - topic: "competitor framing in vision"
      decision: "keep generic — no specific tool named in shipped artifact"
    - topic: "auth shape"
      decision: "single user; OAuth to a third-party cloud storage provider for storage access only — no in-app multi-user separation"
    - topic: "MVP first flow"
      decision: "import-enrich-tag-note-retrieve loop (idea.md library + notes + AI enrichment); Kobo sync deferred to post-MVP"
    - topic: "AI enrichment in v1"
      decision: "kept — when imported metadata is incomplete, the app calls an AI/search service to fill gaps; user confirms or rejects"
    - topic: "timeline"
      decision: "5 weeks of after-hours work; sustained-effort cost explicitly acknowledged on 2026-05-18"
    - topic: "delete semantics"
      decision: "soft-delete only — book moves to a recoverable 'trash' directory in cloud storage; library forgets it; user can restore"
    - topic: "reading via OS default reader"
      decision: "demoted to nice-to-have — focus is organization, not reading"
    - topic: "edit-a-tag semantics"
      decision: "global rename only; per-book tag add/remove is covered by FR-009 (tag a book)"
  frs_drafted: 18
  quality_check_status: accepted
---

# Shape Notes — Bookshelf

Seed idea captured from `idea.md` (committed 2026-05-18). Discovery in progress.

## Vision & Problem Statement

A solo reader collects epubs, reads them on a Kobo device, and takes notes as they go. The pain bites at two moments: when reaching to reread something, they can't recall where the file lives or what they thought about it last time, because notes live in a separate tool with no link back to the book; and when files pile up in an opaque directory structure that's only navigable through a heavy companion app.

Existing tools cover the surface area but punish daily use — overpacked feature sets, heavy configuration, dated interfaces, no AI assistance, and directory structures that are unusable without the tool itself. A focused, AI-assisted library manager — built around a single reader's actual workflow rather than every reader's possible workflow — wins by doing less, better.

## User & Persona

**Primary persona: the project author** — a solo reader who collects epub files, takes Markdown-style notes alongside reading, and reads on a Kobo device. Technically comfortable power user; reaches the product through a web interface from a desktop browser. Mobile is out of scope for v1. Reaches for the product at three moments: importing a freshly downloaded epub, locating a previously read book they want to revisit, and prepping the Kobo before a reading session.

The MVP serves this single user. If others adopt later, that's bonus — but no design decisions are made to accommodate strangers.

## Access Control

Single user. The app authenticates the operator against a third-party cloud storage provider via OAuth so it can read and write library files on the operator's behalf. The OAuth flow exists for storage access, not for in-app user identity — there is no role model, no permission matrix, and no concept of "other users" inside the application. If the device is shared, OS-level user accounts are the boundary.

## Forward: tech-stack

Captured here for downstream `/10x-tech-stack-selector` consumption — NOT part of the PRD.

- **Strong vendor preference for storage**: Google Drive. The user already uses it for their personal file storage and wants library files to live there. Tech-stack selection should treat this as a near-hard constraint unless a clearly better option surfaces during research.
- **Form factor**: web application accessed from a desktop browser. Mobile is explicitly out of scope for MVP. Native desktop install is not on the roadmap. (Initial seed idea was a desktop app; revised to web on 2026-05-19.)

## Success Criteria

### Primary

- A freshly downloaded epub can be imported, automatically enriched with metadata (with AI fallback when the file's embedded metadata is incomplete), tagged, annotated with a Markdown note, and re-found in a future session — all without leaving the app and without manual file management.

### Secondary

- Notes are searchable by their text content (e.g., "what book did I write about Heidegger?" surfaces the matching book).
- AI-enriched cover art looks correct and never falls back to placeholder imagery when a real cover is reasonably obtainable.

### Guardrails

- **Data integrity**: notes and library state are never silently lost or corrupted — not from cloud sync conflicts, interrupted imports, partial writes, or app crashes.
- **App-independent library**: files on the cloud storage backend are organized in a human-navigable directory structure. A reader who uninstalls the app must still be able to find and open every book through the storage provider's native interface.

## Timeline acknowledgment

Acknowledged on 2026-05-18: 5-week MVP requires sustained dedication across roughly 50–75 hours of evenings and weekends; user accepted the cost in eyes-open form. No further timeline warnings will be raised during this shape session.

## Functional Requirements

### Library import & curation

- FR-001: User can import an epub file via drag-and-drop or file picker. Priority: must-have
  > Socrates: Counter-argument considered: "drag-and-drop alone is enough; file picker is vestigial UI." Resolution: kept; file picker is cheap to include and covers the keyboard-driven import path.
- FR-002: User can have the app extract embedded metadata (title, author, cover, ISBN) from an imported epub automatically. Priority: must-have
  > Socrates: Counter-argument considered: "every epub has embedded metadata — this is table stakes, not worth specifying." Resolution: kept; the import flow's value depends on this being automatic and silent, not user-entered.
- FR-003: User can have the app propose values for missing or incomplete metadata fields using AI-assisted enrichment from external sources. Priority: must-have
  > Socrates: Counter-argument considered: "AI metadata is often subtly wrong (translated titles, mismatched editions); manual entry is faster than reviewing wrong suggestions." Resolution: kept; the confirmation gate (FR-004) absorbs the wrong-answer cost, and AI assistance is the differentiating insight from Phase 1.
- FR-004: User can confirm or reject AI-suggested metadata field-by-field before it is persisted. Priority: must-have
  > Socrates: Counter-argument considered: "if AI is good enough, the gate is friction; if AI isn't good enough, FR-003 should be dropped." Resolution: kept; metadata correctness is load-bearing for FR-008, FR-011, and FR-012, so a small friction cost buys high downstream value.
- FR-005: User can have imported epub files persisted to cloud storage in a human-navigable directory structure. Priority: must-have
  > Socrates: Counter-argument considered: "local-first persistence with sync-later would ship 1–2 weeks faster." Resolution: kept; cloud-first is load-bearing — the user already stores all their files in cloud storage, and a local-only library would be a different product.
- FR-006: User can soft-delete a book — the file moves to a recoverable "trash" directory in cloud storage and the library no longer shows it. Priority: must-have
  > Socrates: Counter-argument considered: "trash adds storage cost and a hidden directory the user must manage; hard delete is simpler." Resolution: kept; soft-delete is consistent with the app-independent library guardrail (files remain navigable in the trash via the cloud provider's UI).
- FR-007: User can restore a previously soft-deleted book from the trash directory back into the library. Priority: must-have
  > Socrates: Counter-argument considered: "user could drag the file back via the cloud provider's web UI; in-app restore duplicates UX." Resolution: kept; restore is the obvious complement to FR-006 — without it, soft-delete is half-finished from the user's perspective.

### Library browsing

- FR-008: User can browse the full library with each book's cover, title, and author visible at a glance. Priority: must-have
  > Socrates: Counter-argument considered: "a CLI listing of books would be enough; visual library is scope creep." Resolution: kept; the "I want to reread something" trigger moment from Phase 1 is recall-driven, and book covers are the strongest visual recall anchor.
- FR-009: User can tag a book with one or more custom labels, and add or remove tags from a book at any time. Priority: must-have
  > Socrates: Counter-argument considered: "tags only matter if filter exists." Resolution: kept; FR-011 (filter by tag) is also kept, so the pair stands or falls together.
- FR-010: User can rename a tag globally (the rename applies to every book that carries the tag). Priority: must-have
  > Socrates: Counter-argument considered: "manually editing each book's tags is cheaper than building global-rename UI." Resolution: kept; over the library's expected multi-year lifespan, tag taxonomies drift and global rename is the small feature with outsized long-tail value.
- FR-011: User can filter the library by one or more tags. Priority: must-have
  > Socrates: Counter-argument considered: "with <50 books, scroll is faster than filter — premature optimization." Resolution: kept; the primary persona expects the library to grow well beyond 50 books over years.
- FR-012: User can search the library by title or author text. Priority: must-have
  > Socrates: Counter-argument considered: "with <50 books, scroll beats search." Resolution: kept; same scale assumption as FR-011.
- FR-013: User can open a single-book view showing the book's full metadata and its attached notes. Priority: must-have
  > Socrates: Counter-argument considered: "info could be inline in the library view." Resolution: kept; single-book view is the natural home for notes (FR-014/015/016), and inlining all of that into the library list would push row height past usable.

### Notes

- FR-014: User can write a Markdown-formatted note attached to a specific book. Priority: must-have
  > Socrates: Counter-argument considered: "why Markdown specifically and not plain text?" Resolution: kept; Markdown matches the primary persona's existing note-taking habit (Phase 1), and rendering it is a small added cost.
- FR-015: User can edit an existing note. Priority: must-have
  > Socrates: Counter-argument considered: "delete-and-rewrite is functionally equivalent." Resolution: kept; destroying then re-creating is hostile UX, and in-place edit is the universal expectation.
- FR-016: User can delete a note from a book. Priority: must-have
  > Socrates: Counter-argument considered: "editing the note to an empty string is functionally equivalent." Resolution: kept; explicit delete removes the empty-note artifact from future note-search (FR-017) results.
- FR-017: User can search notes by their text content; results surface the matching book. Priority: nice-to-have
  > Socrates: Counter-argument considered: "primary persona usually knows which book the note belongs to and navigates there directly; cross-note search is a power-user feature." Resolution: kept as nice-to-have only — maps to the Secondary success criterion, not in the must-have set.

### Reading

- FR-018: User can open the underlying epub file in the operating system's default epub reader from within the app. Priority: nice-to-have
  > Socrates: Counter-argument considered: "Finder/Explorer + double-click already does this; the app's button adds one click of value at best." Resolution: kept as nice-to-have only — small convenience, not load-bearing for the organization-focused MVP.

## Business Logic

When an imported epub's embedded metadata is incomplete, the app infers the missing fields by combining the file's available data with external knowledge sources, and proposes them for the user to accept, refine, or reject before they are persisted.

The rule consumes two layers of input from the file: first, the epub's embedded metadata fields (title, author, cover, ISBN) — these are authoritative whenever present. When a field is missing or empty, the rule falls back to the file's filename and any text it can read from inside the file (front matter, copyright page, table of contents) to ground its inference. External knowledge sources are then queried to produce a candidate value for each missing field.

The output is never a single committed value — it is always a *proposal* presented to the user. Each proposed field carries two affordances: (a) **provenance** — a short explanation of where the value came from (e.g., "matches 12 external sources" vs "inferred from filename only — low confidence"); and (b) **alternative suggestions** — when the rule has more than one plausible candidate for a field (e.g., three possible covers from different editions), the alternatives are surfaced so the user picks rather than re-types.

The user encounters this rule during the import flow (FR-001 → FR-005). For an epub with complete embedded metadata, the rule produces no proposals and the import is silent. For an epub with gaps, the rule's proposals appear as a review step the user resolves before the book lands in the library.

## Non-Functional Requirements

- **AI enrichment latency**: for an imported epub with metadata gaps, proposed values are presented to the user within 30 seconds of the import completing; while external knowledge sources are being consulted, the user sees continuous visible progress, not a frozen screen.
- **Privacy of book content**: no bytes of a book's body text leave the user's device for the purpose of AI enrichment or any other external query. Only metadata-shaped strings (filename, embedded title, embedded author, ISBN, front-matter strings) may be sent to external services.
- **Library responsiveness**: opening the app shows the library list within 2 seconds, even for libraries up to 1000 books. Filter and search results update within 200 milliseconds of the user's keystroke.
- **Offline tolerance**: with no network connectivity, the user can browse the library, read and edit notes, and add or remove tags. Import and AI enrichment require network and clearly indicate so when offline rather than failing silently.
- **Persistence durability**: any change the user makes (tag, note, import, soft-delete, restore) is durable within 5 seconds; a power loss after that window cannot revert the change.

## Product Framing (frontmatter source-of-truth)

- `product_type`: **web** — web application accessed from a desktop browser for the MVP. Mobile is out of scope; native desktop install is not on the roadmap. (Revised from `desktop` on 2026-05-19.)
- `target_scale.users`: **small** — audience-of-one. Single-digit users, where "users" effectively means "the project author."
- `timeline_budget.mvp_weeks`: **5** — acknowledged on 2026-05-18 as requiring sustained after-hours effort.
- `timeline_budget.hard_deadline`: **null** — no externally imposed date.
- `timeline_budget.after_hours_only`: **true**.

## Non-Goals

- **No support for non-epub formats** — PDF, MOBI, AZW, and other ebook formats are explicitly out of scope. The MVP is strict-epub-only.
- **No Kobo or device sync of any kind in the MVP** — the kepub conversion and device upload features from idea.md are deferred. The MVP does not partially implement this surface area.
- **No full-text search of book bodies** — search applies to library metadata (title, author, tags) and to note content only. Book contents stay opaque to the app's search.
- **No building or training our own AI models** — the app composes external AI and search APIs to fill metadata gaps; it does not own, fine-tune, or self-host models.
- **No multi-user features** — no sharing, social, comments, public profiles, collaborative tags, or any concept of a "second user." The app is single-user by design.
- **No mobile interface in the MVP** — web on desktop only. Mobile is not on the roadmap at all. Native desktop install is not on the roadmap either.
- **No modification of the original epub file** — the app reads metadata from epubs and catalogs them, but never rewrites the file in place. Any future format conversion (e.g., kepub) writes a separate file alongside the original.
- **No offline-first guarantee** — the app provides offline tolerance (browse, read notes, tag) but does not promise full offline capability. Import and AI enrichment require network.
- **No WCAG-AA compliance or formal accessibility audit** — keyboard navigation and basic readability only; no certified accessibility commitments.

## Forward: roadmap

Captured here for downstream consumption — NOT part of the PRD.

- **In-app reading experience** — not a non-goal (deliberately left open). May be revisited after the organization-focused MVP ships and the author has lived with it for a while.
- **Kobo / device sync** — deferred from MVP, not abandoned. The kepub conversion + device upload flow from the original idea sits in the post-MVP backlog.

## User Stories

### US-01: User imports and curates a freshly downloaded epub

- **Given** a freshly downloaded epub file the user has not yet imported
- **When** the user drags it into the app
- **Then** the file is persisted to the user's cloud storage in a human-navigable location, its embedded metadata is extracted, any gaps are filled by AI enrichment for the user to confirm or reject, and the book appears in the library ready to be tagged and annotated — all without leaving the app or manually moving any file

#### Acceptance Criteria
- The file lands in cloud storage at a path the user can navigate to without the app installed
- Embedded epub metadata (title, author, cover, ISBN) is read and shown without the user filling forms
- If any of (title, author, cover, ISBN) is missing or empty, AI enrichment proposes a value
- Proposed metadata is shown for user confirmation field-by-field before being persisted; the user can accept all, reject all, or accept some
- After confirmation, the book appears in the library list with its cover, title, and author visible
- Within the same session, the user can tag the book with at least one custom label and write at least one Markdown note attached to the book, without losing focus or navigating away from the book
