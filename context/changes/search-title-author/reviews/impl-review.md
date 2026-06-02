<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Search Title/Author — Polish

- **Plan**: context/changes/search-title-author/plan.md
- **Scope**: All Phases (1–4 of 4)
- **Date**: 2026-06-02
- **Verdict**: APPROVED
- **Findings**: 0 critical  0 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Plan Drift Summary

All 16 planned changes verified MATCH across Phases 1–4. No DRIFT, MISSING, or EXTRA items found. One cosmetic addition (mt-3 on Clear search button) — benign.

## Automated Checks

- `npm run lint` ✅ 0 errors (4 pre-existing `<img>` warnings)
- `npm run build` ✅ Compiled + TypeScript clean

## Findings

### F1 — Per-character fold loop in highlightMatches

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/lib/search-utils.ts:23–25
- **Detail**: highlightMatches built its folded mirror char-by-char (per plan spec) for index alignment safety. For BMP Latin characters, foldDiacritics on the full string produces identical results with the same index alignment, at lower constant cost.
- **Fix**: Replace per-char loop with `const folded = foldDiacritics(text)` plus an alignment comment.
- **Decision**: FIXED

### F2 — Cmd-K select() intent undocumented

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/app/components/library-view.tsx:46–47
- **Detail**: The Cmd-K handler calls focus() + select() unconditionally, including when the search input is already focused. Intentional (matches browser omnibar UX, per plan spec) but looked like an oversight without a comment.
- **Fix**: Add explanatory comment.
- **Decision**: FIXED

### F3 — window.history.replaceState bypasses Next.js router

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/app/components/library-view.tsx:54–57
- **Detail**: updateParams used window.history.replaceState rather than router.replace. Pre-existing pattern (since filter-by-tag). Works because Next.js 15+ subscribes to replaceState internally, but relied on undocumented behaviour.
- **Fix**: Switched to `router.replace(qs ? \`?${qs}\` : pathname, { scroll: false })`.
- **Decision**: FIXED
