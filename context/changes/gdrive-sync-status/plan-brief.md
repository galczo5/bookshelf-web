# Drive Sync Status — Plan Brief

> Full plan: `context/changes/gdrive-sync-status/plan.md`

## What & Why

Users can manually drop epub files into the Google Drive `Bookshelf/` folder, or a Drive file can be externally deleted — in both cases the app shows nothing. This change adds a background Drive sync check that surfaces both problem types: untracked epubs (on Drive, not in DB) and missing files (in DB, gone from Drive). Users get a proactive warning with actionable paths to resolve each issue.

## Starting Point

Every confirmed book has a `drive_file_id` pointing to its working copy in `Bookshelf/` root on Drive. The Drive folder structure (`Bookshelf/`, `Original files/`, `Trash/`, `Backups/`) and the Drive client infrastructure (`getDriveClient`, `getOrCreateLibraryFolder`) are already in place. There is no code that lists Drive folder contents and compares them against DB records.

## Desired End State

A dismissible banner on the library page shows a count of Drive sync issues whenever they exist. The Settings page gains a "Drive Sync" card with last-checked time, a per-file Import button for untracked Drive files, and a per-book Mark as broken button for books with missing Drive files. The scan runs automatically in the background on library page load (24h cooldown, results cached in DB), and results are visible immediately after the background fetch resolves via `router.refresh()`.

## Key Decisions Made

| Decision            | Choice                                                | Why (1 sentence)                                                                                                | Source |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| Sync scope          | Both untracked files AND missing Drive files          | Complete sync picture; both problem types are actionable                                                        | Plan   |
| Trigger timing      | Auto on library page load, 24h cooldown               | Proactive notification without hammering Drive API; matches existing backup pattern                             | Plan   |
| Result persistence  | New `drive_sync_checks` DB table                      | Survives server restarts; allows "last checked" display in Settings; avoids Drive API call on every page render | Plan   |
| UI placement        | Library banner (indicator) + Settings card (detail)   | Banner gives immediate visibility; Settings card keeps the library page clean and provides full action controls | Plan   |
| Import flow         | Full review flow with AI enrichment                   | Reuses the entire existing pipeline; user confirms metadata before anything is persisted                        | Plan   |
| Missing file action | Warn + "Mark as broken" (clear drive_file_id)         | Actionable without destructive auto-magic; keeps DB clean; user can re-import later                             | Plan   |
| Drive scan scope    | Root Bookshelf/ folder only                           | One Drive API call; no false positives from Original files/ or Trash/; covers the expected use case             | Plan   |
| Source file cleanup | Delete source Drive file on successful confirm-review | Prevents re-import of the same file re-appearing as "untracked" on the next scan                                | Plan   |
| Testing             | No automated tests this change; update test plan      | Per user decision — scope later in test plan                                                                    | Plan   |

## Scope

**In scope:**

- `drive_sync_checks` DB table (migration 0009) + `source_drive_file_id` on `book_drafts`
- `src/lib/drive/sync-check.ts` — Drive root listing + DB comparison logic
- `src/lib/drive/run-sync-check.ts` — 24h cooldown orchestrator (stale + force variants)
- `src/app/api/drive-sync/trigger/route.ts` — POST trigger endpoint
- `src/app/components/drive-sync-trigger.tsx` — client component (useEffect + router.refresh)
- `src/app/components/drive-sync-banner.tsx` — dismissible library banner
- Library page (`src/app/(app)/page.tsx`) — sync query + trigger + banner wiring
- `src/app/actions/drive-sync.ts` — three server actions (force rescan, import, mark broken)
- Settings page (`src/app/(app)/settings/page.tsx`) — new Drive Sync card
- `src/app/actions/confirm-review.ts` — post-confirm source Drive file deletion

**Out of scope:**

- Scanning `Original files/`, `Trash/`, `Backups/` subfolders
- Automated test coverage (deferred to test plan)
- Drive API pagination beyond 1000 files
- Sync detection for trashed books

## Architecture / Approach

The scan is a three-step comparison: (1) `drive.files.list` on the Bookshelf root folder, (2) DB query for confirmed books' `drive_file_id` values, (3) set difference in both directions. Results are stored in `drive_sync_checks`. The library page reads the cached results at render time (no Drive API call) and mounts a client trigger that POSTs to the API route and calls `router.refresh()` when done. Settings page reads the same cached row plus book titles for the missing-book list.

A subtle edge case: when importing a Drive file, the source file stays in Drive root until confirm-review completes. `source_drive_file_id` on `book_drafts` carries the file ID forward so confirm-review can delete it on success. The sync-check query also excludes pending drafts' `source_drive_file_id` values from the "untracked" list.

## Phases at a Glance

| Phase                       | What it delivers                                                                        | Key risk                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1. DB Foundation            | `drive_sync_checks` table + `source_drive_file_id` on `book_drafts`; DB types + helpers | Migration conflicts with existing drafts (there are none — `book_drafts` rows are transient)                  |
| 2. Scan Logic + API Route   | Drive listing comparison + 24h orchestrator + `/api/drive-sync/trigger`                 | Drive API quota or auth edge cases during scan                                                                |
| 3. Library Page Integration | Auto-trigger + banner; library page query                                               | `router.refresh()` race if user navigates away before trigger completes (safe — just a stale banner)          |
| 4. Settings Card + Actions  | Force rescan, import-from-Drive, mark-broken; full Settings UI                          | Import action: downloading epub bytes server-side from Drive is a new code path; needs careful error handling |
| 5. Confirm-Review Cleanup   | Source Drive file deleted on successful confirm                                         | Non-fatal if delete fails; file remains as orphan until user triggers a rescan                                |

**Prerequisites:** Existing Drive OAuth + client infrastructure (`drive-oauth-and-client` change) must be deployed.  
**Estimated effort:** ~3-4 sessions across 5 phases.

## Open Risks & Assumptions

- Drive API `files.list` with `pageSize: 1000` may not return all files if a user has > 1000 files in Bookshelf root. Pagination not implemented in this change.
- The 24h cooldown means sync issues from the last 24h window aren't visible until the cooldown expires or the user clicks "Refresh now."
- `getOrCreateLibraryFolder` creates the folder if it doesn't exist — the first scan on a new account will create the `Bookshelf/` folder as a side effect.

## Success Criteria (Summary)

- Manually adding an epub to the Drive Bookshelf folder causes the library banner to appear (within one page load + background scan cycle)
- Clicking Import from the Settings card creates a draft and redirects to `/review/[id]` with metadata pre-filled; confirming removes the source Drive file and resolves the sync warning
- Clicking Mark as broken clears `drive_file_id` on the book and removes it from the sync warning list
