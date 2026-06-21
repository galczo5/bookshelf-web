---
date: 2026-06-21T10:16:04+0200
researcher: kamil
git_commit: c68adc027a240c0d040202f0425fed43954eff48
branch: main
repository: bookshelf-web
topic: "Single Docker image bundling app + database for handoff testing"
tags: [research, codebase, docker, deployment, seed, auth, postgres]
status: complete
last_updated: 2026-06-21
last_updated_by: kamil
last_updated_note: "Added first-run onboarding-UI feasibility + locked decision set"
---

# Research: Single Docker image bundling app + database for handoff testing

**Date**: 2026-06-21T10:16:04+0200
**Researcher**: kamil
**Git Commit**: c68adc027a240c0d040202f0425fed43954eff48
**Branch**: main
**Repository**: bookshelf-web

## Research Question

> "I want to have one docker image that contains the app and database, so I can send it to someone and ask for tests."

Refined in conversation:

- App **and** Postgres bundled so the artifact is self-contained.
- **Seed on demand** (the 50-book demo dataset triggered by the tester, not necessarily baked in).
- **Testers provide their own secrets / API keys** (real Google OAuth + OpenAI; no auth bypass).
- Fallback accepted: if one image is impractical, **two images** — one shipping seed data, one empty.

## Summary

The current production `Dockerfile` builds an **app-only** image — Next.js standalone server that runs migrations then `server.js`, talking to an **external** Postgres over `DATABASE_URL`. Postgres lives only in `docker-compose.yml` (local dev) and is explicitly excluded from the prod image via `.dockerignore`. So nothing today bundles app + DB.

Three findings shape the change:

1. **App + DB in one image is feasible but is a deliberate two-process container** (anti-pattern, acceptable for a throwaway test handoff). It needs an entrypoint that runs `initdb` → start Postgres → wait healthy → migrate → (optional seed) → exec the Node server, with `tini`/`dumb-init` as PID 1. The simpler, more conventional alternative is a **two-image `docker compose` bundle** shipped as one `docker save` tarball.

2. **"Seed on demand" does not work in the production image today.** `scripts/seed.mts` is **not** compiled into `dist/` (only `migrate.mts` + migrations are — see `tsconfig.migrate.json`), and `tsx` is a **devDependency** absent from the standalone runner. The seed assets (`books.json`, `covers/`) _are_ copied into the image (the Dockerfile copies all of `scripts/`), but there is no executable form of the seeder. This is the single biggest gap to close.

3. **Seeded data is invisible without a three-way email match.** The seeder attaches books to a user row resolved by email; the middleware forces real Google OAuth and only one allowlisted email may sign in. For a tester to _see_ seeded books, `BOOKSHELF_ALLOWED_EMAIL` == the tester's Google account email == the `--email` passed to the seeder. This coupling must be documented or the "two images, one seeded" variant will appear broken.

The "one seeded / one empty" fallback is an **orthogonal axis** (seed presence) to the "app+db in one image" question (process packaging). They can be combined, but baking seed data into the image conflicts with "seed on demand" — pick one per variant.

## Detailed Findings

### Current Docker setup is app-only

- `Dockerfile:1-36` — three-stage build (`deps` → `builder` → `runner`). The runner stage copies the Next.js standalone output, `scripts/`, `dist/`, and a hand-copied `node_modules/kysely`. **No Postgres anywhere.**
- `Dockerfile:36` — `CMD ["sh", "-c", "node dist/scripts/migrate.mjs && node server.js"]`. Migrations already run on container start against whatever `DATABASE_URL` points to; the app then serves. **Migration-on-demand is solved; seed-on-demand is not.**
- `Dockerfile:18-20` — runner sets `NODE_ENV=production`, `HOSTNAME=0.0.0.0`. Relevant because the seeder refuses to run under `NODE_ENV=production` without `--force` (see below).
- `docker-compose.yml:1-21` — `postgres:18-alpine`, db/user/pass all `bookshelf`, port 5432, named volume `bookshelf_pgdata`, healthcheck via `pg_isready`. This is the only place Postgres exists.
- `.dockerignore:19` — `docker-compose.yml` is excluded from the image build context, confirming the prod image is meant to be DB-less.
- `next.config.ts:3-5` — `output: "standalone"` (so `server.js` exists) and `serverExternalPackages: ["kysely", "pg"]`.

### The seed-on-demand gap (critical)

- `scripts/seed.mts:1-29` — idempotent seeder: 50 public-domain books with covers, tags, notes. CLI entry at `scripts/seed.mts:197-228`.
- `tsconfig.migrate.json` `include` block lists **only** `scripts/migrate.mts` and `src/lib/db/migrations/**/*.mts`. **`seed.mts` is not compiled.** `npm run build:migrate` (`package.json` `build:migrate`) therefore never emits `dist/scripts/seed.mjs`.
- `package.json:69` — `"tsx": "^4"` is under `devDependencies`. `npm ci` in the `deps` stage installs it, but the standalone runner never gets it. So `tsx scripts/seed.mts` (the `db:seed` script) cannot run in the prod image either.
- **Assets are present**: `Dockerfile:28` copies all of `scripts/`, so `/app/scripts/seed/books.json` and `/app/scripts/seed/covers/*.jpg` ship in the image. Only the _executable_ form is missing.
- **Path trap if compiled**: `scripts/seed.mts:35` resolves `SEED_DIR = path.join(import.meta.dirname, "seed")`. Compiled to `dist/scripts/seed.mjs`, `import.meta.dirname` becomes `/app/dist/scripts`, so it would look for `/app/dist/scripts/seed/books.json` — which does **not** exist (assets are under `/app/scripts/seed`). Closing the gap by compiling requires _either_ adjusting `SEED_DIR` to point back at `../../scripts/seed`, _or_ copying the seed assets into `dist/scripts/seed` in the Dockerfile.
- **Dependency**: the seeder imports only `node:fs`, `node:url`, `node:path`, and `pg` (`scripts/seed.mts:30-33`) — deliberately **not** `kysely` or `@/lib/*` (`scripts/seed.mts:11-13`). `pg` is traced into the standalone bundle via `src/lib/db.ts:3`, so unlike `migrate.mjs` (which needed a hand-copied `kysely`, `Dockerfile:32`), the seeder should resolve `pg` without an extra copy — **verify at build time**.
- **Production guard**: `scripts/seed.mts:201-204` refuses when `NODE_ENV === "production"` unless `--force` is passed. The runner sets `NODE_ENV=production`, so on-demand seeding must call `... seed.mjs --force`.

Options to make seed runnable in-image (pick one during planning):

1. **Compile it** — add `scripts/seed.mts` to `tsconfig.migrate.json` `include`, fix the `SEED_DIR` path (or copy assets into `dist/scripts/seed`), invoke via `docker exec <c> node dist/scripts/seed.mjs --force --email <tester>`.
2. **Ship `tsx`** — move `tsx` to `dependencies` (or `npm i -g tsx` in the runner) and run `tsx scripts/seed.mts`. Simplest, but bloats the runtime image with the TS toolchain.
3. **Bake at build** — run the seed once during image build into a baked `PGDATA` (only viable in the all-in-one image, and only for the "seeded variant" — kills on-demand).

### The auth wall and the three-way email coupling

- `src/auth.config.ts:18-32` — middleware `authorized()` redirects **every** non-allowlisted, non-`/signin`, non-`/api/auth`, non-static route to `/signin`. There is no unauthenticated surface to browse.
- `src/auth.ts:46-52` — `signIn` callback hard-rejects any email != `BOOKSHELF_ALLOWED_EMAIL`, then `upsertUserByEmail`. Single-user by design (matches PRD "Access Control").
- `src/auth.config.ts:6-16` — Google provider with `drive.file` scope, `access_type: offline`, `prompt: consent`. Real OAuth round-trip; testers must register `http://localhost:3000/api/auth/callback/google` (or their host) in _their own_ Google Cloud project.
- `scripts/seed.mts:105-116` — seeder upserts the operator by email (`--email` or `BOOKSHELF_ALLOWED_EMAIL`, `scripts/seed.mts:70-75`) and attaches all books to that `user_id`.
- **Consequence**: for a tester to see seeded books, `BOOKSHELF_ALLOWED_EMAIL` **must equal** the Google account they sign in with **and** the seed `--email`. Mismatch → tester signs in fine but sees an empty library. This is the most likely "it's broken" support ticket for the seeded image.
- **Drive-free by design**: `scripts/seed.mts:18-21` sets `drive_file_id = NULL` so trash/restore runs the DB-only branch (`src/app/actions/books.ts`) — seeded books need no Drive credentials. Confirms a seeded image lets testers exercise browse / tags / filter / search / notes / trash-restore **without** Drive. Real epub import + AI enrichment still need live Drive + OpenAI.

### Secret surface a tester must supply

From `grep process.env` across `src`, `scripts`, and config (`.env.example:1-24`):

| Var                                          | Needed for                      | Notes                                                                                              |
| -------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                               | always                          | **Internal** in the all-in-one image (points at bundled Postgres); external in the two-image setup |
| `AUTH_SECRET`                                | always                          | Auth.js refuses to start in prod without it (`.env.example:6`)                                     |
| `AUTH_URL`                                   | non-localhost                   | Only if Auth.js can't infer the base URL behind a proxy (`.env.example:8-9`)                       |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`  | sign-in + Drive                 | `src/auth.config.ts:7-8`                                                                           |
| `BOOKSHELF_ALLOWED_EMAIL`                    | sign-in gate + seed owner       | three-way coupling above                                                                           |
| `AUTH_TOKENS_ENCRYPTION_KEY`                 | refresh-token storage           | must decode to 32 bytes; `src/lib/auth-tokens.ts:6-11`                                             |
| `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`) | AI enrichment + tag suggestions | `src/lib/enrichment/*`, `src/lib/tag-suggestions/client.ts`                                        |

A **seeded, browse-only** test needs only `DATABASE_URL` (internal), `AUTH_SECRET`, `AUTH_TOKENS_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `BOOKSHELF_ALLOWED_EMAIL` — **not** OpenAI or a Drive-authorized account. Full import→enrich→confirm additionally needs `OPENAI_API_KEY` and a Drive-authorized Google account.

## Architecture Insights

- **Packaging axis vs. seed axis are independent.** "App+DB in one image" is about _process topology_; "seeded vs empty" is about _data presence_. The user's fallback ("two images, one seeded one not") conflates them — clarify in planning which the second image varies.
- **The image is the easy part; the wiring is the cost.** The infra research's pre-mortem (`context/foundation/infrastructure.md:56-58`) already flagged that Render's "operational glue" is where time goes; the same is true here — Dockerfile authoring is half a day, but OAuth callback registration, the email coupling, and the seed-executable gap are the real friction for a handoff.
- **Ephemeral vs. persistent PGDATA.** For "send to a tester," ephemeral Postgres (fresh every `docker run`, seed-on-demand repopulates) is simpler and avoids volume management; persistent is only needed if the tester must survive restarts. Recommend ephemeral for the handoff use case.
- **Single-file delivery favors the all-in-one image.** `docker save bookshelf:test | gzip` → one `.tar.gz` the tester `docker load`s, no registry. A two-image compose either ships two saved images or relies on the tester pulling `postgres:18-alpine` from Docker Hub (fine if they have internet).
- **`infrastructure.md` "Out of Scope" explicitly excludes Docker authoring** (`context/foundation/infrastructure.md:103-105`) — so there is no prior art to inherit; this change writes the first multi-process / bundled Dockerfile.

## Candidate Approaches (for the planning step)

1. **All-in-one image (recommended for the literal ask).** Base on `node:22-alpine`, `apk add postgresql`, entrypoint orchestrates `initdb` → `pg_ctl start` → `pg_isready` wait → `node dist/scripts/migrate.mjs` → optional seed (gated by a `SEED=1` env or a `docker exec`) → `exec node server.js` under `tini`. Internal `DATABASE_URL=postgres://...@localhost`. Ship via `docker save`. **Must close the seed-executable gap first.**
2. **Two-image compose bundle (recommended for least effort / most conventional).** Keep the app image roughly as-is, add `postgres:18-alpine` (reuse `docker-compose.yml` almost verbatim but un-ignore it), ship a `compose.yaml` + a one-line `docker compose up`. Seed via `docker compose exec`.
3. **Seeded vs. empty variants (the fallback axis).** Two tags/build-args of _either_ topology above: `SEED_ON_BUILD=1` bakes the 50 books into a baked `PGDATA` for the "seeded" image; the "empty" image leaves it out. Note the conflict with on-demand seeding and the three-way email coupling.

## Code References

- `Dockerfile:1-36` — current app-only multi-stage build; `CMD` runs migrate then server
- `docker-compose.yml:1-21` — the only Postgres definition (local dev)
- `.dockerignore:19` — excludes compose from the image
- `next.config.ts:3-5` — standalone output + external `kysely`/`pg`
- `tsconfig.migrate.json` `include` — compiles migrate + migrations, **not** seed
- `package.json:69` — `tsx` is a devDependency (absent from runner)
- `scripts/seed.mts:30-35` — seed assets path (`SEED_DIR`); `:197-228` CLI entry; `:201-204` prod guard; `:70-75` email resolution; `:105-116` operator upsert; `:18-21` `drive_file_id = NULL`
- `scripts/migrate.mts:35-62` — migrate CLI entry (the on-startup pattern)
- `src/auth.config.ts:18-32` — middleware redirect wall; `:6-16` Google provider scopes
- `src/auth.ts:46-52` — single-email allowlist gate
- `src/lib/auth-tokens.ts:6-11` — `AUTH_TOKENS_ENCRYPTION_KEY` 32-byte requirement
- `src/lib/db.ts:3` — `pg` import (traces `pg` into the standalone bundle)
- `.env.example:1-24` — full secret surface with provenance notes
- `e2e/helpers/fixtures.ts:23-52` — how the e2e harness mints a session cookie to bypass OAuth (reference only; out of scope since testers use real creds)

## Historical Context (from prior changes)

- `context/foundation/infrastructure.md:103-107` — Docker image configuration was **explicitly out of scope** for the infra research; no prior Dockerfile decisions to inherit.
- `context/foundation/infrastructure.md:88` — note that Native runtime + Next.js 16 image optimization can silently disable `sharp`; using the Docker runtime is the predictable path (tangential, but relevant if cover rendering matters in the test).
- `context/foundation/tech-stack.md:33-35` — the local-dev DB-via-compose decision and the `.dockerignore` exclusion of the compose file are the design baseline this change extends.

## Related Research

None — this is the first change folder touching Docker packaging. `context/foundation/infrastructure.md` is the closest adjacent artifact (deployment platform, not image authoring).

## Open Questions

1. **Which axis does the second image vary — topology or seed?** The fallback "two images, one seeded one not" is the seed axis; confirm whether the empty image is also all-in-one or the two-image compose form.
2. **Ephemeral or persistent Postgres** in the all-in-one image? (Recommendation: ephemeral for handoff.)
3. **Resolve the seed-executable gap which way** — compile `seed.mts` into `dist` (path fix needed) vs. ship `tsx` vs. bake-at-build? (Recommendation: compile, for parity with the existing `migrate.mjs` pattern.)
4. **Is browse-only acceptable, or must import + AI enrichment work end-to-end?** The former needs no OpenAI/Drive; the latter needs the tester to fully wire a Google Cloud OAuth app + Drive-authorized account + OpenAI key. This sets the size of the tester onboarding doc.
5. **Distribution channel** — `docker save` tarball vs. a registry push? (Recommendation: `docker save` for a no-account handoff.)

## Follow-up Research 2026-06-21 — First-run onboarding UI + locked decisions

The user pivoted away from mailing a `.env` file toward a **first-run onboarding UI** that collects secrets in-browser, and resolved the open questions. This section records the feasibility findings and the locked decision set that `/10x-plan` should consume.

### Onboarding feasibility findings

- **NextAuth beta.31 supports per-request dynamic config.** `NextAuth(req => NextAuthConfig)` is a valid signature (`node_modules/next-auth/lib/index.d.ts:55`; doc example at `index.d.ts:55`). So OAuth creds _could_ be DB-sourced at request time — relevant only to the "live/no-restart" tier, which was **not** chosen.
- **Two secrets need no human input.** `AUTH_SECRET` and `AUTH_TOKENS_ENCRYPTION_KEY` (`src/lib/auth-tokens.ts:6-11`) are random bytes — the entrypoint generates + persists them on the volume on first boot. The tester never enters them.
- **The UI collects only 3 inputs + 1 identity**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`), and the owner email (`BOOKSHELF_ALLOWED_EMAIL`).
- **OpenAI key is consumed in 4 module-global clients**: `src/lib/enrichment/client.ts:19`, `src/lib/enrichment/field-agent.ts:19`, `src/lib/enrichment/language-classifier.ts:18`, `src/lib/tag-suggestions/client.ts:18`. The chosen tier leaves these untouched (they keep reading `process.env`).
- **No settings/config table exists** — not needed for the chosen tier (secrets live in a volume `.env`, not the DB).
- **Edge-runtime caveat (load-bearing).** Middleware (`src/auth.config.ts`) runs on Edge and must not touch Postgres — that is why the app splits edge config from the Node `auth.ts`. Resolution for the chosen tier: keep `AUTH_SECRET` as an entrypoint-generated **env** var (edge-readable), add `/setup` to the middleware public allowlist (`src/auth.config.ts:18-32`, one entry alongside `/api/auth`), and do the "configured?" check + redirect in a **Node-runtime** server component (e.g. the `/signin` page or a layout), not in middleware.
- **Unavoidable manual step.** The UI cannot register the Google OAuth redirect URI; the tester must paste `http://localhost:3000/api/auth/callback/google` into _their_ Google Cloud Console. Onboarding should display the exact URI + a checklist and set this expectation.

### Locked decisions (input to `/10x-plan`)

1. **Packaging — all-in-one image.** Single image: `node:22-alpine` + bundled Postgres, entrypoint orchestrates initdb → start Postgres → wait healthy → migrate → start Node, under `tini`/`dumb-init` as PID 1. Internal `DATABASE_URL` at `localhost`. Distribute via `docker save | gzip` (single-file handoff).
2. **Database data — persistent volume.** `PGDATA` and the generated-secrets file live on a named volume so imports/notes/secrets survive restarts. Reset = `docker volume rm`.
3. **First-run onboarding — write-env + restart tier (chosen).** `/setup` page (public, pre-auth) collects the 3 secrets + owner email, writes them to a `.env` file on the persistent volume; the entrypoint sources that file and (re)starts the Node process (~3s "applying settings…"). **App code keeps reading `process.env` everywhere** — `auth.ts`, `auth.config.ts`, the db layer, and all 4 OpenAI clients are unchanged. New surface area: the `/setup` page + a write server action, a "configured?" gate (Node-runtime redirect to `/setup` when the env file is absent), the middleware allowlist entry, and the entrypoint supervise/restart loop.
4. **Secret auto-provisioning.** Entrypoint generates `AUTH_SECRET` and `AUTH_TOKENS_ENCRYPTION_KEY` on first boot if absent and persists them on the volume; these are never asked of the tester.
5. **Scope — one plan covering onboarding + the all-in-one image.**

### Reconciliation note: the seed dataset

The earlier "bake seed at build" choice carried an email-coupling problem (seed owner fixed at build vs. the tester's own Google email). The onboarding pivot **dissolves that conflict**: the owner email is now a runtime value captured at `/setup`. Recommended treatment for the plan — make the 50-book demo seed **optional and post-setup**: e.g. a "Load demo data" affordance (or `SEED=1` honored by the entrypoint after configuration) that runs the seeder under the configured `BOOKSHELF_ALLOWED_EMAIL`. This still requires closing the **seed-executable gap** from the main findings (compile `seed.mts` into `dist` with the `SEED_DIR` path fix, or ship `tsx`). Confirm during planning whether demo data is wanted at all under the full-pipeline use case, or whether testers will import real epubs.

### Updated open questions

- Demo seed: keep it (optional, post-setup, under configured email) or drop it for the full-pipeline flow? (Decides whether the seed-executable gap must be closed.)
- Entrypoint restart mechanism: a shell supervise-loop that re-execs `node server.js` when the `.env` file appears/changes, vs. a tiny process manager (`s6-overlay`/`supervisord`). Recommend the minimal shell loop for a test image.
- `/setup` re-entry: should `/setup` be reachable again after configuration (to rotate keys), or one-shot? (Suggest: reachable but auth-gated post-config.)
