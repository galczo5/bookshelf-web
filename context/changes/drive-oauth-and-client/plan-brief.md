# Drive OAuth and Drive API Client — Plan Brief

> Full plan: `context/changes/drive-oauth-and-client/plan.md`

## What & Why

Wire Google Drive OAuth into the Next.js 16 app so the operator can authenticate and the app can call the Drive API on their behalf. This is roadmap F-01 — foundation work that unlocks every Drive-touching slice downstream (S-01 epub import, S-09 trash-move, S-10 restore). Without this, none of those slices can write a single byte to the user's library.

## Starting Point

Bare Next.js 16 scaffold — only `src/app/{layout,page,globals.css}`, no auth library, no DB driver, no Google SDK. Render deploy is live (Docker, Frankfurt, free tier, autoDeploy from `main`), with a free Postgres instance (`bookshelf-db`) provisioned and `DATABASE_URL` wired in but not yet used. There's no test framework, no E2E rig — `npm run lint` and `npm run build` are the only checks today.

## Desired End State

The operator signs in with Google, lands on `/` showing their Drive email and storage quota fetched via a real `drive.about.get` call. Refresh tokens are persisted encrypted in Postgres and survive across deploys. If the refresh token is revoked or expires, the next Drive call cleanly clears the session and redirects to `/signin?expired=1`. Only the email matching `BOOKSHELF_ALLOWED_EMAIL` can sign in. The `getDriveClient()` surface is in place for S-01 to import.

## Key Decisions Made

| Decision                       | Choice                                          | Why (1 sentence)                                                                                                              | Source |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| F-01 scope boundary            | OAuth + Drive client + `about.get` connection check; no `Bookshelf/` folder creation | Keeps F-01 narrow and forces S-01 to own its own folder-layout decision per the roadmap.                                       | Plan   |
| OAuth library                  | Auth.js v5 (NextAuth) with Google provider     | Battle-tested for App Router; one dep replaces hand-rolled session + CSRF + PKCE + refresh code; large LLM training surface. | Plan   |
| Drive OAuth scope              | `drive.file` (non-sensitive)                   | No Google verification gauntlet; matches PRD §Access Control intent of "storage for this app only."                          | Plan   |
| Token storage                  | Encrypted refresh token in Postgres + JWT session cookie | Survives restarts; usable by future background worker; refresh token off the wire on client.                                   | Plan   |
| Single-user enforcement        | Allow-list env var `BOOKSHELF_ALLOWED_EMAIL`   | One env var, one if-statement, fully explicit; PRD stays single-user, multi-user revisit is post-MVP.                         | Plan   |
| Refresh-failure recovery       | Clear session, redirect to `/signin?expired=1` with banner | Eliminates zombie partially-authenticated state; critical for the planned background worker.                                   | Plan   |
| Multi-user pivot               | Stay single-user for F-01; revisit post-MVP    | PRD belongs to the doc-generation chain; multi-user is a roadmap-shaping change deserving its own PRD pass.                  | Plan   |
| Migration tooling              | Ad-hoc `CREATE TABLE IF NOT EXISTS` for `auth_tokens` | F-02 owns the migration-framework decision; this change does not pre-empt it. Parallel work stays parallel.                   | Plan   |

## Scope

**In scope:**
- Auth.js v5 wired into the App Router with edge/node split config
- Google provider with `drive.file` scope, `access_type=offline`, `prompt=consent`
- `signIn` callback allow-list against `BOOKSHELF_ALLOWED_EMAIL`
- `jwt` callback with refresh-rotation through Postgres
- AES-256-GCM encryption of the refresh token at rest
- `/signin` page with sign-in button and `?error=AccessDenied` / `?expired=1` banners
- Middleware redirecting unauthenticated routes to `/signin`
- `getDriveClient()` factory returning an authenticated `googleapis` Drive v3 instance
- `checkDriveConnection()` calling `drive.about.get` and rendering the result on `/`
- Render env-var wiring + `.env.example`
- Manual Google Cloud Console setup notes in the change folder

**Out of scope:**
- `Bookshelf/` root folder creation in Drive (lands in S-01)
- File upload, list, move, or any Drive operation other than `about.get`
- Multi-user features, role model, signup flow
- Real migration framework (F-02's job)
- Custom domain + Google verification + annual security assessment
- PR preview environments / staging (stays single-environment per existing setup)
- Test framework introduction
- Non-Google auth providers

## Architecture / Approach

```
Browser → /any-route → middleware (edge) → not authenticated → /signin
                          ↓ authenticated
                       Server Component or Server Action
                          ↓
                       auth() → session.user.email + access_token
                          ↓
                       getDriveClient()  (lib/drive/client.ts, server-only)
                          ↓ googleapis
                       drive.about.get / files.create / ...

JWT lifecycle:
  Initial sign-in → signIn callback (allow-list) → jwt callback (persist refresh_token to auth_tokens)
  Access-token expiry → jwt callback re-runs → fetch refresh_token from auth_tokens
                     → POST oauth2.googleapis.com/token → new access_token (+ maybe rotated refresh_token)
                     → write rotated refresh_token back to auth_tokens
                     → return updated JWT
  Refresh failure → token.error='RefreshAccessTokenError' → session callback exposes it
                 → getDriveClient() throws DriveAuthError → action signs out → /signin?expired=1
```

Split config: `src/auth.config.ts` (edge-safe, used by `middleware.ts`) holds providers + `authorized` callback only. `src/auth.ts` (Node-only, marked `import 'server-only'`) extends it with the DB-touching `signIn`/`jwt`/`session` callbacks. The `[...nextauth]` route forces `runtime = 'nodejs'`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Auth.js + Google OAuth + Postgres token persistence | OAuth round-trip works end-to-end; allow-list enforces single-user; refresh rotation through encrypted Postgres survives restarts | Forgetting `access_type=offline` + `prompt=consent` → no refresh token → session breaks every 1h |
| 2. Drive client wrapper + connection check + expired-session recovery | `getDriveClient()` is the typed import every downstream slice consumes; `checkDriveConnection()` proves the full loop; revoked refresh → clean redirect | `drive.about.get` permissions under `drive.file` scope — needs verification at first run; `*.onrender.com` "unverified app" warning expected |

**Prerequisites:**
- Google Cloud project with the Drive API enabled and an OAuth 2.0 Web Client ID created (manual one-time, documented in the change folder).
- Render dashboard access to set `sync: false` env vars after first deploy.
- A second Google account (or test user) handy for the allow-list-rejection manual test.

**Estimated effort:** ~1-2 evening sessions. Phase 1 is the bulk; Phase 2 is small once the auth surface is in place.

## Open Risks & Assumptions

- **Auth.js v5 stable release status.** Plan assumes v5 is GA-or-stable-enough at install time (was beta-late-2025). If still beta, pin to a specific beta version and revisit on GA.
- **`drive.about.get` under `drive.file` scope.** Google docs indicate `about.get` works with any Drive scope, but field-level access may be restricted. If `storageQuota` is denied under `drive.file`, fall back to `user(emailAddress)` only — still proves the round-trip.
- **Render free-tier 30-day Postgres expiry** (infrastructure.md Risk Register). If the project sits dormant for a month, the DB disappears and the `auth_tokens` table goes with it. Mitigation: pay for Starter Postgres ($7/mo) before any data matters; for now, accept that re-sign-in re-populates the row.
- **Render free-tier cold start (30-60s).** OAuth callback could time out on a cold instance. Solo-use risk only; upgrade to Starter plan if it bites.
- **`*.onrender.com` triggers Google's "unverified app" warning.** Accepted for solo use; click-through "Advanced → proceed" works. Custom domain + Google verification is a post-MVP polish.

## Success Criteria (Summary)

- Operator can sign in, see their Drive email and storage quota on `/`, and re-find this state across deploys.
- An unauthorized email cannot sign in; `/signin?error=AccessDenied` banner is visible.
- A revoked refresh token results in `/signin?expired=1` with the banner, not a silent failure or zombie session.
- `getDriveClient()` is the single import path used by every downstream slice; no slice has to know about Auth.js callbacks or token storage.
