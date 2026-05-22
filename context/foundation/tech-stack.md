---
starter_id: next
package_manager: npm
project_name: bookshelf
hints:
  language_family: js
  team_size: solo
  deployment_target: render
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: false
    can_judge_agent: false
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
---

## Why this stack

Solo developer building a 5-week after-hours web MVP with cloud-storage OAuth, AI-assisted metadata enrichment, and async enrichment work. The recommended default for `(web, js)` was `10x-astro-starter` (Astro + Supabase + Cloudflare), but the user opted out of the standard path because the forward-looking need to shell out to local binaries (e.g., kepubify, deferred per Non-Goals) favors container-based hosting over Cloudflare Workers' V8-isolate runtime. Next.js was chosen as the mainstream, TypeScript-first, fully-documented React full-stack framework with verified bootstrapper confidence; it clears all four agent-friendly quality gates. Deployment target is Render (Docker runtime) — the originally-named AWS App Runner pick is unavailable (closed to new customers 2026-04-30, now in maintenance mode), so a researched comparison against the agent-friendly platform criteria was run and Render was selected; see `context/foundation/infrastructure.md` for the full decision record, platform comparison, anti-bias cross-check, and risk register. CI on GitHub Actions with auto-deploy on merge — Render supports this natively via its GitHub integration. Self-check flagged two not-true points (docs currency, can-judge-agent-output); the user proceeded knowingly and will compensate via AGENTS.md / CLAUDE.md as the project matures. Auth, AI, and background-jobs flags are set; payments and realtime are out of scope per PRD Non-Goals.
