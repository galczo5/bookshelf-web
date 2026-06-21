# All-in-One Docker Image + First-Run Onboarding Implementation Plan

## Overview

Ship Bookshelf as a single, self-contained Docker image bundling the Next.js app **and** Postgres, so it can be `docker save | gzip`'d and handed to a tester who configures it entirely in-browser. On first boot the image has an empty DB and no secrets; a public `/setup` page collects the tester's Google OAuth credentials, OpenAI key, and owner email, writes them to a `.env` file on a persistent volume, optionally loads the 50-book demo dataset, and (re)starts the Node process so the configured app comes up. A Settings page lets the owner re-run onboarding at any time.

This is the project's first multi-process container and first onboarding surface. The research doc (`context/changes/all-in-one-docker-image/research.md`) settled the architecture (all-in-one image, persistent volume, write-env + restart tier, secret auto-provisioning); this plan resolves the remaining solution-design decisions and sequences the work.

## Current State Analysis

- **The production image is app-only.** `Dockerfile:36` runs `node dist/scripts/migrate.mjs && node server.js` against an **external** `DATABASE_URL`. Postgres exists only in `docker-compose.yml` (local dev), which `.dockerignore:19` excludes from the image. Nothing bundles app + DB.
- **The seeder is not runnable in the image.** `tsconfig.migrate.json:13-16` compiles only `migrate.mts` + migrations into `dist/` — `seed.mts` never gets compiled, and `tsx` is a devDependency absent from the standalone runner. Seed assets (`scripts/seed/books.json`, `scripts/seed/covers/`) **do** ship (the Dockerfile copies all of `scripts/`), but there is no executable form. `SEED_DIR = path.join(import.meta.dirname, "seed")` (`scripts/seed.mts:35`) resolves relative to the script's own location, so any relocation must keep that path valid.
- **Auth is edge-split and there is no unauthenticated surface.** `middleware.ts` instantiates NextAuth from `auth.config.ts` and runs on the Edge runtime (must not touch Postgres). `auth.config.ts:19-31` redirects every non-allowlisted, non-`/signin`, non-`/api/auth`, non-static route to `/signin`. `auth.ts:46-52` hard-rejects any email != `BOOKSHELF_ALLOWED_EMAIL`. So today a fresh image with no `BOOKSHELF_ALLOWED_EMAIL` set has no way for anyone to sign in or reach any page.
- **The app reads secrets from `process.env` everywhere** — `auth.config.ts:7-8` (`GOOGLE_CLIENT_ID/SECRET`), `auth.ts:47` (`BOOKSHELF_ALLOWED_EMAIL`), `auth-tokens.ts:6` (`AUTH_TOKENS_ENCRYPTION_KEY`), and the 4 OpenAI clients (`src/lib/enrichment/client.ts`, `field-agent.ts`, `language-classifier.ts`, `src/lib/tag-suggestions/client.ts`). The "write-env + restart" tier keeps all of this unchanged — the entrypoint sources the env file and restarts Node so `process.env` is populated.
- **Two secrets need no human input.** `AUTH_SECRET` and `AUTH_TOKENS_ENCRYPTION_KEY` are random bytes (`openssl rand -base64 32`); the entrypoint generates and persists them on the volume on first boot.
- **The seeder is Drive-free by design** (`scripts/seed.mts:17-21` sets `drive_file_id = NULL`), so seeded books exercise browse/tags/search/notes/trash-restore without Drive credentials.

## Desired End State

A maintainer runs one `buildx` command to produce a multi-arch (`amd64` + `arm64`) image, `docker save | gzip`s it to a single tarball, and sends it to a tester. The tester runs `docker load` then `docker run -p 3000:3000 -v bookshelf-data:<vol> <image>`, opens `http://localhost:3000`, is redirected to `/setup`, pastes their Google client id/secret + OpenAI key + owner email (and optionally ticks "load demo data"), submits, sees an "applying settings…" screen for ~3s, then signs in with Google and lands in a populated (or empty) library. A Settings page lets them re-open onboarding to rotate keys. Restarting the container preserves DB, secrets, and config (named volume). Resetting = `docker volume rm`.

Verified by: a smoke-test script that boots the image and asserts Postgres came up, migrations ran, `/setup` is reachable pre-config, the env-write triggers a restart, and the configured app serves; plus a manual checklist for the real-credential OAuth/import path.

### Key Discoveries:

- Seed assets ship but the seeder is not executable in the image — `tsconfig.migrate.json:13-16` excludes `seed.mts`; `tsx` is dev-only (`package.json` devDependencies). This is the single biggest gap (`research.md:58-66`).
- `SEED_DIR` uses `import.meta.dirname` (`scripts/seed.mts:35`) — any relocation of the seed logic must keep the assets resolvable at runtime.
- Middleware runs on Edge and must not touch Postgres (`research.md:158`); the "configured?" check + redirect must live in a **Node-runtime** server component, and `/setup` must be added to the middleware matcher.
- The standalone bundle traces `pg` (via `src/lib/db.ts:3`) but **not** `kysely` for the migrate subpath — `Dockerfile:32` hand-copies `kysely`. The seed module imports only `node:*` + `pg`, so it needs no extra copy (`research.md:65`) — **verify at build**.
- `auth.ts` and `auth-tokens.ts` are `server-only`; the importable seed module must remain free of `server-only` and `@/lib/*` imports (`scripts/seed.mts:10-13`) so it can run from a server action and a CLI alike.

## What We're NOT Doing

- **No live/no-restart secret reload tier.** Secrets land in `process.env` via a process restart, not DB-sourced dynamic NextAuth config. (The research confirmed dynamic config is _possible_ but it was explicitly not chosen.)
- **No config/settings DB table.** Secrets live in a `.env` file on the volume, not the database.
- **No auth bypass for testers.** Real Google OAuth + the single-email allowlist stay intact; testers use their own Google Cloud project and OpenAI key.
- **No baking seed data into the image at build time.** Demo data is loaded on demand under the configured email (avoids the email-coupling problem from `research.md:43`).
- **No remote-host / proxy auto-configuration.** The image assumes `localhost:3000`; remote hosts are a documented manual `AUTH_URL` caveat, not a feature.
- **No registry distribution.** Handoff is a `docker save | gzip` tarball, not a registry push.
- **No changes to the existing App Runner / external-Postgres production path.** This image is an additive, parallel artifact for handoff testing; the existing `Dockerfile` deploy path is not the target. (See Implementation Approach for how the two coexist.)
- **No process supervisor (s6/supervisord).** A minimal shell loop under `tini` supervises the two processes.

## Implementation Approach

Build bottom-up so each phase is testable before the next depends on it:

1. **Make the seeder callable in-process** (no Docker needed to verify) — extract the seed logic into an importable module that both the existing CLI and the new `/setup` server action use.
2. **Build the onboarding + settings UI and the configured-gate** against local `docker compose db` (the app still reads `process.env`; the gate keys off the presence of the volume env file, which in dev we simulate with an env var/path).
3. **Assemble the all-in-one image** — Dockerfile + entrypoint that orchestrates Postgres, secret generation, env sourcing, migration, and the supervise/restart loop; build multi-arch.
4. **Verify and document** the handoff.

**Coexistence with the existing image:** rather than mutate the production `Dockerfile`, add a separate `Dockerfile.allinone` (and a small build helper) so the App Runner deploy path is untouched. The new image reuses the same multi-stage build for the app, then adds Postgres + a different entrypoint.

## Critical Implementation Details

- **Edge vs Node runtime for the configured-gate.** The presence check for the volume env file reads the filesystem and therefore cannot run in middleware (Edge). Put the check in a Node-runtime server component that already gates the app — the cleanest seam is `src/app/(app)/layout.tsx:11` (which already calls `auth()` and redirects) plus a redirect from the root before auth. `/setup` must be added to the `middleware.ts` matcher so it stays reachable pre-config; the existing matcher negative-lookahead (`middleware.ts:9`) excludes `api/auth`, static, and dotted paths — `/setup` needs an explicit exception there **and** must be treated as `authorized` by `auth.config.ts:19-31` when unconfigured.
- **Restart trigger sequencing.** The `/setup` server action writes the env file atomically (write temp → rename) and then signals the supervisor to restart Node. With the shell loop, the simplest robust mechanism is: write env file → write/touch a reload sentinel (or just rely on env-file mtime) → the supervise loop detects the change, sends `SIGTERM` to the Node child, waits, re-sources the env file, and re-execs `node server.js`. The server action returns immediately after the write so the browser can show "applying settings…" and poll/redirect once the server answers again.
- **Seed must run after migrations and under the configured email.** When the tester opts into demo data at `/setup`, the server action calls the seed module with the just-written `BOOKSHELF_ALLOWED_EMAIL`. Migrations have already run at container start, so the schema exists; the seed runs against the bundled Postgres over the internal `DATABASE_URL`.
- **Postgres data dir ownership.** The current runner runs as the non-root `nextjs` user (`Dockerfile:34`). Postgres `initdb`/`pg_ctl` must run as a user that owns `PGDATA` on the volume. Decide a single non-root user that owns both the app working dir and `PGDATA` (or run Postgres as a dedicated `postgres` user and the app as `nextjs`, with the entrypoint starting PG before dropping privileges). The entrypoint runs as PID-1 under `tini`; `initdb` cannot run as root, so the data dir must be `chown`ed to the Postgres-running user on first boot.

## Phase 1: Seed-Executable Refactor

### Overview

Extract the seed logic from `scripts/seed.mts` into an importable module callable from both the existing CLI and the new `/setup` server action, with seed assets resolvable at runtime. No Docker required to verify.

### Changes Required:

#### 1. Extract an importable seed module

**File**: `scripts/seed-core.mts` (new) and `scripts/seed.mts` (CLI wrapper)

**Intent**: Move the `seed(pool, email, books)` function, the `Book` type, preflight/cover helpers, and asset loading into a module with **no `server-only` and no `@/lib/*` imports**, so it can be imported by a Next.js server action without tripping the server-only guard. `scripts/seed.mts` keeps the CLI entry (arg parsing, `NODE_ENV`/`--force` guard, `DATABASE_URL` check, `Pool` creation) and imports the core. The existing `npm run db:seed` behavior is unchanged.

**Contract**: Export `async function runSeed(opts: { databaseUrl: string; email: string; force?: boolean }): Promise<{ seeded: number }>` (creates its own `Pool`, calls the existing transactional `seed()`, ends the pool) plus the lower-level `seed(pool, email, books)` for the CLI. Asset directory resolution must work from both the CLI location and the runtime image location — resolve `SEED_DIR` from the module's own `import.meta.dirname` and ensure the Dockerfile places `books.json` + `covers/` adjacent to the compiled module (see Phase 3). Keep the `drive_file_id = NULL` and `review_state = 'confirmed'` invariants.

#### 2. Make the seed module importable from app code

**File**: `src/lib/seed/index.ts` (new, thin re-export) or direct import path

**Intent**: Give the `/setup` server action a stable, app-side import surface for the seeder that doesn't reach into `scripts/`. This wrapper imports `runSeed` from the seed core and is the only thing app code references. It must remain free of `server-only` so it can be unit-tested, but it is only ever invoked from a Node-runtime server action.

**Contract**: `export async function loadDemoData(email: string): Promise<{ seeded: number }>` → calls `runSeed({ databaseUrl: process.env.DATABASE_URL!, email, force: true })`. Passes `force: true` because the runtime sets `NODE_ENV=production`.

#### 3. Keep the CLI compiled path coherent

**File**: `tsconfig.migrate.json`

**Intent**: If Phase 3 chooses to ship the seeder as compiled JS for the CLI, add `scripts/seed.mts` + `scripts/seed-core.mts` to the `include` list. If the app-side import (Phase 1 #2) is the only runtime consumer and it's bundled by Next.js, the CLI compile may be optional — decide during Phase 3 build verification. Default: include them for parity with `migrate.mts`.

**Contract**: `include` gains `scripts/seed.mts` and `scripts/seed-core.mts`; verify `npm run build:migrate` emits them and that asset paths still resolve (the assets are NOT compiled — they must be copied, see Phase 3).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc -p tsconfig.json --noEmit`
- Linting passes: `npm run lint`
- Unit/integration tests pass: `npm test`
- Existing seeder still works against Docker Postgres: `npm run db:seed -- --email test@example.com` then re-run is idempotent (exactly 50 seed books)
- `npm run build:migrate` emits the seed module without errors (if included)

#### Manual Verification:

- `runSeed`/`loadDemoData` can be imported from an app-side module without a `server-only` throw
- Seed assets resolve from the module's runtime location (spot-check the resolved `SEED_DIR`)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Onboarding (`/setup`), Settings & Configured-Gate

### Overview

Add the public-before-config `/setup` page and its write-env server action, the Node-runtime "configured?" redirect, the middleware allowlist entry, the auth-gated Settings page that re-opens onboarding, and the "applying settings…" restart UX. Developed against local `docker compose db`.

### Changes Required:

#### 1. Config file helper (read/write the volume env file)

**File**: `src/lib/config/env-file.ts` (new)

**Intent**: Centralize the path to the volume `.env` file, the "is the app configured?" check, and the atomic write. The configured check is the gate the rest of the app keys off.

**Contract**: Path comes from an env var the entrypoint sets (e.g. `BOOKSHELF_CONFIG_FILE`, default to a volume path). `export function isConfigured(): boolean` (file exists and contains the required keys), `export async function writeConfig(values: { GOOGLE_CLIENT_ID; GOOGLE_CLIENT_SECRET; OPENAI_API_KEY; OPENAI_MODEL?; BOOKSHELF_ALLOWED_EMAIL }): Promise<void>` (atomic write temp→rename, preserves entrypoint-generated `AUTH_SECRET`/`AUTH_TOKENS_ENCRYPTION_KEY`/`DATABASE_URL` already in the file). Node-runtime only.

#### 2. `/setup` page

**File**: `src/app/setup/page.tsx` (new), plus a client form component

**Intent**: Render the onboarding form: the 3 required secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`), optional `OPENAI_MODEL`, the owner email (`BOOKSHELF_ALLOWED_EMAIL`), and a "load 50-book demo dataset" checkbox. Display the exact OAuth redirect URI to register (`http://localhost:3000/api/auth/callback/google`) and a short checklist, since the UI cannot register it for the tester. When reached pre-config it's public; post-config it requires the owner session (see #5).

**Contract**: Server component shell + client form posting to the server action (#3). All three secret fields required (client + server validation); email required and validated as an email. Shows the redirect URI verbatim and the `localhost:3000` assumption.

#### 3. Write-env + optional-seed + restart server action

**File**: `src/app/actions/setup.ts` (new)

**Intent**: Validate inputs, write them to the volume env file via the config helper, optionally run the demo seed under the configured email, then trigger the Node restart so the new env is picked up. Return a signal the client uses to show "applying settings…" and redirect once the server is back.

**Contract**: `"use server"` action. Order: validate → `writeConfig(values)` → if demo opted-in, `await loadDemoData(email)` (Phase 1 #2) → trigger restart (write/touch the reload sentinel or rely on env-file mtime; the entrypoint supervise loop detects it). Must run in the Node runtime. Seeding before restart is fine — migrations already ran at container boot. On validation failure, return field errors without writing.

#### 4. Configured-gate (Node-runtime redirect)

**File**: `src/app/(app)/layout.tsx` and a root entry redirect

**Intent**: When the app is not configured, redirect into `/setup` instead of `/signin`, since `/signin` can't work without `BOOKSHELF_ALLOWED_EMAIL` + Google creds. The check runs in the Node runtime (layout/server component), not middleware.

**Contract**: At the top of the authed layout (and root), `if (!isConfigured()) redirect("/setup")` before the `auth()` call. Pre-config, every app route funnels to `/setup`; post-config, normal `/signin` flow resumes.

#### 5. Middleware allowlist + auth handling for `/setup`

**File**: `middleware.ts` and `src/auth.config.ts`

**Intent**: Keep `/setup` reachable before authentication. Add it to the middleware matcher exceptions and treat it as `authorized` in `auth.config.ts` so the Edge redirect doesn't bounce it to `/signin`.

**Contract**: `middleware.ts:9` matcher gains a `setup` exclusion (alongside `api/auth`); `auth.config.ts:21-29` `authorized()` returns `true` for `pathname.startsWith("/setup")`. Post-config re-entry protection is enforced in the Node-runtime page (#2/#6), not the Edge middleware.

#### 6. Settings page (re-run onboarding)

**File**: `src/app/(app)/settings/page.tsx` (new)

**Intent**: Give the signed-in owner a place to re-open onboarding to rotate keys or change the email. Links to `/setup` (which, post-config, is auth-gated). Add a sidebar entry.

**Contract**: Auth-gated (lives under `(app)`, inherits the layout gate). Post-config, `/setup` requires the owner session: the `/setup` page checks `isConfigured()` and, if true, requires `auth()` (redirect to `/signin` if not signed in) before rendering — pre-fills nothing sensitive (secrets are write-only). A "reconfigure" affordance routes the owner to `/setup`.

#### 7. "Applying settings…" client UX

**File**: setup form client component

**Intent**: After submit, show a brief "applying settings…" state and redirect to `/signin` (or `/`) once the restarted server responds.

**Contract**: On successful action return, poll a lightweight endpoint or retry navigation until the server answers post-restart (~3s), then navigate. No infinite spinner — show an error with a retry after a timeout.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc -p tsconfig.json --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass for the config helper (`isConfigured`/`writeConfig` round-trip, required-key validation): `npm test`
- Build passes: `npm run build`

#### Manual Verification:

- With no config file present, hitting any route redirects to `/setup` (against local `docker compose db`)
- Submitting `/setup` with a missing required secret shows a field error and writes nothing
- Submitting valid values writes the env file atomically and (with the checkbox) seeds 50 books under the given email
- Post-config, `/setup` requires the owner session; unauthenticated access bounces to `/signin`
- Settings page reachable when signed in; "reconfigure" routes to `/setup`
- The redirect URI shown matches `http://localhost:3000/api/auth/callback/google`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: All-in-One Image + Entrypoint Supervision

### Overview

Author `Dockerfile.allinone` and an entrypoint that bundles Postgres with the app: initdb → start Postgres → wait healthy → generate/persist `AUTH_SECRET` + `AUTH_TOKENS_ENCRYPTION_KEY` → source the volume env file (if present) → migrate → supervise the Node process with restart-on-env-change, all under `tini` as PID 1. Build multi-arch.

### Changes Required:

#### 1. All-in-one Dockerfile

**File**: `Dockerfile.allinone` (new)

**Intent**: Reuse the existing multi-stage app build, then in the runner stage add Postgres, `tini`, the seed assets at the runtime-resolvable location, the entrypoint script, and a persistent volume mount point for `PGDATA` + the config/secrets env file. Internal `DATABASE_URL` points at `localhost`.

**Contract**: Base `node:22-alpine`; `apk add --no-cache postgresql postgresql-contrib tini su-exec` (or equivalent). Copy standalone output, `dist/`, `node_modules/kysely`, and seed assets into the location `seed-core.mts` resolves (`books.json` + `covers/` adjacent to the compiled/bundled seed module — verify the resolved path). Declare `VOLUME` for the data dir (PGDATA + `config.env`). `ENTRYPOINT ["tini","--","/app/entrypoint.sh"]`. `EXPOSE 3000`. Do **not** modify the existing `Dockerfile`. Verify at build that the standalone bundle resolves `pg` for the seed path without an extra copy (research flagged `pg` is traced; `kysely` is not).

#### 2. Entrypoint orchestration + supervise loop

**File**: `entrypoint.sh` (new)

**Intent**: One shell script that brings up the whole stack and supervises Node. On first boot it initializes the data dir, generates secrets, and writes the base env (`DATABASE_URL`, generated secrets) to the volume config file. On every boot it starts Postgres, waits for `pg_isready`, runs migrations, sources the config file, and runs Node under a loop that restarts it when the config file changes.

**Contract**: Sequence — ensure `PGDATA` ownership; `initdb` if absent (as the Postgres user via `su-exec`); `pg_ctl start`; wait `pg_isready`; generate `AUTH_SECRET`/`AUTH_TOKENS_ENCRYPTION_KEY` into the volume config file if absent; export `DATABASE_URL=postgres://bookshelf:bookshelf@localhost:5432/bookshelf`; `node dist/scripts/migrate.mjs`; then a loop: source the config file, `node server.js &`, wait on either the Node PID or a config-file change (mtime poll or `inotifyd` if available), on change `SIGTERM` Node, wait, re-loop. `tini` reaps zombies. Trap signals to stop both PG and Node cleanly on container stop.

#### 3. Multi-arch build helper

**File**: `scripts/build-allinone.sh` (new) or documented command

**Intent**: One command to build the image for `linux/amd64` + `linux/arm64` via `docker buildx` and save it as a gzipped tarball for handoff.

**Contract**: `docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile.allinone -t bookshelf:test .` plus the `docker save bookshelf:test | gzip > bookshelf-test.tar.gz` step (note buildx multi-platform images require `--output`/load nuances — document the working invocation, e.g. building per-arch then `docker save` of the local arch, or pushing to a temporary OCI layout).

### Success Criteria:

#### Automated Verification:

- Image builds for the local arch: `docker build -f Dockerfile.allinone -t bookshelf:test .`
- Multi-arch build succeeds: `docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile.allinone -t bookshelf:test .`
- Container boots and Postgres becomes ready (covered by Phase 4 smoke test)

#### Manual Verification:

- `docker run -p 3000:3000 -v bookshelf-data:<voldir> bookshelf:test` boots; logs show initdb (first run), PG ready, migrations applied, Node serving
- First boot generates `AUTH_SECRET` + `AUTH_TOKENS_ENCRYPTION_KEY` on the volume; they persist across `docker restart`
- DB data + config survive `docker stop`/`start`; `docker volume rm` resets to a fresh first-run
- Container stops cleanly (both PG and Node terminate) without orphaned processes

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Verification & Handoff

### Overview

Provide a repeatable smoke-test script for the boot/restart/seed path, a manual checklist for the real-credential OAuth/import path, and a tester onboarding doc covering OAuth registration, `docker load`/`run`, and the `localhost:3000` caveat.

### Changes Required:

#### 1. Smoke-test boot script

**File**: `scripts/smoke-allinone.sh` (new)

**Intent**: Boot the image in a throwaway container and assert the critical path mechanically, so future Dockerfile/entrypoint edits don't silently regress.

**Contract**: Runs the container with a temp volume; asserts (with retries/timeouts): Postgres reachable inside the container, `migrate.mjs` ran (a known table exists), `/setup` returns 200 pre-config, posting valid config writes the env file and triggers a restart, the app serves post-restart, and (optionally) demo seed produced 50 books. Tears down container + volume. Exit non-zero on any failure.

#### 2. Tester onboarding doc

**File**: `context/changes/all-in-one-docker-image/handoff.md` (new) or `docs/`

**Intent**: A short, copy-pasteable guide the tester follows: prerequisites (Docker, a Google Cloud OAuth client, an OpenAI key), `docker load`, `docker run` with the volume and port, the exact redirect URI to register, the `/setup` walkthrough, the `localhost:3000` assumption (+ the `AUTH_URL` caveat for remote hosts), and how to reset (`docker volume rm`).

**Contract**: Markdown checklist. Names every secret the tester must supply and where to get it; states OpenAI is required; documents the demo-data option.

#### 3. Distribution step

**File**: documented in `handoff.md` / `scripts/build-allinone.sh`

**Intent**: The maintainer-side `docker save | gzip` command and the resulting single-file artifact name, so the handoff is one tarball with no registry.

**Contract**: `docker save bookshelf:test | gzip > bookshelf-test.tar.gz`; tester runs `gunzip -c bookshelf-test.tar.gz | docker load`.

### Success Criteria:

#### Automated Verification:

- Smoke test passes end-to-end: `bash scripts/smoke-allinone.sh`
- Smoke test fails loudly when the entrypoint is broken (verified by temporarily breaking the env path)

#### Manual Verification:

- A clean run-through of `handoff.md` on a second machine (or fresh Docker context) reaches a signed-in, working library
- Full pipeline with real creds: import an epub → AI enrichment proposals appear → confirm → book lands in library
- Demo-data path: opting in at `/setup` yields a 50-book browsable library without Drive
- Remote-host caveat: setting `AUTH_URL` allows sign-in from a non-localhost host (spot-check)

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- Config helper: `isConfigured()` true/false by file presence + required keys; `writeConfig()` atomic round-trip; preserves generated secrets already in the file.
- Setup action validation: missing required secret → field error, no write.
- Seed module: `runSeed`/`loadDemoData` importable without `server-only` throw; idempotency preserved (50 books).

### Integration Tests:

- Seeder against Docker Postgres via the new module path (parity with existing `db:seed`).
- Migration + seed sequence against a fresh schema.

### Manual Testing Steps:

1. Fresh `docker run` → redirected to `/setup`.
2. Submit incomplete form → field error, nothing written.
3. Submit valid form with demo-data ticked → "applying settings…" → restart → sign in with Google → 50-book library visible.
4. Import a real epub → enrichment proposals → confirm → book appears.
5. `docker restart` → DB, secrets, config persist.
6. Open Settings → reconfigure → `/setup` requires owner session.
7. `docker volume rm` → next run is a clean first-run.

## Performance Considerations

- First boot pays `initdb` + migration cost (a few seconds); subsequent boots skip `initdb`. The "applying settings…" restart is ~3s. None are hot paths; acceptable for a test image.
- Multi-arch build is slower (emulation) but is a one-time maintainer cost.

## Migration Notes

- No schema migration introduced by this change beyond what already exists; the entrypoint runs the standard `migrate.mjs` at boot.
- The existing production `Dockerfile` and App Runner path are untouched (new artifact is `Dockerfile.allinone`).

## References

- Research: `context/changes/all-in-one-docker-image/research.md`
- Current image: `Dockerfile:1-36`; local Postgres: `docker-compose.yml:1-21`
- Seeder: `scripts/seed.mts:35` (asset path), `:105-194` (transactional seed), `:196-228` (CLI entry)
- Migrate-on-boot pattern: `scripts/migrate.mts:33-63`
- Auth gate: `middleware.ts:1-11`, `src/auth.config.ts:18-33`, `src/auth.ts:46-52`
- Secret surface: `.env.example:1-24`; encryption key: `src/lib/auth-tokens.ts:5-15`
- Node-runtime gate seam: `src/app/(app)/layout.tsx:10-20`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Seed-Executable Refactor

#### Automated

- [x] 1.1 Type checking passes: `npx tsc -p tsconfig.json --noEmit` — d02ea15
- [x] 1.2 Linting passes: `npm run lint` — d02ea15
- [x] 1.3 Unit/integration tests pass: `npm test` — d02ea15
- [ ] 1.4 Existing seeder still works and is idempotent against Docker Postgres
- [x] 1.5 `npm run build:migrate` emits the seed module without errors — d02ea15

#### Manual

- [ ] 1.6 `runSeed`/`loadDemoData` importable from app code without a `server-only` throw
- [ ] 1.7 Seed assets resolve from the module's runtime location

### Phase 2: Onboarding (`/setup`), Settings & Configured-Gate

#### Automated

- [x] 2.1 Type checking passes: `npx tsc -p tsconfig.json --noEmit` — 69a9499
- [x] 2.2 Linting passes: `npm run lint` — 69a9499
- [x] 2.3 Config-helper unit tests pass: `npm test` — 69a9499
- [x] 2.4 Build passes: `npm run build` — 69a9499

#### Manual

- [ ] 2.5 No config file → every route redirects to `/setup`
- [ ] 2.6 Missing required secret → field error, nothing written
- [ ] 2.7 Valid submit writes env atomically and (with checkbox) seeds 50 books
- [ ] 2.8 Post-config `/setup` requires owner session; unauth bounces to `/signin`
- [ ] 2.9 Settings page reachable when signed in; reconfigure routes to `/setup`
- [ ] 2.10 Redirect URI shown matches `http://localhost:3000/api/auth/callback/google`

### Phase 3: All-in-One Image + Entrypoint Supervision

#### Automated

- [x] 3.1 Image builds for local arch: `docker build -f Dockerfile.allinone -t bookshelf:test .` — 0a80f9b
- [x] 3.2 Multi-arch buildx build succeeds — 0a80f9b
- [ ] 3.3 Container boots and Postgres becomes ready (via Phase 4 smoke test)

#### Manual

- [ ] 3.4 `docker run` boots; logs show initdb (first run), PG ready, migrations, Node serving
- [ ] 3.5 First boot generates and persists `AUTH_SECRET` + `AUTH_TOKENS_ENCRYPTION_KEY`
- [ ] 3.6 DB + config survive `docker stop`/`start`; `docker volume rm` resets
- [ ] 3.7 Container stops cleanly with no orphaned processes

### Phase 4: Verification & Handoff

#### Automated

- [x] 4.1 Smoke test passes end-to-end: `bash scripts/smoke-allinone.sh` — a46f792
- [x] 4.2 Smoke test fails loudly when the entrypoint is broken — a46f792

#### Manual

- [x] 4.3 Clean `handoff.md` run-through reaches a working signed-in library — a46f792
- [ ] 4.4 Full pipeline with real creds: import → enrich → confirm → library
- [ ] 4.5 Demo-data opt-in yields a 50-book browsable library without Drive
- [ ] 4.6 Remote-host `AUTH_URL` caveat verified
