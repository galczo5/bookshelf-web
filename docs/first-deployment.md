# First Deployment

Plan for getting Bookshelf onto Render for the first time. Target platform decision and rationale live in `context/foundation/infrastructure.md`; this doc is the executable plan.

## Checklist

**You do (one-time, local + accounts):**

- [X] Install the Render CLI on your Mac
- [X] Create a Render account (sign in with GitHub so the repo connection is one click later)
- [X] Run `render login` and confirm the CLI is authenticated
- [X] Generate a Render API key (dashboard → Account Settings → API Keys) and copy it to your password manager
- [X] Wire the Render MCP into Claude Code (one command, see below)
- [X] Pick a service region — **Frankfurt**
- [X] Decide on a custom domain now or later — **later**; use Render's free `*.onrender.com` subdomain for first deploy (revisit before Google OAuth verification)

**Agent does (after the above):**

- [X] Add `"engines": { "node": ">=22" }` to `package.json`
- [X] Write `render.yaml` at repo root declaring `bookshelf-web`, `bookshelf-worker`, `bookshelf-db` — region `frankfurt`, Docker runtime
- [X] Confirm Docker runtime vs. Native runtime choice with you — **Docker** (confirmed)
- [X] Push the branch and open a PR with the blueprint
- [ ] After merge, run `render blueprint launch` (or trigger via MCP) and watch the first build
- [ ] Verify the web service responds, the worker is running idle, and the Postgres connection string is wired into both
- [ ] Enable automated daily Postgres backups in the dashboard (one toggle; the agent will remind you)
- [ ] Record the resulting service IDs and URLs in `context/deployment/deploy-plan.md`

**You do (after first deploy is green):**

- [ ] Sanity-check the deployed URL in a browser
- [ ] Confirm auto-deploy-on-merge is enabled in the Render dashboard for `main`
- [ ] (Later, before Google OAuth) point a custom domain at the web service

---

## What to install on your computer

Only one tool is strictly required for the agent to drive the deployment.

### 1. Render CLI

```sh
brew install render-oss/render/render
render --version    # confirm install
render login        # opens browser, authenticates the CLI
```

This gives the agent `render deploys`, `render logs`, `render env`, `render services`, and `render blueprint` — enough to manage the deploy without touching the dashboard.

### 2. Render MCP (so Claude Code can drive Render directly)

After you have the Render API key from the dashboard:

```sh
claude mcp add --transport http render https://mcp.render.com/mcp \
  --header "Authorization: Bearer <your-render-api-key>"
```

The MCP exposes service creation, log/metric reads, env-var management, and deploy triggers as structured tools. With this wired in, the agent stays in CLI-flow for the whole deployment.

### 3. Already on your machine (no action)

- Node.js 22+ (you have it; verify with `node -v`)
- Git + GitHub auth (already set up — the repo is on GitHub)
- Docker is **not** required locally for deployment — Render builds remotely. Only install if you want to test the production image on your machine.

---

## Prerequisites you need to gather

| Item | Where | Notes |
|---|---|---|
| Render account | render.com | Sign in with GitHub for one-click repo connection |
| Render API key | Dashboard → Account Settings → API Keys | Needed once, for MCP. Treat as a secret |
| GitHub repo access | Already done | Render's GitHub App needs read access to this repo at first connect |
| Region preference | You choose | Frankfurt (`frankfurt`) is closest; Oregon, Virginia, Ohio, Singapore, Sydney also available |

API keys for the AI provider, Google Drive OAuth credentials, etc. are **not** needed for the first deployment — those land later as env vars when the relevant features are built.

---

## Plan in detail

### Phase 1 — pre-flight (agent + you)

1. Agent verifies `package.json` has `"engines": { "node": ">=22" }`; adds it if missing. (Render's Native runtime defaults to Node 20; pinning is what guarantees Next.js 16 builds even though we're going Docker — keeps the image's Node version explicit.)
2. Agent drafts `render.yaml` with three services in region `frankfurt`:
   - `bookshelf-web` — Web Service, **Docker runtime**, build from repo root, `npm run build` → `npm start`, env var `DATABASE_URL` from `bookshelf-db`
   - `bookshelf-worker` — Background Worker, same image, alternate entry command (TBD when worker code exists; placeholder for now)
   - `bookshelf-db` — Postgres Starter ($7/mo), single-AZ, daily backups enabled
3. Agent opens a PR with `Dockerfile` + `render.yaml` + `engines` change for you to review.

### Phase 2 — first deploy (agent)

1. After PR merge, agent runs `render blueprint launch` (or invokes the equivalent MCP tool) to provision all three services.
2. Render builds the Docker image, starts the web service, starts the worker (idle), provisions Postgres, wires env vars across services.
3. Agent tails build logs with `render logs --service <id> --tail` and reports failures inline.
4. Agent verifies:
   - Web service returns 200 on `/`
   - Worker process is up (even if idle — no jobs yet)
   - `DATABASE_URL` is set on both web and worker
5. Agent enables automated daily Postgres backups via the dashboard (CLI doesn't cover this yet) and reports the backup window.

### Phase 3 — post-deploy hardening (agent + you)

1. Agent writes `context/deployment/deploy-plan.md` capturing: service IDs, region, runtime choice, the first deploy timestamp, the rollback command, and the log-tail command.
2. You sanity-check the deployed URL.
3. You (or agent, if you approve) add the custom domain when you're ready to submit Google OAuth verification — Render issues free TLS in ~1 minute after DNS resolves.

---

## Cost expectation

- Web service (Starter): $7/mo
- Background Worker (Starter): $7/mo
- Postgres (`basic-256mb`, the current entry-level — legacy Starter is closed to new dbs): ~$6/mo
- **Total: ~$20/mo from day one.** Confirm exact Postgres price in the blueprint preview before clicking Apply.

The free tier is intentionally avoided: free Postgres expires after 30 days, and free web services cold-start in 30–60s, which blows the PRD's 30s AI-enrichment NFR (see `infrastructure.md` Risk Register, rows 1–2).

---

## Risks worth knowing before you press go

These are the items from `infrastructure.md`'s risk register that are live at first deploy — not later concerns:

- **No built-in Postgres connection pooling.** Single-user MVP is fine; cap worker concurrency at 1 until pooling is added.
- **Starter Postgres is single-AZ, no automatic failover.** Automated daily backups + a weekly `pg_dump` to offsite storage is the mitigation; HA Postgres ($85/mo) is overkill at MVP scale.
- **Auto-deploy on `main` goes straight to prod** — PR preview environments require Team/Pro plan. For now, accept this and rely on feature branches + manual deploys to a staging service if you want a review URL.
- **Migrating off Render later requires manual `pg_dump` + service rewrite.** Keeping `render.yaml` in the repo (infrastructure-as-code) is the escape hatch.

---

## Out of scope for this doc

- CI pipeline beyond Render's built-in auto-deploy
- HA Postgres, multi-region, DR runbooks
- AI provider env vars, Google Drive OAuth wiring — these land with the features that need them
- Renaming `package.json` from `bootstrap-scaffold` → `bookshelf` (orthogonal cleanup; see `CLAUDE.md` traps)
