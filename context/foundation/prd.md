---
project: "Bookshelf"
version: 1
status: draft
created: 2026-05-18
context_type: greenfield
product_type: web
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 5
  hard_deadline: null
  after_hours_only: true
---

# Bookshelf

## Vision & Problem Statement

A solo reader collects epubs, reads them on a Kobo device, and takes notes as they go. The pain bites at two moments: when reaching to reread something, they can't recall where the file lives or what they thought about it last time, because notes live in a separate tool with no link back to the book; and when files pile up in an opaque directory structure that's only navigable through a heavy companion app.

Existing tools cover the surface area but punish daily use — overpacked feature sets, heavy configuration, dated interfaces, no AI assistance, and directory structures that are unusable without the tool itself. A focused, AI-assisted library manager — built around a single reader's actual workflow rather than every reader's possible workflow — wins by doing less, better.

## User & Persona

**Primary persona: the project author** — a solo reader who collects epub files, takes Markdown-style notes alongside reading, and reads on a Kobo device. Technically comfortable power user; reaches the product through a web interface from a desktop browser. Mobile is out of scope for v1. Reaches for the product at three moments: importing a freshly downloaded epub, locating a previously read book they want to revisit, and prepping the Kobo before a reading session.

The MVP serves this single user. If others adopt later, that's bonus — but no design decisions are made to accommodate strangers.

## Success Criteria

### Primary

- A freshly downloaded epub can be imported, automatically enriched with metadata (with AI fallback when the file's embedded metadata is incomplete), tagged, annotated with a Markdown note, and re-found in a future session — all without leaving the app and without manual file management.

### Secondary

- Notes are searchable by their text content (e.g., "what book did I write about Heidegger?" surfaces the matching book).
- AI-enriched cover art looks correct and never falls back to placeholder imagery when a real cover is reasonably obtainable.

### Guardrails

- **Data integrity**: notes and library state are never silently lost or corrupted — not from cloud sync conflicts, interrupted imports, partial writes, or app crashes.
- **App-independent library**: files on the cloud storage backend are organized in a human-navigable directory structure. A reader who uninstalls the app must still be able to find and open every book through the storage provider's native interface.

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

# TODO: User stories for library browsing, tag operations, note management, and trash/restore workflows — see Open Questions

## Functional Requirements

### Library import & curation

- FR-001: User can import an epub file via drag-and-drop or file picker. Priority: must-have
  > Socratic: Counter-argument considered: "drag-and-drop alone is enough; file picker is vestigial UI." Resolution: kept; file picker is cheap to include and covers the keyboard-driven import path.
- FR-002: User can have the app extract embedded metadata (title, author, cover, ISBN) from an imported epub automatically. Priority: must-have
  > Socratic: Counter-argument considered: "every epub has embedded metadata — this is table stakes, not worth specifying." Resolution: kept; the import flow's value depends on this being automatic and silent, not user-entered.
- FR-003: User can have the app propose values for missing or incomplete metadata fields using AI-assisted enrichment from external sources. Priority: must-have
  > Socratic: Counter-argument considered: "AI metadata is often subtly wrong (translated titles, mismatched editions); manual entry is faster than reviewing wrong suggestions." Resolution: kept; the confirmation gate (FR-004) absorbs the wrong-answer cost, and AI assistance is the differentiating insight from the shaping session.
- FR-004: User can confirm or reject AI-suggested metadata field-by-field before it is persisted. Priority: must-have
  > Socratic: Counter-argument considered: "if AI is good enough, the gate is friction; if AI isn't good enough, FR-003 should be dropped." Resolution: kept; metadata correctness is load-bearing for FR-008, FR-011, and FR-012, so a small friction cost buys high downstream value.
- FR-005: User can have imported epub files persisted to cloud storage in a human-navigable directory structure. Priority: must-have
  > Socratic: Counter-argument considered: "local-first persistence with sync-later would ship 1–2 weeks faster." Resolution: kept; cloud-first is load-bearing — the user already stores all their files in cloud storage, and a local-only library would be a different product.
- FR-006: User can move a book to a recoverable trash state — the file is relocated to a dedicated recovery area in cloud storage and the library no longer shows it. Priority: must-have
  > Socratic: Counter-argument considered: "trash adds storage cost and a hidden directory the user must manage; permanent deletion is simpler." Resolution: kept; recoverable deletion is consistent with the app-independent library guardrail (files remain navigable in the cloud provider's native interface).
- FR-007: User can restore a previously trashed book back into the library. Priority: must-have
  > Socratic: Counter-argument considered: "user could navigate to the recovery area via the cloud provider's interface and move the file back; in-app restore duplicates UX." Resolution: kept; restore is the natural complement to FR-006 — without it, recoverable deletion is half-finished from the user's perspective.

### Library browsing

- FR-008: User can browse the full library with each book's cover, title, and author visible at a glance. Priority: must-have
  > Socratic: Counter-argument considered: "a CLI listing of books would be enough; visual library is scope creep." Resolution: kept; the "I want to reread something" trigger moment is recall-driven, and book covers are the strongest visual recall anchor.
- FR-009: User can tag a book with one or more custom labels, and add or remove tags from a book at any time. Priority: must-have
  > Socratic: Counter-argument considered: "tags only matter if filter exists." Resolution: kept; FR-011 (filter by tag) is also kept, so the pair stands or falls together.
- FR-010: User can rename a tag globally (the rename applies to every book that carries the tag). Priority: must-have
  > Socratic: Counter-argument considered: "manually editing each book's tags is cheaper than building global-rename UI." Resolution: kept; over the library's expected multi-year lifespan, tag taxonomies drift and global rename is the small feature with outsized long-tail value.
- FR-011: User can filter the library by one or more tags. Priority: must-have
  > Socratic: Counter-argument considered: "with <50 books, scroll is faster than filter — premature optimization." Resolution: kept; the primary persona expects the library to grow well beyond 50 books over years.
- FR-012: User can search the library by title or author text. Priority: must-have
  > Socratic: Counter-argument considered: "with <50 books, scroll beats search." Resolution: kept; same scale assumption as FR-011.
- FR-013: User can open a single-book view showing the book's full metadata and its attached notes. Priority: must-have
  > Socratic: Counter-argument considered: "info could be inline in the library view." Resolution: kept; single-book view is the natural home for notes (FR-014/015/016), and inlining all of that into the library list would push row height past usable.

### Notes

- FR-014: User can write a Markdown-formatted note attached to a specific book. Priority: must-have
  > Socratic: Counter-argument considered: "why Markdown specifically and not plain text?" Resolution: kept; Markdown matches the primary persona's existing note-taking habit, and rendering it is a small added cost.
- FR-015: User can edit an existing note. Priority: must-have
  > Socratic: Counter-argument considered: "delete-and-rewrite is functionally equivalent." Resolution: kept; destroying then re-creating is hostile UX, and in-place edit is the universal expectation.
- FR-016: User can delete a note from a book. Priority: must-have
  > Socratic: Counter-argument considered: "editing the note to an empty string is functionally equivalent." Resolution: kept; explicit delete removes the empty-note artifact from future note-search (FR-017) results.
- FR-017: User can search notes by their text content; results surface the matching book. Priority: nice-to-have
  > Socratic: Counter-argument considered: "primary persona usually knows which book the note belongs to and navigates there directly; cross-note search is a power-user feature." Resolution: kept as nice-to-have only — maps to the Secondary success criterion, not in the must-have set.

### Reading

- FR-018: User can open the underlying epub file in the operating system's default epub reader from within the app. Priority: nice-to-have
  > Socratic: Counter-argument considered: "Finder/Explorer + double-click already does this; the app's button adds one click of value at best." Resolution: kept as nice-to-have only — small convenience, not load-bearing for the organization-focused MVP.

## Non-Functional Requirements

- **AI enrichment latency**: for an imported epub with metadata gaps, proposed values are presented to the user within 30 seconds of the import completing; while external knowledge sources are being consulted, the user sees continuous visible progress, not a frozen screen.
- **Privacy of book content**: no bytes of a book's body text leave the user's device for the purpose of AI enrichment or any other external query. Only metadata-shaped strings (filename, embedded title, embedded author, ISBN, front-matter strings) may be sent to external services.
- **Library responsiveness**: opening the app shows the library list within 2 seconds, even for libraries up to 1000 books. Filter and search results update within 200 milliseconds of the user's keystroke.
- **Offline tolerance**: with no network connectivity, the user can browse the library, read and edit notes, and add or remove tags. Import and AI enrichment require network and clearly indicate so when offline rather than failing silently.
- **Persistence durability**: any change the user makes (tag, note, import, trash, restore) is durable within 5 seconds; a power loss after that window cannot revert the change.

## Business Logic

When an imported epub's embedded metadata is incomplete, the app infers the missing fields by combining the file's available data with external knowledge sources, and proposes them for the user to accept, refine, or reject before they are persisted.

The rule consumes two layers of input from the file: first, the epub's embedded metadata fields (title, author, cover, ISBN) — these are authoritative whenever present. When a field is missing or empty, the rule falls back to the file's filename and any text it can read from inside the file (front matter, copyright page, table of contents) to ground its inference. External knowledge sources are then queried to produce a candidate value for each missing field.

The output is never a single committed value — it is always a *proposal* presented to the user. Each proposed field carries two affordances: (a) **provenance** — a short explanation of where the value came from (e.g., "matches 12 external sources" vs "inferred from filename only — low confidence"); and (b) **alternative suggestions** — when the rule has more than one plausible candidate for a field (e.g., three possible covers from different editions), the alternatives are surfaced so the user picks rather than re-types.

The user encounters this rule during the import flow (FR-001 → FR-005). For an epub with complete embedded metadata, the rule produces no proposals and the import is silent. For an epub with gaps, the rule's proposals appear as a review step the user resolves before the book lands in the library.

## Access Control

Single user. The app authenticates the operator against a third-party cloud storage provider via an authorization flow so it can read and write library files on the operator's behalf. The authorization flow exists for storage access, not for in-app user identity — there is no role model, no permission matrix, and no concept of "other users" inside the application. If the device is shared, OS-level user accounts are the boundary.

## Non-Goals

- **No support for non-epub formats** — PDF, MOBI, AZW, and other ebook formats are explicitly out of scope. The MVP is strict-epub-only.
- **No device sync of any kind in the MVP** — kepub conversion and device upload are deferred. The MVP does not partially implement this surface area.
- **No full-text search of book bodies** — search applies to library metadata (title, author, tags) and to note content only. Book contents stay opaque to the app's search.
- **No building or training our own AI models** — the app composes external AI and search APIs to fill metadata gaps; it does not own, fine-tune, or self-host models.
- **No multi-user features** — no sharing, social, comments, public profiles, collaborative tags, or any concept of a "second user." The app is single-user by design.
- **No mobile interface in the MVP** — web on desktop only. Mobile is not on the roadmap at all. Native desktop install is not on the roadmap either.
- **No modification of the original epub file** — the app reads metadata from epubs and catalogs them, but never rewrites the file in place. Any future format conversion writes a separate file alongside the original.
- **No offline-first guarantee** — the app provides offline tolerance (browse, read notes, tag) but does not promise full offline capability. Import and AI enrichment require network.
- **No WCAG-AA compliance or formal accessibility audit** — keyboard navigation and basic readability only; no certified accessibility commitments.

## Open Questions

1. **Additional user stories not yet drafted** — US-02 and beyond (covering library browsing, tag operations, note management, and trash/restore workflows) were not captured during shaping. Owner: user. Block: no (FRs and acceptance criteria exist; user stories are a documentation gap only).
2. **`target_scale.qps` and `target_scale.data_volume`** — not explicitly captured during shaping; inferred as `low` and `small` from the single-user web context. Override if incorrect. Owner: user. Block: no.
3. **Offline tolerance under a web form factor** — the NFR ("with no network, the user can browse the library, read and edit notes, and add or remove tags") was written when the MVP was a desktop application. Web delivery makes this materially harder (service-worker caching, IndexedDB mirror, conflict resolution). Two options: (a) keep the NFR and accept the implementation cost; (b) relax it to "requires network" for v1. Owner: user. Block: no, but resolving early affects tech-stack selection.
