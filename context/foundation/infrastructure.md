---
project: bookshelf
researched_at: 2026-05-22
recommended_platform: Render
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Next.js 16
  runtime: Node.js 20+ (container or Native runtime)
---

## Recommendation

**Deploy on Render.**

Render passes all five agent-friendly criteria, supports persistent background workers and cron jobs natively (matching the project's AI-enrichment background-job requirement), co-locates managed Postgres + Key Value (Valkey 8) alongside the web service, and ships an official MCP server (GA Aug 2025) plus `llms.txt` and `llms-full.txt` for agent-readable docs. Realistic MVP cost is ~$14–21/mo (web $7 + Postgres $7 + optional worker $7). The runner-up, Railway, scored equivalently on the five criteria; the swap from Railway to Render after cross-check reflects a preference for Render's published MCP GA status and dual `llms.txt`/`llms-full.txt` over Railway's WIP-marked MCP — both platforms are operationally similar for this MVP shape.

> **Note on the prior tech-stack.md pick.** `context/foundation/tech-stack.md` names `aws-app-runner` as the deployment target. Research dated 2026-05-22 found AWS App Runner entered **maintenance mode on 2026-04-30** and is **closed to new customers**. AWS recommends Amazon ECS Express Mode as the replacement. App Runner also lacks WebSocket support (open since 2021) and has no native background-job story (would require Lambda/EventBridge or Fargate as a sidecar). Combined with this MVP's need for persistent background workers, App Runner is no longer a viable target. This research supersedes the deployment-target hint in `tech-stack.md`.

## Platform Comparison

| Platform | CLI-first | Managed | Agent-docs | Deploy API | MCP | Persistent procs | Co-located DB | Notes |
|---|---|---|---|---|---|---|---|---|
| **Render (recommended)** | Pass | Pass | Pass (`llms.txt` + `llms-full.txt`) | Pass (REST + CLI v2.18.0) | Pass (GA Aug 2025) | Pass (Background Workers + Cron) | Pass (PG, Valkey 8) | Free PG expires 30 days; HA PG ~$85/mo |
| **Railway (runner-up)** | Pass | Pass | Pass (`llms.txt`) | Pass | Pass (official, OAuth, marked WIP) | Pass (always-on, no cold starts) | Pass (PG, MySQL, Redis, Mongo GA) | Usage-based bill; Next.js 16 needs Node 20+ pin |
| Fly.io | Pass | Partial (BYO Dockerfile) | Partial (per-page MD, no `llms.txt`) | Pass | Partial (experimental) | Pass (Fly Machines) | Partial (MPG $38/mo entry; Supabase-on-Fly sunset 2025-04-11) | Hyperscaler-style DX; no free tier since Oct 2024 |
| Vercel | Pass | Pass | Pass | Pass | Pass (GA OAuth) | Fail / Beta (Queues + Workflows in Beta as of 2026-05) | Partial (Postgres/KV transitioned to Marketplace partners) | Hard-filtered: persistent procs not native |
| Cloudflare W+P | Pass | Pass | Pass (best-in-class `llms.txt` ecosystem) | Pass | Pass | Partial (Workers can't run native binaries; Containers GA 2026-04-13 but Workers Paid only) | Pass (D1/R2/KV/AI all GA) | tech-stack.md explicitly opted out due to V8 isolate + future kepubify need |
| AWS App Runner | Pass | Pass | Partial (GitHub MD, no `llms.txt`) | Pass | Pass (AWS MCP Server GA May 2026) | **Fail** (no WS, no bg jobs) | Partial (VPC wiring non-trivial) | **Closed to new customers 2026-04-30 — maintenance mode** |

### Shortlisted Platforms

#### 1. Render (recommended)

All five agent-friendly criteria pass. Background Workers and Cron Jobs are GA — natively covers the AI-enrichment background-job requirement without a Queues/Workflows-in-Beta workaround. Managed Postgres (Starter $7/mo) and Key Value (Valkey 8) co-locate with the web service, matching the interview-stated preference for co-located managed services. Docs publish both `llms.txt` and `llms-full.txt`, and Render's MCP (GA Aug 2025) exposes ~20 tools — create services, query the DB read-only, fetch logs/metrics, set env vars, trigger deploys. CLI v2.18.0 covers `deploys create/list/cancel`, `logs` (live tail + historical), `services update`, `restart`, with `--output json` for CI. Realistic MVP cost lands at $14–21/mo (web $7 + Postgres $7 + optional worker $7).

#### 2. Railway (runner-up)

Functionally equivalent to Render on the five criteria. First-class monorepo support (one repo, multiple services with watch paths), Railpack as the default builder (Nixpacks in maintenance), `llms.txt` published, official MCP at `mcp.railway.com` with OAuth. The deciding gap vs. Render is small: Railway's MCP server is explicitly marked work-in-progress, while Render's is GA. Usage-based billing on Pro tier is harder to predict than Render's flat-tier model; cost lands ~$10–25/mo depending on always-on minutes. Note: Next.js 16 requires `engines.node` >= 20 in `package.json` to avoid build failures on Railway's default Node 18.

#### 3. Fly.io

Strong fit for a hyperscaler-comfortable developer who wants full container control. Fly Machines (GA) support persistent processes, WebSockets, on-demand wake. `flyctl` is mature; deploy strategies include bluegreen and canary. The gaps vs. Render/Railway: (a) Managed Postgres (MPG) entry price is $38/mo — five times Render's Starter; unmanaged Fly Postgres is no longer supported; (b) Supabase-on-Fly was sunset 2025-04-11, so the cheap-Postgres-via-partner path is closed; (c) `fly mcp server` is marked experimental (4 commits, no releases); (d) docs lack a `llms.txt` (per-page "copy as markdown" is offered, but scraping is required). No free tier for new accounts since Oct 2024.

## Anti-Bias Cross-Check: Render

### Devil's Advocate — Weaknesses

1. **Free tier is a trap for MVP.** Free Postgres expires 30 days after creation (with a 14-day grace before deletion) and free web services spin down after 15 min idle with 30–60s cold start — which blows the PRD's 30s AI-enrichment latency NFR. Free tier is for prototypes, not a personal library kept for years. Budget $14–21/mo from day one.
2. **No built-in Postgres connection pooling.** Each Next.js 16 route handler / server component opens a connection. Solo user keeps this academic, but the moment a friend tries it or an import batch enrichment kicks in at concurrency > 1, connection-pool exhaustion is the first thing that breaks.
3. **HA Postgres starts at ~$85/mo.** The Starter tier ($7/mo) is single-AZ with no automatic failover or built-in PITR. A disk failure between manual backups = data loss, which collides directly with the PRD's "notes and library state are never silently lost" guardrail.
4. **Persistent disks disable zero-downtime deploys.** Post-MVP, when kepubify or any disk-cached work lands, every worker deploy will cause a brief outage.
5. **PR preview environments require Team / Pro plans.** On Starter, merge-to-main goes straight to production — no review URL.

### Pre-Mortem — How This Could Fail

The dev deployed Bookshelf to Render in week 1: a web service for Next.js 16, a Background Worker for AI enrichment, Starter Postgres for library + notes, Render Key Value (Valkey 8) as a queue. The setup mirrored the architecture diagram exactly. Three months in, a weekend import batch of 40 epubs ran the enrichment worker at high concurrency; without a Postgres pooler, connection-pool exhaustion corrupted the worker's job state and three books landed with partial metadata. The notes attached to those books missed fields. The dev didn't notice for weeks. Recovery surfaced a second gap: Starter Postgres automatic backups weren't enabled by default, so restoring meant losing two weeks of subsequent notes. Around month five, kepubify landed as a post-MVP feature with a persistent disk; every worker deploy now caused 15–30s outage. The dev evaluated migrating to Fly.io but discovered the migration cost (manual `pg_dump` + worker rewrite + new MCP wiring) exceeded the operational tax of staying. The platform choice was correct *for the MVP shape*, but the operational glue (backups, pooling, disk-deploy interaction) cost ~10 unplanned hours/month.

### Unknown Unknowns

- **`render.yaml` blueprints are the agent-native path.** Render's MCP reads and writes a declarative blueprint of every service in the workspace. Define infrastructure-as-code from day one or you'll be clicking dashboards forever.
- **"Key Value" replaced legacy Redis in Feb 2025.** Valkey 8 protocol-compatible. Community tutorials referencing `render-redis` or legacy Redis 6 instances are stale; legacy instances are frozen and won't accept new creates.
- **Native runtime + Next.js 16 Image Optimization can silently disable `sharp`.** If image quality matters for cover art (it does, per the Secondary success criterion), prefer the Docker runtime for predictability and verify `sharp` is in the build.
- **OAuth callbacks against `*.onrender.com`.** Google's OAuth verification flow is more aggressive on auto-generated subdomains. Wire a custom domain (Render provides free TLS) before submitting OAuth verification for Google Drive.
- **Background Worker horizontal scaling is manual.** A single Worker scales vertically only; parallel workers require multiple replica-services. For this MVP (single user, single worker, concurrency=1) it's fine — just don't assume autoscaling.

## Operational Story

- **Preview deploys**: PR preview environments require Team or Pro plan ($19+/user/mo). On the Starter plan, merges to `main` auto-deploy to production; no review URL. For branch testing without upgrading, use `render deploys create --service <id> --branch <branch>` to manually trigger a one-off deploy of a feature branch to a staging service.
- **Secrets**: Environment variables stored in the Render dashboard or set via `render env set KEY=value --service <id>` CLI; encrypted at rest, scoped per service. Rotation = `render env set` then `render restart`. No vault rotation hooks built in; pair with AWS Secrets Manager or GitHub Secrets if rotation policy is required.
- **Rollback**: One click in dashboard (autodeploys auto-pause to prevent loop-back) or via REST API `POST /v1/services/{id}/rollback`. Typical time-to-revert: 30–90s. Postgres migrations do not roll back automatically; the rollback workflow must include reverse SQL or schema-compatible code on both sides.
- **Approval**: Deploys auto-trigger on push to `main` (matches CI flow from tech-stack.md). The agent may run `render deploys create`, `rollback`, `restart`, `env set`, `services scale`. Service deletion, plan upgrades, and database recreation require human dashboard confirmation. Treat dropping a database as a human-only action.
- **Logs**: `render logs --service <id> --tail` for live streaming; `render logs --service <id> --start <ISO> --end <ISO>` for historical. Build logs: `render builds logs <build-id>`. The Render MCP server exposes `read_logs` and `read_metrics` as structured tools.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Free Postgres expires 30 days after creation | Research finding | H if free used | M | Pay $7/mo Starter from day one; never use free Postgres for the library |
| Free web service cold start (30–60s) blows the 30s AI-enrichment NFR | Research finding | H if free used | H | Use Starter web service ($7/mo) — no spin-down |
| Postgres connection-pool exhaustion at moderate concurrency (no built-in pooler) | Devil's advocate / Pre-mortem | M | M | Run PgBouncer as a sidecar Background Worker, OR use a serverless-friendly Postgres client; cap worker concurrency at 1 until pooling is added |
| Starter Postgres has no PITR or automatic backups by default | Devil's advocate / Pre-mortem | L | H (violates PRD data-integrity guardrail) | Enable Render's automated daily backups in the dashboard; schedule a weekly `pg_dump` to S3/R2 as cold-storage offsite copy |
| Idle Background Worker burns ~$3–7/mo in RAM for low-throughput single-user enrichment | Devil's advocate | M | L | Accept the floor; revisit only if total bill exceeds $30/mo, then consider Cron-Jobs-only model |
| Persistent disks disable zero-downtime deploys (post-MVP kepubify) | Devil's advocate | M (when kepubify lands) | L | Accept 15–30s outage during worker deploys, or design kepubify as stream-based (no scratch disk) |
| HA Postgres jumps to ~$85/mo — Starter is single-AZ with no automatic failover | Devil's advocate | L | H if disk fails | Backup strategy (above) is the mitigation; HA is overkill at MVP scale |
| `*.onrender.com` triggers Google OAuth "unverified app" warning | Unknown unknowns | M | M | Wire a custom domain with free Render TLS before submitting Google OAuth verification |
| Next.js 16 Image Optimization silently disables `sharp` on Native runtime | Unknown unknowns | L | M | Use Docker runtime for predictable Image Optimization; verify `sharp` is included in build output |
| MCP server tool API may shift | Devil's advocate | L | L | Pin to documented tools; treat MCP as advisory, not a contract |
| Migrating off Render = manual `pg_dump` + service rewrite | Unknown unknowns | L | M | Keep infrastructure declarative via `render.yaml`; export DB regularly; egress for `pg_dump` is billed but negligible at MVP scale |
| PRD's "no book body bytes leave the device" NFR may be interpreted strictly | Cross-check (clarification need) | L | H if strict | Confirm intent with PRD owner — strict reading rules out any server-side parsing, including Render; lenient reading (no external AI/search APIs) is fine on Render |

## Getting Started

1. **Pin Node ≥ 22 in `package.json`.** Add `"engines": { "node": ">=22" }` so Render's Native runtime picks the Next.js 16-compatible version. (Default is 20, but pinning makes the build deterministic.)
2. **Create `render.yaml` at repo root** declaring three services: `bookshelf-web` (Web Service, Native runtime or Docker), `bookshelf-worker` (Background Worker), `bookshelf-db` (Postgres Starter). Wire env vars to reference the DB connection string by service name. This is the agent-native infrastructure-as-code path — Render's MCP reads and writes blueprints.
3. **Install the Render CLI**: `brew install render-oss/render/render` (macOS) or download from `github.com/render-oss/cli/releases`. Authenticate: `render login`.
4. **Wire the Render MCP into Claude Code**: `claude mcp add --transport http render https://mcp.render.com/mcp --header "Authorization: Bearer <render-api-key>"`. The MCP exposes deploys, log/metric reads, env vars, and service creation — keeps the agent in CLI-flow without browser dashboards.
5. **First deploy**: push to GitHub, then `render blueprint launch` (or via dashboard) — Render provisions all three services and links them. Subsequent merges to `main` auto-deploy. Wire a custom domain before submitting Google OAuth verification for Drive access.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration (Dockerfile authoring, multi-stage builds, base-image selection).
- CI/CD pipeline setup beyond Render's built-in auto-deploy.
- Production-scale architecture (multi-region failover, HA Postgres, DR runbooks, formal SLA commitments).
- AWS-native alternatives to App Runner (ECS Express Mode, Fargate, Lambda) — flagged as the official AWS replacement path but not evaluated against the criteria here.

## tech-stack.md follow-up

`context/foundation/tech-stack.md` should be updated to reflect this research:

- Change `deployment_target: aws-app-runner` → `deployment_target: render`.
- Update "Why this stack" to replace the App Runner rationale with a one-paragraph note: the original AWS-native pick is unavailable (App Runner closed to new customers 2026-04-30); Render was selected after researched comparison against the agent-friendly criteria. Reference this file (`context/foundation/infrastructure.md`) as the source of the decision.
- The rest of the tech-stack hand-off (Next.js 16, React 19, TypeScript strict, Tailwind v4, App Router, GitHub Actions CI, auto-deploy on merge) carries forward unchanged — Render supports the auto-deploy-on-merge flow natively via its GitHub integration.
