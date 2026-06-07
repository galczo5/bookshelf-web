# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rules

1. **`context/archive/` is immutable.** If a resolved target path starts with `context/archive/`, abort. No writes under that prefix.
2. **`context/foundation/` files are owned by the document-generation chain, not by conversation.** Never invent a `prd.md`, `tech-stack.md`, `infrastructure.md`, etc. inline. If a downstream step needs an upstream artifact and it's missing, refuse and redirect the user to regenerate it — do not synthesize the file from chat.
3. **Stack openness is binding until tech-stack selection.** Discovery and PRD steps must NOT name frameworks, databases, hosting platforms, vendors, ORM/schema notation, runtime locations, enforcement mechanisms, UI affordances, or transport protocols. Those decisions land in tech-stack selection (greenfield) or stack assessment (brownfield).
4. **Soft gates warn but allow override.** Quality cross-checks, the empty-CRUD and MVP-too-big detectors, the four agent-friendly criteria, and the infrastructure anti-bias lenses all WARN-AND-CONTINUE — they never block the user. Overrides are recorded in the artifact for downstream consumers.
5. **Next.js 16 is not the Next.js in your training data.** APIs, conventions, and file structure may all differ. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code, and heed deprecation notices.

## Project

Bookshelf — a personal ebook library manager (epub import, metadata enrichment, Markdown notes per book, Kobo sync). See @idea.md for the original brief and @context/foundation/prd.md for the locked PRD.

Stack hand-off (from @context/foundation/tech-stack.md): Next.js 16 + React 19 + TypeScript (strict) + Tailwind v4, App Router under `src/app/`, `@/*` import alias → `./src/*`. Deployment target is AWS App Runner, CI on GitHub Actions, auto-deploy on merge.

## Commands

Standard scripts live in @package.json — see the `scripts` field for `dev`, `build`, `start`, `lint`.

Test runners: **Vitest** for unit/integration (`npm test`, `npm run test:integration`, `npm run test:migrate-replay`) against the Docker Postgres; **Playwright** for e2e (`npm run test:e2e`, specs in `e2e/`). The e2e harness boots `next dev` itself, mints a NextAuth session cookie instead of doing live Google OAuth, and seeds/cleans uniquely-identified rows rather than truncating — `e2e/seed.spec.ts` is the reference test for conventions. Don't fabricate test commands; if you add another runner, add the script in `package.json`, ensure it runs in the existing ESLint/CI flow, and add the command (with a one-line description) here.

## Traps / non-obvious

- **`package.json` is named `bootstrap-scaffold`**, not `bookshelf` — leftover from the scaffold step (`create-next-app` rejects dot-prefixed temp dirs, so the bootstrap used `bootstrap-scaffold/`; see @context/changes/bootstrap-verification/verification.md). Rename it if it starts mattering; don't assume it reflects the product.
- **Two moderate `npm audit` findings** trace to a single root cause: transitive `postcss <8.5.10` bundled inside `next`. Both clear when upstream `next` ships a patched bundle — don't downgrade `next` to `9.3.3` even though `npm audit --fix` suggests it.

## Foundation paths

- `context/foundation/shape-notes.md` — discovery output
- `context/foundation/prd.md` (or `prd-vN.md`) — PRD output
- `context/foundation/tech-stack.md` — tech-stack selection output
- `context/foundation/stack-assessment.md` — brownfield stack assessment output
- `context/foundation/health-check.md` — brownfield health-check output
- `context/foundation/infrastructure.md` — infrastructure research output
- `context/foundation/lessons.md` — append-only lessons register
- `context/changes/bootstrap-verification/verification.md` — scaffold audit log
- `context/deployment/deploy-plan.md` — approved deploy plan
- `docs/reference/contract-surfaces.md` — load-bearing names registry
