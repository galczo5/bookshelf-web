# All-in-One Docker Image + First-Run Onboarding — Plan Brief

> Full plan: `context/changes/all-in-one-docker-image/plan.md`
> Research: `context/changes/all-in-one-docker-image/research.md`

## What & Why

Ship Bookshelf as a single Docker image bundling the app **and** Postgres, configured entirely in-browser, so it can be `docker save`'d and handed to a tester without mailing a `.env`. The motivation: "one docker image that contains the app and database, so I can send it to someone and ask for tests."

## Starting Point

The production image is app-only (`Dockerfile:36` runs migrate + server against an **external** `DATABASE_URL`); Postgres lives only in `docker-compose.yml`, excluded from the image. The seeder isn't runnable in the image (`seed.mts` is uncompiled, `tsx` is dev-only). Auth has no unauthenticated surface, and a fresh image with no `BOOKSHELF_ALLOWED_EMAIL` has no way for anyone to sign in.

## Desired End State

A maintainer builds a multi-arch image and sends one `.tar.gz`. The tester `docker load`s it, `docker run`s it on `localhost:3000`, is redirected to `/setup`, pastes their Google + OpenAI secrets + owner email (optionally ticking "load demo data"), waits ~3s for an "applying settings…" restart, signs in with Google, and lands in a working (optionally 50-book) library. A Settings page re-opens onboarding to rotate keys. A named volume persists DB + secrets + config across restarts.

## Key Decisions Made

| Decision          | Choice                                                                 | Why (1 sentence)                                                     | Source   |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| Packaging         | All-in-one image (app + Postgres)                                      | Literal ask; single-file handoff via `docker save`                   | Research |
| Data persistence  | Named volume (PGDATA + secrets + config)                               | Imports/notes/secrets survive restarts; reset = `docker volume rm`   | Research |
| Secret delivery   | Write-env + restart tier; app keeps reading `process.env`              | No app rewrite; entrypoint sources env and restarts Node             | Research |
| Auto-secrets      | Entrypoint generates `AUTH_SECRET` + `AUTH_TOKENS_ENCRYPTION_KEY`      | Random bytes need no human input                                     | Research |
| Demo seed         | Kept; offered as a checkbox during onboarding                          | Tester sees a populated library without Drive; under their own email | Plan     |
| OpenAI key        | Required at `/setup`                                                   | Guarantees the full enrichment pipeline works                        | Plan     |
| Supervision       | Minimal shell loop under `tini`                                        | No extra deps; right weight for a throwaway test image               | Plan     |
| `/setup` re-entry | Reachable + auth-gated; Settings page re-triggers it                   | Rotate keys without nuking the volume                                | Plan     |
| Seed exec         | Refactor `seed()` into an importable module called by the setup action | No tsx/CLI in image; runs in-process, errors surface to the UI       | Plan     |
| Target host       | Fixed `localhost:3000`; `AUTH_URL` caveat for remote                   | Simplest for a single-tester handoff                                 | Plan     |
| Architecture      | Multi-arch (amd64 + arm64) via buildx                                  | Hand off without asking the tester's hardware                        | Plan     |
| Verification      | Smoke-test script + manual checklist                                   | Repeatable boot check + real-cred coverage                           | Plan     |

## Scope

**In scope:** importable seed module; `/setup` onboarding page + write-env action + optional demo seed; Node-runtime configured-gate; middleware allowlist; auth-gated Settings page; `Dockerfile.allinone` + entrypoint (initdb → PG → secrets → migrate → supervise/restart); multi-arch build; smoke test + handoff doc.

**Out of scope:** live/no-restart secret reload; config DB table; auth bypass; baking seed at build; remote-host auto-config; registry distribution; changes to the existing `Dockerfile`/App Runner path; process supervisor (s6/supervisord).

## Architecture / Approach

One image: `node:22-alpine` + Postgres + `tini` as PID 1. The entrypoint is a shell script — on first boot it `initdb`s, generates secrets to the volume, and writes a base env file; on every boot it starts Postgres, waits healthy, runs migrations, sources the volume config, and runs Node in a loop that restarts it when the config file changes. The app is unchanged except for a new `/setup` surface, a Node-runtime "configured?" redirect (the check can't run in Edge middleware), and a Settings page. The `/setup` server action writes the env file, optionally seeds, and triggers the restart.

## Phases at a Glance

| Phase                            | What it delivers                                      | Key risk                                                   |
| -------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| 1. Seed-executable refactor      | Importable `seed()` module callable from app + CLI    | Asset path (`import.meta.dirname`) must resolve at runtime |
| 2. Onboarding + Settings + gate  | `/setup`, write-env action, configured-gate, Settings | Edge vs Node runtime split for the gate                    |
| 3. All-in-one image + entrypoint | `Dockerfile.allinone` + supervise/restart entrypoint  | Two-process container; PGDATA ownership; clean restart     |
| 4. Verification & handoff        | Smoke-test script + tester onboarding doc             | Multi-arch `docker save` nuances                           |

**Prerequisites:** Docker + buildx locally; existing app build works. **Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- Two-process-in-one-container is a deliberate anti-pattern, accepted for a throwaway test image.
- Multi-arch `docker save` handoff has buildx nuances (per-arch save vs OCI layout) — to be pinned in Phase 3/4.
- The restart trigger (config-file mtime → SIGTERM → re-exec) is hand-rolled; the smoke test must cover it.
- Tester must register the OAuth redirect URI in their own Google Cloud project — unavoidable manual step.

## Success Criteria (Summary)

- A tester, given only the tarball, reaches a working signed-in library by following `handoff.md`.
- The full pipeline (import → AI enrichment → confirm) works with the tester's real credentials.
- Restart preserves data/secrets/config; `docker volume rm` gives a clean first-run.
