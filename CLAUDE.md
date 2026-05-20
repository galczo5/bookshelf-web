# Bookshelf — Agent Guidelines

## Hard rules

1. **`context/archive/` is immutable.** If a resolved target path starts with `context/archive/`, abort. No writes under that prefix.
2. **`context/foundation/` files are owned by the document-generation chain, not by conversation.** Never invent a `prd.md`, `tech-stack.md`, `infrastructure.md`, etc. inline. If a downstream step needs an upstream artifact and it's missing, refuse and redirect the user to regenerate it — do not synthesize the file from chat.
3. **Stack openness is binding until tech-stack selection.** Discovery and PRD steps must NOT name frameworks, databases, hosting platforms, vendors, ORM/schema notation, runtime locations, enforcement mechanisms, UI affordances, or transport protocols. Those decisions land in tech-stack selection (greenfield) or stack assessment (brownfield).
4. **Soft gates warn but allow override.** Quality cross-checks, the empty-CRUD and MVP-too-big detectors, the four agent-friendly criteria, and the infrastructure anti-bias lenses all WARN-AND-CONTINUE — they never block the user. Overrides are recorded in the artifact for downstream consumers.

## AGENTS.md / CLAUDE.md inclusion test

Before adding any rule to a rules-for-AI file, ask: *could the agent know this without this file? Could public training data have prepared it?* If yes, drop it. If no, keep it.

**Belongs**: non-obvious project conventions, project-specific traps and historical workarounds, `@`-references to canonical files.

**Does NOT belong**: mainstream framework docs, README content, generic advice ("use TypeScript strict mode"), intention statements ("write clean code").

**U-shaped attention.** LLMs attend most strongly to the start and end of context. Critical rules go to the top; per-area rules belong next to their code (nested `AGENTS.md` / `.cursor/rules/*.mdc` with file globs), not buried in one big file.

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
