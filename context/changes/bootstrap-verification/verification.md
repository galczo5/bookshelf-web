---
bootstrapped_at: 2026-05-20T14:35:16Z
starter_id: next
starter_name: Next.js
project_name: bookshelf
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`:

```yaml
starter_id: next
package_manager: npm
project_name: bookshelf
hints:
  language_family: js
  team_size: solo
  deployment_target: aws-app-runner
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
```

### Why this stack (verbatim from hand-off body)

Solo developer building a 5-week after-hours web MVP with cloud-storage OAuth, AI-assisted metadata enrichment, and async enrichment work. The recommended default for `(web, js)` was `10x-astro-starter` (Astro + Supabase + Cloudflare), but the user opted out of the standard path because existing AWS expertise plus a forward-looking need to shell out to local binaries (e.g., kepubify, deferred per Non-Goals) favors container-based hosting over Cloudflare Workers' V8-isolate runtime. Next.js was chosen as the mainstream, TypeScript-first, fully-documented React full-stack framework with verified bootstrapper confidence; it clears all four agent-friendly quality gates. Deployment target is AWS App Runner — outside Next.js's curated `deployment_defaults`, so treated as a self-host-flavored DIY-deploy path. CI on GitHub Actions with auto-deploy on merge. Self-check flagged two not-true points (docs currency, can-judge-agent-output); the user proceeded knowingly and will compensate via AGENTS.md / CLAUDE.md as the project matures. Auth, AI, and background-jobs flags are set; payments and realtime are out of scope per PRD Non-Goals.

## Pre-scaffold verification

| Signal       | Value                                            | Severity | Notes                                                                                          |
| ------------ | ------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------- |
| npm package  | create-next-app v16.2.6 published 2026-05-20     | fresh    | resolved from cmd_template (`npx create-next-app@latest ...`)                                  |
| GitHub repo  | not run                                          | n/a      | card `docs_url` is https://nextjs.org/docs (not a github.com URL); no recency signal available |

## Scaffold log

**Resolved invocation**: `npx create-next-app@latest bootstrap-scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm`
**Strategy**: subdir-then-move
**Exit code**: 0
**Files moved**: 13
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold
**.gitignore handling**: append-merged (cwd `10x*` line preserved at top; scaffold lines appended under `# from next` separator)
**.bootstrap-scaffold cleanup**: deleted

### Deviation from spec

The strict spec hardcodes the temp directory name as `.bootstrap-scaffold` (dot-prefixed). `create-next-app` validates the project directory name against npm package naming rules and rejects names that start with a period (`name cannot start with a period`). To proceed, the temp directory was renamed to `bootstrap-scaffold` (no dot prefix) for this run with explicit user confirmation. Outcome is functionally equivalent: scaffold landed in `bootstrap-scaffold/`, files were moved into cwd, the temp dir was deleted. The skill's `scaffold-merge.md` should either change the spec'd temp dir name or document a per-starter override for any CLI that disallows dot-prefixed names.

### File-by-file move log

| Path                  | Resolution                                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| `.gitignore`          | append-merged (cwd existed)                                                |
| `.next/`              | moved silently                                                             |
| `AGENTS.md`           | moved silently (no cwd conflict)                                           |
| `CLAUDE.md`           | existing wins; scaffold copy sidelined as `CLAUDE.md.scaffold`             |
| `eslint.config.mjs`   | moved silently                                                             |
| `next-env.d.ts`       | moved silently                                                             |
| `next.config.ts`      | moved silently                                                             |
| `node_modules/`       | moved silently                                                             |
| `package-lock.json`   | moved silently                                                             |
| `package.json`        | moved silently                                                             |
| `postcss.config.mjs`  | moved silently                                                             |
| `public/`             | moved silently                                                             |
| `README.md`           | moved silently                                                             |
| `src/`                | moved silently                                                             |
| `tsconfig.json`       | moved silently                                                             |

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 0 HIGH, 2 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/1/0 direct of total 0/0/2/0

#### CRITICAL findings

None.

#### HIGH findings

None.

#### MODERATE findings

- **next** — installed via project root (direct). Severity: moderate. Vulnerability surfaces transitively through bundled `postcss`. `fixAvailable.version`: `9.3.3` (SemVer-major downgrade, listed by npm-audit but almost certainly not the right fix — track upstream `next` releases for a patched line forward).
- **postcss** (transitive, nested under `node_modules/next/node_modules/postcss`). Advisory: `GHSA-qx2v-qp2m-jg93` — "PostCSS has XSS via Unescaped </style> in its CSS Stringify Output". CWE-79. CVSS 6.1 (`AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N`). Vulnerable range: `<8.5.10`. Fix tracked via `next` upgrade.

#### LOW / INFO findings

None.

#### Raw `npm audit --json` output

```json
{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "next": {
      "name": "next",
      "severity": "moderate",
      "isDirect": true,
      "via": ["postcss"],
      "effects": [],
      "range": "9.3.4-canary.0 - 16.3.0-canary.5",
      "nodes": ["node_modules/next"],
      "fixAvailable": { "name": "next", "version": "9.3.3", "isSemVerMajor": true }
    },
    "postcss": {
      "name": "postcss",
      "severity": "moderate",
      "isDirect": false,
      "via": [
        {
          "source": 1117015,
          "name": "postcss",
          "dependency": "postcss",
          "title": "PostCSS has XSS via Unescaped </style> in its CSS Stringify Output",
          "url": "https://github.com/advisories/GHSA-qx2v-qp2m-jg93",
          "severity": "moderate",
          "cwe": ["CWE-79"],
          "cvss": { "score": 6.1, "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N" },
          "range": "<8.5.10"
        }
      ],
      "effects": ["next"],
      "range": "<8.5.10",
      "nodes": ["node_modules/next/node_modules/postcss"],
      "fixAvailable": { "name": "next", "version": "9.3.3", "isSemVerMajor": true }
    }
  },
  "metadata": {
    "vulnerabilities": { "info": 0, "low": 0, "moderate": 2, "high": 0, "critical": 0, "total": 2 },
    "dependencies": { "prod": 17, "dev": 379, "optional": 85, "peer": 0, "peerOptional": 0, "total": 431 }
  }
}
```

## Hints recorded but not acted on

| Hint                                | Value                                                                 |
| ----------------------------------- | --------------------------------------------------------------------- |
| bootstrapper_confidence             | verified                                                              |
| quality_override                    | false                                                                 |
| path_taken                          | custom                                                                |
| self_check_answers.typed            | true                                                                  |
| self_check_answers.from_official_starter | true                                                             |
| self_check_answers.conventions      | true                                                                  |
| self_check_answers.docs_current     | false                                                                 |
| self_check_answers.can_judge_agent  | false                                                                 |
| team_size                           | solo                                                                  |
| deployment_target                   | aws-app-runner                                                        |
| ci_provider                         | github-actions                                                        |
| ci_default_flow                     | auto-deploy-on-merge                                                  |
| has_auth                            | true                                                                  |
| has_payments                        | false                                                                 |
| has_realtime                        | false                                                                 |
| has_ai                              | true                                                                  |
| has_background_jobs                 | true                                                                  |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep. Specifically: `CLAUDE.md.scaffold` (scaffold's one-line `@AGENTS.md` reference) vs cwd `CLAUDE.md` (the project's Bookshelf Agent Guidelines).
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. The 2 moderate findings here both trace to a single root cause (transitive `postcss <8.5.10` inside `next`'s bundled dependency); they will clear when the upstream `next` release patches the bundled `postcss`.
- The `AGENTS.md` shipped by the Next.js scaffold (`This is NOT the Next.js you know — read node_modules/next/dist/docs/`) is now at the repo root. If you keep it, the future M1L4 skill will reconcile it with the project's own conventions; if you prefer to write your own, delete or rename it now.
