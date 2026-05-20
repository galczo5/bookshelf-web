# Bookshelf — Agent Guidelines

This repo uses the **10xDevs AI Toolkit** — a chain of skills under `.claude/skills/` that walk a project from idea to deployed MVP. Every skill writes a single artifact under `context/foundation/` (or `context/changes/`), and each downstream skill consumes the file the prior one wrote. The chain is the contract; conversation history is never a fallback.

## Hard rules

1. **`context/archive/` is immutable.** If a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead." No skill may write under that prefix.
2. **`context/foundation/` files are owned by skills, not by conversation.** Never invent a `prd.md`, `tech-stack.md`, `infrastructure.md`, etc. inline. If a downstream skill needs an upstream artifact and it's missing, refuse and redirect the user to run the upstream skill — do not synthesize the file from chat.
3. **Stack openness is binding until tech-stack selection.** `/10x-shape` and `/10x-prd` must NOT name frameworks, databases, hosting platforms, vendors, ORM/schema notation, runtime locations, enforcement mechanisms, UI affordances, or transport protocols. Those land in `/10x-tech-stack-selector` (greenfield) or `/10x-stack-assess` (brownfield).
4. **Universal language only.** No "10xDevs" / cohort / certification references in any user-facing output or any artifact written to disk. Skills are shipped as generic toolkit pieces.
5. **Skill-internal labels stay internal.** Do not say "Step 0", "Q3", "Gate 1", `hints.deployment_target`, `path-fork`, `subdir-then-move` to the user. Translate to plain language ("the framework question", "your deployment target", "scaffold into a temp directory then move files up").
6. **Soft gates warn but allow override.** `/10x-shape`'s quality cross-check, the empty-CRUD and MVP-too-big detectors, the four agent-friendly criteria, and the infrastructure anti-bias lenses all WARN-AND-CONTINUE — they never block the user. Overrides are recorded in the artifact for downstream consumers.
7. **CLI failure in `/10x-bootstrapper` is HARD-STOP.** All other verification slots WARN-AND-CONTINUE; only a non-zero CLI exit at scaffold time halts the chain.

## The chain

**Greenfield:**
```
/10x-init → /10x-shape → /10x-prd → /10x-tech-stack-selector → /10x-bootstrapper
         → /10x-agents-md → /10x-rule-review → /10x-lesson
         → /10x-infra-research → Plan Mode deploy
```

**Brownfield:** `/10x-shape` (auto-detects from cwd) → `/10x-prd` → `/10x-stack-assess` → `/10x-health-check` → `/10x-agents-md` → `/10x-rule-review` → `/10x-lesson` → `/10x-infra-research` → Plan Mode deploy.

Each skill refuses if its upstream artifact is missing and redirects via a clipboard copy of the next command. No skill chains automatically — the user runs the next one.

## Skills

**Project setup**
- `/10x-init` — scaffold `context/{changes,archive,foundation}/` + canonical READMEs. Idempotent, no-op when complete. See @.claude/skills/10x-init/SKILL.md.

**Discovery & document generation**
- `/10x-shape` — facilitator that walks vision → persona → MVP → FRs → business logic → framing. Auto-detects greenfield vs brownfield from cwd markers. Writes `context/foundation/shape-notes.md` with a resumable `checkpoint:` block. See @.claude/skills/10x-shape/SKILL.md.
- `/10x-prd` — document generator. Reads shape-notes (or raw notes), scores 4-signal heuristic, writes `context/foundation/prd.md` against the locked schema at @.claude/skills/10x-shape/references/prd-schema.md. Routes every gap to `## Open Questions`; never invents domain decisions. See @.claude/skills/10x-prd/SKILL.md.

**Stack selection (greenfield) / assessment (brownfield)**
- `/10x-tech-stack-selector` — reads PRD, opens with explicit choice (recommended default for `(product_type, language_family)` vs design-your-own), reasons over @.claude/skills/10x-tech-stack-selector/references/starter-registry.yaml against four quality gates, writes `context/foundation/tech-stack.md`. See @.claude/skills/10x-tech-stack-selector/SKILL.md.
- `/10x-stack-assess` — brownfield counterpart. Detects existing stack from cwd, scores against the same four gates, produces compensation strategies (ready-to-paste CLAUDE.md/AGENTS.md entries) at `context/foundation/stack-assessment.md`. See @.claude/skills/10x-stack-assess/SKILL.md.

**Scaffold (greenfield) / health audit (brownfield)**
- `/10x-bootstrapper` — reads tech-stack hand-off, dispatches the chosen starter's CLI through one of three cwd strategies (subdir-then-move, native-cwd, git-clone), preserves `context/` always, writes audit log to `context/changes/bootstrap-verification/verification.md`. Chain-mode only in v1; does NOT generate AGENTS.md/CLAUDE.md. See @.claude/skills/10x-bootstrapper/SKILL.md.
- `/10x-health-check` — brownfield counterpart. Three execution gates (pre/in/post): lockfile + audit + outdated, test runner + CI + config files, then a prioritized fix list with Category A (fix now) and Category B (covered in upcoming lessons). Writes `context/foundation/health-check.md`. See @.claude/skills/10x-health-check/SKILL.md.

**Agent onboarding**
- `/10x-agents-md` — inspects the repo (or subdirectory) and writes "Repository Guidelines" to `AGENTS.md`. Repo-level target ~200–400 words; directory-level reframes around local conventions, 120–250 words. Update path is surgical (KEEP/UPDATE/REMOVE/MISSING classification) — never silent overwrite. See @.claude/skills/10x-agents-md/SKILL.md.
- `/10x-rule-review <path>` — 5-axis scorecard (length, embedded snippets, precision, redundancy, ordering) for any rules-for-AI markdown file. Read-only by default; only Check 5 (reorder) may edit and only with explicit approval. See @.claude/skills/10x-rule-review/SKILL.md.
- `/10x-lesson [seed]` — appends one entry (Context / Problem / Rule / Applies to) to `context/foundation/lessons.md`. Self-bootstraps the file with its canonical header. Append-only; one entry per invocation; pre-fills nothing. See @.claude/skills/10x-lesson/SKILL.md.

**Infrastructure & deploy**
- `/10x-infra-research [path]` — loads tech-stack as hard constraint, runs 5-question developer interview, spawns parallel subagent research across six candidate platforms, scores against five agent-friendly platform criteria, runs three anti-bias lenses (devil's advocate, pre-mortem, unknown unknowns) on the leader, writes `context/foundation/infrastructure.md`. See @.claude/skills/10x-infra-research/SKILL.md.
- **Plan Mode deploy** — not a skill. Activate the host's plan mode (Shift+Tab cycles default → auto-accept → plan), point at `@infrastructure.md` + `@tech-stack.md`, iterate on the plan, approve, then execute. The approved plan persists at `context/deployment/deploy-plan.md`.

## AGENTS.md / CLAUDE.md inclusion test

Before adding any rule to a rules-for-AI file, ask: *could the agent know this without this file? Could public training data have prepared it?* If yes, drop it. If no, keep it.

**Belongs**: non-obvious project conventions, project-specific traps and historical workarounds, `@`-references to canonical files.

**Does NOT belong**: mainstream framework docs, README content, generic advice ("use TypeScript strict mode"), intention statements ("write clean code").

**U-shaped attention.** LLMs attend most strongly to the start and end of context. Critical rules go to the top; per-area rules belong next to their code (nested `AGENTS.md` / `.cursor/rules/*.mdc` with file globs), not buried in one big file. `/10x-rule-review` Check 5 operationalizes the first; directory-level `/10x-agents-md` operationalizes the second.

## Foundation paths

- `context/foundation/shape-notes.md` — `/10x-shape` output
- `context/foundation/prd.md` (or `prd-vN.md`) — `/10x-prd` output
- `context/foundation/tech-stack.md` — `/10x-tech-stack-selector` output
- `context/foundation/stack-assessment.md` — `/10x-stack-assess` output
- `context/foundation/health-check.md` — `/10x-health-check` output
- `context/foundation/infrastructure.md` — `/10x-infra-research` output
- `context/foundation/lessons.md` — `/10x-lesson` register (append-only, consumed by future planning/review skills)
- `context/changes/bootstrap-verification/verification.md` — `/10x-bootstrapper` audit log
- `context/deployment/deploy-plan.md` — Plan Mode deploy artifact
- `docs/reference/contract-surfaces.md` — load-bearing names registry

## Lesson notes

Per-lesson context lives under `10xdevs3/10xdevs3-artifacts-m1/claude-code/m1l{1..5}/rules/CLAUDE-m1l{N}.md` — read those when you need the full rationale behind a chain step (anti-patterns, soft gates, quality criteria, anti-bias technique details).
