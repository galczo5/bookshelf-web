# Bookshelf

A personal, single-user ebook library manager. Import epubs, let AI fill in missing metadata, organize with tags, keep Markdown notes per book, and store files in a human-navigable structure on Google Drive.

Built with Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 · Postgres (Kysely) · NextAuth · OpenAI.

See [`idea.md`](idea.md) for the original brief and [`context/foundation/prd.md`](context/foundation/prd.md) for the locked PRD.

---

## Recommended: self-host with Docker

The simplest way to run Bookshelf is the **all-in-one Docker image** — a single self-contained container bundling the Next.js app _and_ Postgres. No managed database, no cloud account, no platform lock-in. You own your data on a local volume, and you can run it on a laptop, a NAS, or any box with Docker.

> **Why self-host over Render?** Bookshelf is a single-user app for _your_ library, kept for years. A managed PaaS like Render means a recurring bill (~$14–21/mo once you leave the free tier — and the free Postgres tier _expires after 30 days_), your data living on someone else's infrastructure, and OAuth/cold-start papercuts on auto-generated subdomains. Self-hosting on Docker is free, keeps your books and notes on hardware you control, and is genuinely easier to stand up. The Render path is kept below for completeness, but Docker is the recommended default.

### 1. Build the image

```sh
bash scripts/build-allinone.sh
# → bookshelf-test.tar.gz  (local arch, docker-loadable)
```

Re-run this whenever you change app code. To load a tarball someone sent you instead of building:

```sh
gunzip -c bookshelf-test.tar.gz | docker load
```

### 2. Run it

```sh
docker run -p 3000:3000 -v bookshelf-data:/data bookshelf:test
```

First boot takes ~15s (Postgres init + migrations). All state — database, secrets, config — lives on the named `bookshelf-data` volume and survives restarts.

### 3. Configure (first run only)

Open **http://localhost:3000** — you'll be redirected to `/setup`. You'll need:

- **Google OAuth client** ([Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials))
  - Type: **Web application**
  - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
- **OpenAI API key** ([platform.openai.com/api-keys](https://platform.openai.com/api-keys)) — used for metadata enrichment on import

Fill in the form, optionally tick **"Load 50-book demo dataset"**, click **Save & apply**, wait a few seconds for the restart, then sign in with the Google account matching the owner email you entered.

### Common commands

| Action                           | Command                            |
| -------------------------------- | ---------------------------------- |
| Rebuild image after code changes | `bash scripts/build-allinone.sh`   |
| Run the boot smoke test          | `bash scripts/smoke-allinone.sh`   |
| View logs                        | `docker logs -f <id>`              |
| Stop container                   | `docker stop <id>`                 |
| Restart (data persists)          | `docker restart <id>`              |
| Reconfigure keys/email           | In-app: **Settings → Reconfigure** |
| Full reset (wipes everything)    | `docker volume rm bookshelf-data`  |

### Running on a remote host

The redirect URI defaults to `localhost:3000`. To run on a VM or another machine, add that machine's URL as an additional authorized redirect URI in Google Cloud Console and pass `AUTH_URL`:

```sh
docker run -p 3000:3000 -v bookshelf-data:/data \
  -e AUTH_URL=http://192.168.1.100:3000 \
  bookshelf:test
```

### Troubleshooting

**`JWTSessionError: no matching decryption secret` in the logs** — your browser is holding a session cookie that was encrypted with a different `AUTH_SECRET` than the running container has. On first boot the container generates `AUTH_SECRET` and persists it to `/data/config.env`, so it only stays stable while the **same `/data` volume** is reattached on every run. This error means the secret changed underneath an existing cookie:

- **Most common cause:** the container was recreated without reusing the named volume (e.g. `docker run` without `-v bookshelf-data:/data`, or the volume was removed). Each fresh `/data` regenerates the secret. Always run with `-v bookshelf-data:/data` so `/data/config.env` survives.
- **Quick fix:** clear the site's cookies (or open an incognito window) and sign in again — the stale cookie is replaced by one matching the current secret. Auth.js treats an undecryptable cookie as "no session," so this is self-correcting per browser; it's noisy in logs but not a hard failure.

For more detail — prerequisites, the full OAuth walkthrough, and the handoff flow — see [`DOCKER.md`](DOCKER.md) and [`context/changes/all-in-one-docker-image/handoff.md`](context/changes/all-in-one-docker-image/handoff.md).

---

## Local development

Run the app from source against a Postgres container.

```sh
# 1. Start Postgres
docker compose up -d db

# 2. Configure environment
cp .env.example .env.local
#   then fill in AUTH_SECRET, AUTH_TOKENS_ENCRYPTION_KEY (both `openssl rand -base64 32`,
#   different values), GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, BOOKSHELF_ALLOWED_EMAIL,
#   and OPENAI_API_KEY. See .env.example for the full annotated list.

# 3. Install deps, migrate, and run
npm install
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Seed demo data** (dev only): `npm run db:seed` prefills 50 public-domain books with covers, tags, and notes. It's idempotent and leaves real imports untouched. Resolves the seed user from `--email <addr>` or `BOOKSHELF_ALLOWED_EMAIL`; needs `DATABASE_URL`.

## Testing

```sh
# Unit + integration (Vitest, against the Docker Postgres)
docker compose up -d db
createdb bookshelf_test   # one-time
DATABASE_URL=postgres://bookshelf:bookshelf@localhost:5432/bookshelf_test npm run db:migrate
npm test

# Migration idempotency replay (Postgres 18)
npm run test:migrate-replay

# End-to-end (Playwright — boots `next dev` itself, mints a session cookie)
npm run test:e2e
```

CI runs `lint`, `test:integration`, and `test:migrate-replay` on every PR. See [`context/foundation/test-plan.md`](context/foundation/test-plan.md) for the full testing strategy.

## Alternative: deploy on Render

A [`render.yaml`](render.yaml) blueprint is included if you'd rather use a managed PaaS. It provisions a Docker web service + managed Postgres and auto-deploys on merge to `main`. Set the `sync: false` env vars (`AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BOOKSHELF_ALLOWED_EMAIL`) in the dashboard after the first launch.

Be aware of the tradeoffs documented in [`context/foundation/infrastructure.md`](context/foundation/infrastructure.md): the free Postgres tier expires 30 days after creation, free web services cold-start (which blows the 30s enrichment latency target), and a realistic always-on MVP costs ~$14–21/mo. For a single-user library, **self-hosting on Docker is the better default.**

## Project layout

- `src/app/` — Next.js App Router (pages, server actions, API routes)
- `scripts/` — migrations, seeding, and the `build-allinone.sh` / `smoke-allinone.sh` Docker helpers
- `Dockerfile` — app-only image (used by Render)
- `Dockerfile.allinone` — bundled app + Postgres image (used for self-hosting)
- `context/` — product foundation docs, change history, and deployment research

## License

Personal project. No license granted for redistribution.
