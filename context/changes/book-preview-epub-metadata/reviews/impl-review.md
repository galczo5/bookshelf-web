<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Epub vs DB Metadata Comparison on Book Detail Page

- **Plan**: context/changes/book-preview-epub-metadata/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Missing AbortController in useEffect fetch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/books/[id]/epub-metadata-comparison.tsx:68–76
- **Detail**: The `useEffect` fires `fetch()` with no cleanup function. Two issues share the same root: (1) In Next.js dev mode (React StrictMode), the component mounts twice, firing two Drive API calls per page view in development. (2) If `bookId` ever changes while a fetch is in flight, the stale response calls `setEpubData` and overwrites fresh state.
- **Fix**: Add an `AbortController` and return a cleanup that aborts on unmount:
  ```ts
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/books/${bookId}/epub-metadata`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<EpubResponse>;
      })
      .then(setEpubData)
      .catch((err) => {
        if (err.name !== "AbortError") setFetchFailed(true);
      });
    return () => controller.abort();
  }, [bookId]);
  ```
- **Decision**: FIXED

### F2 — Reason code shown as human-readable text rather than raw slug

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/(app)/books/[id]/epub-metadata-comparison.tsx:58–62
- **Detail**: Plan specifies the note text as `"Epub metadata unavailable (reason)"` where `reason` was understood as the raw slug (`no_drive_file`, `drive_error`, `parse_error`). Implementation adds a `REASON_LABELS` map and shows human-readable text instead (`"no Drive file attached"`, `"Drive unreachable"`, `"epub could not be parsed"`). This is a UX improvement over what the plan specified — raw slugs would have been confusing to users.
- **Fix**: Confirm this is the desired behavior (likely yes — no code change needed).
- **Decision**: SKIPPED — human-readable is better UX; plan was underspecified

### F3 — Full epub download on every page view (plan-acknowledged trade-off)

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/api/books/[id]/epub-metadata/route.ts:49–56
- **Detail**: Every visit to a book detail page triggers a full epub download into server memory and a full parse. Plan explicitly defers caching under "What We're NOT Doing". A lightweight `Cache-Control: private, max-age=300` header on the JSON response would reduce Drive round-trips within a single browser session without requiring any DB schema change.
- **Fix**: Add `Cache-Control: private, max-age=300` to the success `Response.json(...)` call (one line). This doesn't persist parse results — it only caches the final JSON in the browser.
- **Decision**: FIXED — added Cache-Control: private, max-age=300

### F4 — DriveAuthError handling intentionally diverges from sibling route

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/api/books/[id]/epub-metadata/route.ts:41–44
- **Detail**: The sibling `download/route.ts` calls `redirect("/signin")` on `DriveAuthError` because it is a browser-navigation endpoint. The new route returns `Response.json({ available: false, reason: "drive_error" })` because it is a JSON endpoint consumed via `fetch()`. The deviation is correct and intentional.
- **Fix**: No change needed — confirm this was deliberate.
- **Decision**: SKIPPED — intentional; page-level guard is sufficient

### F5 — No `review_state` filter unlike sibling download route

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/api/books/[id]/epub-metadata/route.ts:22–27
- **Detail**: `download/route.ts` adds `.where("review_state", "=", "confirmed")` so only confirmed books are downloadable. The epub-metadata route omits this filter, allowing it to serve epub data for books in any state. This appears intentional — the comparison is useful for confirmed books on the detail page, and that page itself guards access via `getOwnedBook`. No security issue, but worth confirming the intent.
- **Fix**: No change needed if intentional; add `.where("review_state", "=", "confirmed")` if you want to align with the sibling.
- **Decision**: SKIPPED — intentional; different endpoint types warrant different error handling

### F6 — Unnecessary type cast on discriminated union

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/books/[id]/epub-metadata-comparison.tsx:80–82
- **Detail**: `(epubData as { reason: string }).reason` — at this point TypeScript has already narrowed `epubData` to `{ available: false; reason: "no_drive_file" | "drive_error" | "parse_error" }` via the `!epubData.available` check. The cast widens the type unnecessarily (discards the union narrowing to `string`). Replace with `epubData.reason` directly.
- **Fix**: Change `(epubData as { reason: string }).reason` → `epubData.reason`
- **Decision**: FIXED — replaced cast with epubData.reason
