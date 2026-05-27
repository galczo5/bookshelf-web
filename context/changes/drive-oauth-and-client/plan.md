# Drive OAuth and Drive API Client Implementation Plan

## Overview

Wire Google Drive OAuth into the Next.js 16 app using Auth.js v5 (Google provider, `drive.file` scope), persist the refresh token encrypted in Postgres, expose a server-only Drive API client wrapper, and prove the loop end-to-end with a connection check. Single-user enforcement via an `BOOKSHELF_ALLOWED_EMAIL` env var. This is foundation work (roadmap F-01) — every Drive-touching slice downstream (S-01 import, S-09 trash-move, S-10 restore) consumes the client surface this change defines.

## Current State Analysis

- **Bare Next.js 16 scaffold.** `src/app/` contains only `layout.tsx`, `page.tsx`, `globals.css`, `favicon.ico`. No auth library, no DB driver, no Google SDK in `package.json` (deps: `next@16.2.6`, `react@19.2.4`).
- **Postgres provisioned, unused.** `render.yaml` declares `bookshelf-db` (free Postgres, Frankfurt) and pipes `DATABASE_URL` into the web service via `fromDatabase`. The app has zero connection code.
- **Render deploy is live.** Docker runtime, Frankfurt, free tier, autoDeploy from `main`. The `bookshelf-web` service exists; `*.onrender.com` URL is what Google will see on the OAuth redirect.
- **`scripts/worker.mjs`** is a placeholder that's no longer wired in `render.yaml` (worker was dropped in commit `7e7d29c` for free-tier testing). The Drive client surface must remain callable from a future worker without depending on request scope.
- **No test framework, no E2E rig** — per CLAUDE.md, automated tests are not configured; `npm run lint`, `npm run build` are the only checks today.
- **PRD §Access Control is single-user.** OAuth is for storage access, not in-app identity. No role model, no multi-user concept. The user confirmed staying single-user for F-01; multi-user will be a post-MVP PRD pass.

## Desired End State

After this change ships:

1. Visiting any route on the deployed app while unauthenticated redirects to `/signin`, which renders a "Sign in with Google" button.
2. The OAuth round-trip with Google succeeds, the consent screen requests only the `drive.file` scope (no `drive` full scope, no profile fields beyond email/name), and on return the operator lands on `/`.
3. If the signed-in Google account's email does NOT match `BOOKSHELF_ALLOWED_EMAIL`, sign-in is rejected and the operator returns to `/signin` with a "not authorized" banner.
4. The refresh token is stored in Postgres in the `auth_tokens` table, encrypted with AES-256-GCM keyed off `AUTH_TOKENS_ENCRYPTION_KEY`. It survives process restarts and re-deploys.
5. From `/`, a "Check Drive connection" button calls `drive.about.get` server-side via the wrapped client and renders the operator's Drive email + storage quota. This proves the access-token → refresh → API-call chain.
6. If the refresh fails (invalid_grant, revoked token), the next Drive call clears the session and redirects to `/signin?expired=1` with a "Drive connection expired — reconnect" banner.

Verification: a fresh deploy with the right env vars set lets the operator sign in, see their Drive email rendered on `/`, sign out, sign back in, and have a stable session across at least one full access-token expiry (1 hour).

### Key Discoveries:

- **Auth.js v5 + App Router requires a split edge/node config.** The middleware that gates routes must be edge-safe (no `pg`, no Node-only imports); the full auth config — with DB-touching callbacks — runs only on Node-runtime API routes. Pattern: `src/auth.config.ts` (edge-safe, just providers + `authorized` callback) imported by both `middleware.ts` and `src/auth.ts` (Node-only, full callbacks).
- **`access_type=offline` + `prompt=consent` is non-negotiable on first auth.** Google only returns a `refresh_token` on the very first user consent unless `prompt=consent` is set, forcing the consent screen even on re-auth. Without this, refresh is impossible and the operator is forced to re-sign-in every hour.
- **`drive.about.get` works under `drive.file` scope** for user identity + storage quota (verified in Google's API docs: about.get is documented as available with any Drive scope including `drive.file`). This is the right connection-check call — listing files would not work because `drive.file` only sees app-created files.
- **`*.onrender.com` triggers Google's "unverified app" warning.** Infrastructure.md flags this; for solo use, clicking through "Advanced → proceed" is acceptable. Custom domain + Google verification is a post-MVP polish.
- **Render free-tier web service spins down after 15min idle** (30-60s cold start). The OAuth redirect could land on a cold instance; this is acceptable for solo use but flagged.
- **Render Postgres free tier expires 30 days after creation.** This affects whether the auth_tokens table survives a long break — per infrastructure.md Risk Register, budget $7/mo for paid Postgres before relying on persistence across months.

## What We're NOT Doing

- **No `Bookshelf/` root folder creation in Drive.** That's S-01's responsibility (epub-import-to-drive). F-01 ships the OAuth + client only; folder/layout decisions wait.
- **No file upload, no file move, no file list.** Connection-check via `about.get` is the only Drive API call this change introduces.
- **No multi-user features.** PRD stays single-user; the schema is keyed off `email` for forward-flexibility but there is no users table, no signup flow, no role model.
- **No real migration tooling.** The `auth_tokens` table is created via an idempotent `CREATE TABLE IF NOT EXISTS` on first DB access; F-02 (`library-data-schema`) owns the migration framework decision. This change does not pre-empt it.
- **No PRs preview environments, no staging.** Render free tier auto-deploys `main` straight to production; this is consistent with the existing deploy flow.
- **No Google Workspace verification / annual security assessment.** Out of scope per Drive scope choice (`drive.file` is non-sensitive).
- **No Drive event subscriptions, push notifications, or change watches.** Pull-only API access.
- **No custom domain wiring.** Stays on `*.onrender.com`; "unverified app" warning is accepted.
- **No password / magic-link / non-Google auth.** Google OAuth is the only sign-in surface.
- **No replacement of `src/app/page.tsx`'s product UI beyond the auth shell.** The Next.js demo content is removed and replaced with a thin "you're signed in as X, check Drive" panel; real library UI lands in S-03.

## Implementation Approach

Two phases, each independently verifiable:

**Phase 1** delivers the OAuth round-trip end-to-end: Auth.js v5 wired into the App Router, split edge/node config so middleware stays edge-safe, Google provider with `drive.file` scope, `signIn` callback enforcing the allow-list, `jwt` callback persisting and rotating the refresh token through an encrypted Postgres table, and a minimal sign-in / authenticated-shell UI. At the end of Phase 1, the operator can sign in, see their email on `/`, and sign out. No Drive API calls yet.

**Phase 2** layers the Drive client on top: a server-only `getDriveClient()` factory using `googleapis`, a typed `checkDriveConnection()` helper, a button on `/` that invokes it via a server action, and the `DriveAuthError` → clear-session → redirect-to-`/signin?expired=1` recovery path for invalid_grant. At the end of Phase 2, a complete sign-in → Drive call → session-expired recovery loop is testable.

## Critical Implementation Details

- **Refresh-token capture timing.** Google returns a `refresh_token` only on the *very first* consent unless the authorization request includes `prompt=consent`. The Google provider config in `src/auth.ts` must set `authorization.params.access_type='offline'` and `authorization.params.prompt='consent'`. Without these, re-auth on a previously-consented account returns no refresh token and the app silently breaks an hour later.
- **JWT callback runs Node-only.** Mark the `[...nextauth]` route handler as `export const runtime = 'nodejs'` to allow `pg` access inside the `jwt` callback. The middleware uses only the edge-safe `auth.config.ts` (providers + `authorized` callback); it must NOT import `src/auth.ts` directly.
- **Refresh-rotation ordering.** When a fresh access token is needed: (1) read encrypted refresh token from `auth_tokens`, (2) POST to `https://oauth2.googleapis.com/token` with `grant_type=refresh_token`, (3) if response contains a new `refresh_token`, write it back to `auth_tokens` BEFORE returning the new JWT (Google does sometimes rotate refresh tokens), (4) if the POST fails with HTTP 4xx, set `token.error = 'RefreshAccessTokenError'` and return — the session callback exposes this so the Drive client wrapper detects it and triggers sign-out.
- **AES-256-GCM key handling.** `AUTH_TOKENS_ENCRYPTION_KEY` is a base64-encoded 32-byte key. Generate locally with `openssl rand -base64 32`. Store in Render as a `sync: false` env var. Use Node's `crypto.createCipheriv('aes-256-gcm', key, iv)` with a fresh random 12-byte IV per encryption; persist `iv || ciphertext || authTag` together as a single `bytea` column.
- **Allow-list lives in `signIn` callback, not middleware.** Middleware checks "is there a session"; the `signIn` callback decides whether to *create* one. Failing in `signIn` returns `false`, which causes Auth.js to redirect to `/signin?error=AccessDenied`.

## Phase 1: Auth.js + Google OAuth round-trip with Postgres token persistence

### Overview

Stand up Auth.js v5 with Google provider, the `/signin` page, middleware-driven redirect for unauthenticated routes, allow-list enforcement, and encrypted refresh-token persistence to Postgres. The end state: the operator can sign in, the session survives an access-token expiry via refresh, and the refresh token is durable across restarts.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the libraries this change needs and pin runtime to Node ≥ 22 (already set, leave as-is). Also rename `name` from `bootstrap-scaffold` to `bookshelf` while we're here (CLAUDE.md flags this as a leftover from bootstrap).

**Contract**:
- Add to `dependencies`: `next-auth@^5.0.0` (Auth.js v5; check current stable when installing — was beta-late-2025, GA expected by 2026), `pg@^8`, `googleapis@^144`.
- Add to `devDependencies`: `@types/pg@^8`.
- Change `"name": "bootstrap-scaffold"` → `"name": "bookshelf"`.

#### 2. Edge-safe auth config

**File**: `src/auth.config.ts`

**Intent**: Define the minimal Auth.js config that middleware can import without dragging Node-only deps (`pg`) into the edge runtime. Contains only the Google provider declaration and the `authorized` callback used by middleware to gate routes.

**Contract**: `default export` of `NextAuthConfig` shape with two pieces:
- `providers: [Google({ clientId, clientSecret, authorization: { params: { scope: 'openid email profile https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent' } } })]`
- `callbacks.authorized({ auth, request })` — returns `true` if `auth?.user` exists OR the path is in `['/signin', '/api/auth']` OR is a Next internal/static path; redirects to `/signin` otherwise.

#### 3. Full Auth.js config (Node-only)

**File**: `src/auth.ts`

**Intent**: Extend the edge config with DB-touching callbacks (`signIn` allow-list, `jwt` persistence + refresh rotation, `session` exposure). Export `auth`, `signIn`, `signOut`, `handlers` for use by route handlers and server actions.

**Contract**:
- Imports `auth.config.ts` as base.
- Calls `NextAuth({ ...authConfig, session: { strategy: 'jwt' }, callbacks: { ...authConfig.callbacks, signIn, jwt, session } })`.
- `signIn({ user })`: returns `user.email === process.env.BOOKSHELF_ALLOWED_EMAIL`; rejection causes Auth.js to redirect to `/signin?error=AccessDenied`.
- `jwt({ token, account })`: on initial sign-in (`account` present), stash `access_token`, `expires_at`, `refresh_token` into the token; persist `refresh_token` to Postgres via `saveRefreshToken(token.email, account.refresh_token)`. On subsequent invocations, if `Date.now() < expires_at * 1000`, return token as-is; else refresh via Google's token endpoint (see Critical Implementation Details above), updating `token.access_token`, `token.expires_at`, and writing any rotated refresh token back to DB.
- `session({ session, token })`: exposes `session.user.email`, `session.error` (string | undefined).
- File starts with `import 'server-only'`.

**Contract snippet** (non-obvious refresh rotation):

```ts
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const refreshToken = await getRefreshToken(token.email as string);
    if (!refreshToken) throw new Error("no refresh token in DB");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const refreshed = await res.json();
    if (!res.ok) throw refreshed;
    if (refreshed.refresh_token) {
      await saveRefreshToken(token.email as string, refreshed.refresh_token);
    }
    return {
      ...token,
      access_token: refreshed.access_token,
      expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}
```

#### 4. Auth route handler

**File**: `src/app/api/auth/[...nextauth]/route.ts`

**Intent**: Mount Auth.js's request handler at `/api/auth/*` so Google OAuth callbacks, sign-in, and sign-out routes work. Force Node runtime because the JWT callback uses `pg`.

**Contract**:
- `export const runtime = 'nodejs'`.
- `export { GET, POST } = handlers` (re-exported from `@/auth`).

#### 5. Middleware

**File**: `middleware.ts` (repo root)

**Intent**: Run Auth.js's middleware against the edge-safe config so any unauthenticated request to a non-public path is redirected to `/signin`.

**Contract**:
- `import authConfig from '@/auth.config'; import NextAuth from 'next-auth'; export const { auth: middleware } = NextAuth(authConfig); export default middleware;`
- `export const config = { matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)'] };` — matches everything except `/api/auth/*`, Next internals, and files with extensions.

#### 6. Postgres pool

**File**: `src/lib/db.ts`

**Intent**: Provide a single lazily-instantiated `pg.Pool` keyed off `DATABASE_URL`, server-only, reused across requests in dev (Next.js HMR) and production.

**Contract**:
- Exports `pool: Pool` and `query(text, params)`.
- Uses a `globalThis._pgPool` cache pattern to survive Next.js dev-mode module reloads.
- Connection string from `process.env.DATABASE_URL`; throws at first use if unset.

#### 7. Encrypted auth-tokens store

**File**: `src/lib/auth-tokens.ts`

**Intent**: Encrypt the refresh token at rest in Postgres with AES-256-GCM keyed off `AUTH_TOKENS_ENCRYPTION_KEY`. Single function-level abstraction that hides the crypto from the rest of the codebase.

**Contract**:
- `ensureAuthTokensTable()` — idempotent `CREATE TABLE IF NOT EXISTS auth_tokens (email TEXT PRIMARY KEY, refresh_token_ciphertext BYTEA NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`. Called once per server boot via top-level `await` in this module.
- `getRefreshToken(email: string): Promise<string | null>` — SELECT + decrypt.
- `saveRefreshToken(email: string, plaintext: string): Promise<void>` — UPSERT with fresh IV per call.
- `clearRefreshToken(email: string): Promise<void>` — DELETE.
- Encryption format: `Buffer.concat([iv(12B), authTag(16B), ciphertext])`.
- Module starts with `import 'server-only'`.

**Contract snippet** (AES-256-GCM helpers — non-obvious IV/authTag layout):

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const key = Buffer.from(process.env.AUTH_TOKENS_ENCRYPTION_KEY!, "base64");
function encrypt(plain: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}
function decrypt(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
```

#### 8. Sign-in page

**File**: `src/app/signin/page.tsx`

**Intent**: Single-purpose entry page rendering a "Sign in with Google" button and surface banners for `?error=AccessDenied` and `?expired=1`. Server component; the button is a `<form action={...}>` invoking a server action that calls `signIn('google')`.

**Contract**:
- Reads `searchParams` (Next.js 16 App Router async API).
- Renders banner conditional on `?error=AccessDenied` ("This Google account is not authorized for this Bookshelf instance.") or `?expired=1` ("Your Drive connection expired — reconnect to continue.").
- Sign-in form posts to a server action that calls `await signIn('google', { redirectTo: '/' })`.

#### 9. Authenticated shell on /

**File**: `src/app/page.tsx`

**Intent**: Replace the Next.js demo content with a thin authenticated shell: shows the operator's email and a Sign Out form. The "Check Drive connection" button is added in Phase 2.

**Contract**:
- Server component; reads `const session = await auth()` (returns the operator's session).
- Renders "Signed in as `{session.user.email}`" and a Sign Out button (server-action form calling `signOut({ redirectTo: '/signin' })`).
- Placeholder text "Drive: connection check coming in Phase 2." until Phase 2 lands.

#### 10. Layout metadata cleanup

**File**: `src/app/layout.tsx`

**Intent**: Update the scaffold-defaulted `title`/`description` so the browser tab and any social previews say "Bookshelf" instead of "Create Next App".

**Contract**: `metadata.title = 'Bookshelf'`, `metadata.description = 'Personal ebook library manager.'`. Body and font wiring unchanged.

#### 11. Env-var documentation

**File**: `.env.example` (new)

**Intent**: Single canonical list of required env vars with one-line guidance for each. Read by the operator (and by future contributors) when setting up local dev or a fresh Render service.

**Contract**: Documents:
- `DATABASE_URL=postgres://...` — provided by Render at deploy; in dev, point at a local Postgres or the Render external URL.
- `AUTH_SECRET=...` — output of `openssl rand -base64 32`. Auth.js refuses to start in production without this.
- `AUTH_URL=https://your-app.onrender.com` — only required if Auth.js can't infer the base URL (production, behind proxy). Dev uses `http://localhost:3000` by default.
- `GOOGLE_CLIENT_ID=...` — from Google Cloud Console > Credentials > OAuth 2.0 Client IDs.
- `GOOGLE_CLIENT_SECRET=...` — same place.
- `BOOKSHELF_ALLOWED_EMAIL=you@example.com` — only this email may sign in.
- `AUTH_TOKENS_ENCRYPTION_KEY=...` — output of `openssl rand -base64 32` (different value from `AUTH_SECRET`).

#### 12. Render env wiring

**File**: `render.yaml`

**Intent**: Declare all new env vars on the `bookshelf-web` service. Secrets use `sync: false` so Render's dashboard requires manual entry (never committed); non-secrets stay inline.

**Contract**: Adds under `services[0].envVars`:
- `AUTH_SECRET` with `generateValue: true` (Render generates and persists a value).
- `AUTH_URL` with `sync: false` (set manually to `https://<service>.onrender.com` after first deploy).
- `GOOGLE_CLIENT_ID` with `sync: false`.
- `GOOGLE_CLIENT_SECRET` with `sync: false`.
- `BOOKSHELF_ALLOWED_EMAIL` with `sync: false`.
- `AUTH_TOKENS_ENCRYPTION_KEY` with `generateValue: true`.

#### 13. Google Cloud Console setup (manual, one-time, documented)

**File**: append a short "Google OAuth setup" section to `context/changes/drive-oauth-and-client/notes.md` (new file in this change folder; not committed to the long-term docs tree).

**Intent**: Capture the dashboard clicks the operator must do before the first deploy works — not code, but load-bearing for the change to function. Belongs in the change folder so it's discoverable from the plan but doesn't pollute the long-term docs tree.

**Contract**: documents:
- Create a Google Cloud project (or reuse).
- Enable the Google Drive API.
- Configure OAuth consent screen as External, testing mode, with the operator's Gmail in test users. Scopes: only `.../auth/drive.file`, `openid`, `email`, `profile`.
- Create an OAuth 2.0 Client ID, type "Web application", authorized redirect URI: `https://<service>.onrender.com/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for dev).
- Copy Client ID + Secret into Render's dashboard env vars.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds with the new auth wiring (TypeScript strict mode passes).
- `npm run lint` passes (no ESLint errors).
- A repository search for `import 'server-only'` confirms `src/auth.ts` and `src/lib/auth-tokens.ts` carry the directive (prevents accidental client-bundle inclusion).
- `grep -r 'prompt.*consent' src/auth.config.ts` returns a match (refresh-token capture safeguard).

#### Manual Verification:

- Sign in flow works locally: `npm run dev`, visit `http://localhost:3000` → redirected to `/signin` → click button → Google consent screen shows only `drive.file` + identity scopes → grant → land on `/` showing my email.
- Allow-list rejection works: temporarily change `BOOKSHELF_ALLOWED_EMAIL` to a different address, attempt sign-in, observe redirect to `/signin?error=AccessDenied` with the banner.
- Sign-out works: click Sign Out → redirected to `/signin` → session cookie cleared (verify in DevTools).
- Refresh rotation works after access-token expiry: sign in, wait ≥ 1 hour (or manually shrink token expiry to 1 min for the test), refresh `/` — session still valid, no re-sign-in prompt. Check the `auth_tokens` row's `updated_at` if Google rotated the refresh token.
- Postgres durability: sign in, restart the Next.js dev server, refresh `/` — still signed in (cookie holds the JWT; refresh token in DB survives restart).
- Production deploy: push to `main`, Render auto-deploys, set the `sync: false` env vars in Render dashboard, hit the live URL, complete sign-in. "Unverified app" warning expected; click through.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: Drive client wrapper + connection check + session-expired recovery

### Overview

Build the server-only Drive client wrapper that every downstream slice (S-01, S-09, S-10) will import. Wire a connection-check call (`drive.about.get`) into the `/` page via a server action button. Add the `DriveAuthError` recovery path so callers get clean session-cleared redirects when the refresh token is dead.

### Changes Required:

#### 1. Drive auth errors

**File**: `src/lib/drive/errors.ts`

**Intent**: Typed error for the "refresh failed / no valid token" case so server actions and route handlers can detect it specifically (vs. generic Drive API errors) and trigger sign-out.

**Contract**: `export class DriveAuthError extends Error { code = 'DRIVE_AUTH_ERROR' as const }`. No other fields.

#### 2. Drive client factory

**File**: `src/lib/drive/client.ts`

**Intent**: Single entry point — `getDriveClient()` — that any server-side caller imports to obtain an authenticated `drive_v3.Drive` instance. Internally pulls the session, checks for `RefreshAccessTokenError`, throws `DriveAuthError` if anything's off; otherwise constructs an `OAuth2Client` with the access token and returns `google.drive({ version: 'v3', auth })`.

**Contract**:
- `export async function getDriveClient(): Promise<drive_v3.Drive>`
- Calls `await auth()` (Auth.js session helper).
- Throws `DriveAuthError` if no session, no `access_token`, or `session.error === 'RefreshAccessTokenError'`.
- Constructs `new google.auth.OAuth2()`, sets credentials with `{ access_token }`, returns `google.drive({ version: 'v3', auth: oauth2Client })`.
- File starts with `import 'server-only'`.

#### 3. Connection check

**File**: `src/lib/drive/connection-check.ts`

**Intent**: One shaped Drive call that proves the loop end-to-end. Returns the operator's Drive email + storage quota — visible enough to confirm "I'm talking to the right Drive account."

**Contract**:
- `export async function checkDriveConnection(): Promise<{ email: string; displayName?: string; storageQuotaGB?: number }>`.
- Calls `await drive.about.get({ fields: 'user(displayName,emailAddress),storageQuota(limit,usage)' })`.
- Normalizes byte counts to GB rounded to 1 decimal.
- Throws `DriveAuthError` if `getDriveClient()` threw; otherwise propagates Google API errors as-is for now (downstream slices will refine).

#### 4. Server action for the button

**File**: `src/app/actions/check-drive.ts` (new directory under app/)

**Intent**: Wrap `checkDriveConnection()` for invocation from a `<form>` on the home page. Handles `DriveAuthError` by calling `signOut` + redirecting to `/signin?expired=1`.

**Contract**:
- `'use server'` at top.
- `export async function checkDriveAction(): Promise<{ ok: true; result: ConnectionCheckResult } | { ok: false; message: string }>`.
- Wraps `checkDriveConnection()` in try/catch. On `DriveAuthError`: `await signOut({ redirect: false }); redirect('/signin?expired=1');`. On other errors: return `{ ok: false, message: err.message }`.

#### 5. Wire the button onto /

**File**: `src/app/page.tsx` (update from Phase 1)

**Intent**: Replace the "Drive: connection check coming in Phase 2" placeholder with a real form + server action that shows the result inline.

**Contract**:
- Add a `<form action={checkDriveAction}>` with a submit button "Check Drive connection".
- On result: render the operator's Drive email + storage quota in a small panel; on error: render the message in red.
- This page becomes the manual smoke-test surface for every future Drive-touching slice.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds with the new Drive client wiring.
- `npm run lint` passes.
- `grep -r 'server-only' src/lib/drive/` returns a match for `client.ts` (prevents accidental client bundling of `googleapis`).
- The contract of `getDriveClient()` is exercised by importing `src/lib/drive/client.ts` from `src/app/actions/check-drive.ts` — a compile-time check that the module graph is correct.

#### Manual Verification:

- Click "Check Drive connection" while signed in → renders my Drive email + storage quota matching what I see in `drive.google.com`.
- Click while signed out (force expired session by deleting cookie) → redirect to `/signin?expired=1` with the expired banner visible.
- Simulate revoked refresh token: in Google Account > Security > Third-party apps, revoke Bookshelf, click the connection-check button → redirect to `/signin?expired=1`.
- Re-sign-in after revocation works: complete OAuth again, button works again, `auth_tokens` row has a fresh ciphertext (`updated_at` advanced).
- Production: deploy, sign in via the live URL, click the button, see my Drive email — proves redirect URI, env vars, and SSL all line up.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before considering this change complete.

---

## Testing Strategy

### Unit Tests

None in this change. No test framework is configured (CLAUDE.md flags this); introducing one is a separate decision that should land alongside F-02's migration tooling or as its own change. The crypto helpers in `auth-tokens.ts` are the only logic worth unit-testing in this change, and they're small enough that manual round-trip verification suffices.

### Integration Tests

None automated. The OAuth round-trip is inherently a live-Google test (Google's consent screen can't be mocked at the network layer without significant scaffolding). Manual verification steps cover the surface.

### Manual Testing Steps

End-to-end smoke test, in order:

1. Local dev: `npm run dev`, hit `localhost:3000` while unauthenticated → redirected to `/signin`.
2. Click "Sign in with Google" → consent screen lists only `drive.file` + identity. Grant.
3. Land on `/`, see "Signed in as <my-email>" and the Check Drive button.
4. Click Check Drive → see my Drive email + storage quota.
5. Sign out → redirected to `/signin`.
6. Re-sign-in → works without a second consent (refresh token used silently).
7. Allow-list rejection: change `BOOKSHELF_ALLOWED_EMAIL` env var to a different address, try to sign in → `/signin?error=AccessDenied` banner.
8. Revoke in Google Account > Third-party apps, click Check Drive → `/signin?expired=1` banner.
9. Sign in again after revocation → works, fresh refresh token persisted.
10. Production deploy: push `main`, set the `sync: false` env vars in Render dashboard, repeat steps 1–8 against the live URL. "Unverified app" warning expected — click through "Advanced → proceed."

## Performance Considerations

The PRD NFR "library responsiveness — opening the app shows the list within 2s" does not apply to this change (no library yet). The PRD NFR "AI enrichment latency — proposed values within 30s" is downstream of this change.

The only relevant performance concern is **Render free-tier cold start (30-60s)**. If the user hits `/` after the service has spun down, the cold start could blow OAuth callback timeouts. This is a known infrastructure-level risk (infrastructure.md Risk Register, row 2); mitigation lives at the infrastructure layer (upgrade to Starter plan), not this code. Document but don't address.

`googleapis` is a heavyweight server-side dep (~10MB on disk). Marked `import 'server-only'` so it never enters the client bundle; Next.js tree-shakes server-only modules out of the client chunk regardless.

## Migration Notes

No data migration required (no prior data exists). The `auth_tokens` table is created on first server boot via `CREATE TABLE IF NOT EXISTS`. When F-02 lands real migration tooling, that migration framework should adopt this table (rename / re-declare cleanly, no data loss because the row is recreatable via re-sign-in).

## References

- Roadmap entry: `context/foundation/roadmap.md` F-01
- PRD §Access Control, FR-005: `context/foundation/prd.md`
- Infrastructure risks (OAuth `*.onrender.com` warning, cold-start, Postgres free-tier expiry): `context/foundation/infrastructure.md`
- Tech stack hand-off: `context/foundation/tech-stack.md`
- Hard rules (PRD-stack openness, archive immutability): `CLAUDE.md`
- Auth.js v5 split-config pattern: `https://authjs.dev/getting-started/migrating-to-v5` (verify when implementing)
- Google Drive OAuth scopes reference: `https://developers.google.com/drive/api/guides/api-specific-auth` (verify when implementing)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auth.js + Google OAuth round-trip with Postgres token persistence

#### Automated

- [ ] 1.1 `npm run build` succeeds with the new auth wiring (TypeScript strict mode passes)
- [ ] 1.2 `npm run lint` passes (no ESLint errors)
- [ ] 1.3 Repository search for `import 'server-only'` confirms `src/auth.ts` and `src/lib/auth-tokens.ts` carry the directive
- [ ] 1.4 `grep -r 'prompt.*consent' src/auth.config.ts` returns a match (refresh-token capture safeguard)

#### Manual

- [ ] 1.5 Sign-in flow works locally — redirected to `/signin`, Google consent shows only `drive.file` + identity, land on `/` with email rendered
- [ ] 1.6 Allow-list rejection works — different email → `/signin?error=AccessDenied` banner
- [ ] 1.7 Sign-out works — redirects to `/signin`, session cookie cleared
- [ ] 1.8 Refresh rotation works after access-token expiry — session survives ≥ 1 hour without re-sign-in
- [ ] 1.9 Postgres durability — sign in, restart server, still signed in (refresh token persisted)
- [ ] 1.10 Production deploy works on Render with `sync: false` env vars set; "unverified app" warning click-through accepted

### Phase 2: Drive client wrapper + connection check + session-expired recovery

#### Automated

- [ ] 2.1 `npm run build` succeeds with the new Drive client wiring
- [ ] 2.2 `npm run lint` passes
- [ ] 2.3 `grep -r 'server-only' src/lib/drive/` returns a match for `client.ts`
- [ ] 2.4 `src/app/actions/check-drive.ts` imports `src/lib/drive/client.ts` and compiles (module graph correctness)

#### Manual

- [ ] 2.5 "Check Drive connection" while signed in renders Drive email + storage quota matching `drive.google.com`
- [ ] 2.6 Click while session is force-expired → redirect to `/signin?expired=1` with banner
- [ ] 2.7 Revoke in Google Account > Third-party apps, click button → redirect to `/signin?expired=1`
- [ ] 2.8 Re-sign-in after revocation works; `auth_tokens.updated_at` advances
- [ ] 2.9 Production: deploy, sign in via live URL, click button, see Drive email — full loop end-to-end
