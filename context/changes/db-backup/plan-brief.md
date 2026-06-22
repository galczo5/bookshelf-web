# DB Backup to Google Drive — Plan Brief

> Full plan: `context/changes/db-backup/plan.md`

## What & Why

Add a daily automated backup of library data to Google Drive so the user can recover from accidental deletion, data corruption, or a failed migration without losing books, notes, or tags. The backup runs silently in the background on first page load of each day (if data changed) and is accessible for manual restore from Settings.

## Starting Point

The app has no scheduling or backup infrastructure. Google Drive folder/upload primitives exist (`src/lib/drive/`), the DB is Kysely + PostgreSQL with 7 migrations and all table interfaces in `src/lib/db.ts`. The Settings page is a minimal single-card server component ready to extend.

## Desired End State

A `Bookshelf/Backups/` folder in Google Drive accumulates daily JSON snapshots (capped at 30). The Settings page shows last backup time, any failure banner, and a history list with restore buttons. Clicking Restore on any entry opens a confirmation dialog and replaces the user's library data with that snapshot.

## Key Decisions Made

| Decision             | Choice                                                             | Why (1 sentence)                                                          | Source |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------ |
| Scheduling mechanism | On-access check via client component                               | Zero added infra; works with the single-process Next.js setup             | Plan   |
| Change detection     | `backups` DB table tracking `backed_up_at` + timestamp comparison  | Durable across restarts; doubles as history for restore UI                | Plan   |
| Backup format        | JSON (one object per table)                                        | Human-readable, no `pg_dump` dependency, easy selective restore           | Plan   |
| Scope                | `books`, `tags`, `book_tags`, `notes`                              | Library data only — `auth_tokens`, `users`, `book_drafts` excluded        | Plan   |
| `cover_bytes`        | Include as base64                                                  | Self-contained backup; covers restored without re-fetching                | Plan   |
| Restore strategy     | Wipe-and-replace in a DB transaction                               | Clean slate — backup is the truth; user confirms before proceeding        | Plan   |
| Drive location       | `Bookshelf/Backups/` subfolder                                     | Consistent with existing folder strategy; human-navigable without the app | Plan   |
| Retention            | Keep last 30                                                       | One month of daily history; bounded Drive storage                         | Plan   |
| Error handling       | Store error in `backups` table; surface warning banner in Settings | Non-intrusive; user sees status without being blocked mid-session         | Plan   |

## Scope

**In scope:**

- `backups` DB table (migration + Kysely interface)
- JSON export and wipe-and-replace restore (pure JS, no pg_dump)
- `Bookshelf/Backups/` Drive folder and file upload/prune
- Fire-and-forget auto-trigger via client component in app layout
- Protected `/api/backup/trigger` route
- Backup card in Settings with history list, error banner, "Back up now"
- Restore flow with AlertDialog confirmation

**Out of scope:**

- Backup of epub/kepub files in Drive (already there)
- `auth_tokens`, `users`, `book_drafts` tables
- External cron / scheduling infrastructure
- Incremental backup
- Diff/preview before restore
- Backup encryption

## Architecture / Approach

A `"use client"` `BackupTrigger` component mounts in the app layout and fires a fire-and-forget POST to `/api/backup/trigger`. The route calls `runBackupIfNeeded(userId, email)` which checks a module-level in-memory lock + the `backups` table (last run within 24h + data-change check) before calling `runBackup`. `runBackup` exports JSON, uploads to Drive, prunes, and records the result. Restore downloads the Drive file by ID and runs a Kysely transaction: delete → insert in FK order.

## Phases at a Glance

| Phase             | What it delivers                                 | Key risk                                                             |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| 1. DB Migration   | `backups` table in DB + Kysely types             | None — standard migration pattern                                    |
| 2. Backup Library | Export, restore, and orchestrator logic          | `cover_bytes` base64 round-trip; FK ordering for restore transaction |
| 3. Auto-Trigger   | Daily backup fires on first page load            | Race condition between concurrent tabs — mitigated by in-memory lock |
| 4. Settings UI    | Backup card with status, history, "Back up now"  | None significant                                                     |
| 5. Restore Flow   | AlertDialog + server action completing the cycle | Must scope restore by `user_id` to prevent cross-user access         |

**Prerequisites:** Working Google Drive OAuth (already in place); `DATABASE_URL` set.
**Estimated effort:** ~2-3 sessions across 5 phases.

## Open Risks & Assumptions

- Tag renames and book-tag deletions won't trigger change detection (no `updated_at` on those operations) — they'll be captured at the next daily window regardless.
- If the Drive token expires mid-backup, `DriveAuthError` is caught and recorded as an error row; the user will see the banner but won't be signed out (unlike interactive flows).
- Backup file size scales with cover image count — 100 books × 150 KB base64 covers = ~15 MB per backup file; acceptable but worth monitoring.

## Success Criteria (Summary)

- A JSON backup file appears in `Bookshelf/Backups/` in Drive on first daily page load without user action
- Settings page shows last backup time and surfaces a warning if the last run failed
- Restoring a backup replaces library data cleanly and the library view reflects it immediately
