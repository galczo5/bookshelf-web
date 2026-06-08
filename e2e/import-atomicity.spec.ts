import { randomUUID } from "node:crypto";
import { test, expect, addSessionCookie } from "./helpers/fixtures";
import { ensureE2eUser, seedPendingDraft, deleteBook } from "./helpers/db";

// Modeled on seed.spec.ts — see its header for the five conventions this file
// follows (role locators, wait-on-state, unique test data, precise cleanup,
// risk-tied name).
//
// Risk #1 (test-plan.md §2): "Import non-atomicity." A confirmed import must
// never leave a GHOST book in the library — a row the user can see while the
// epub bytes never reached Drive. The PRD's "app-independent library" guardrail
// (US-01, FR-005) depends on this: every book the library shows must be a real,
// reachable file.
//
// The library-landing operation is confirmReviewAction
// (src/app/actions/confirm-review.ts): it uploads to Drive FIRST, then writes the
// confirmed DB row. If that ordering ever breaks — the row is written even when
// the Drive write can't complete — the user gets a ghost book. (The import →
// draft leg is covered by Phase-1 integration in tests/integration/; the
// atomicity risk lives here, at confirm, so this is where the draft is seeded
// and the browser is driven — the same seed-the-DB approach seed.spec.ts uses.)
//
// The Phase-1 integration test proves the DB+Drive STATE by calling the action
// directly. It cannot prove the two USER-VISIBLE halves of the guardrail, which
// only exist in the browser:
//   (a) a failed confirm surfaces a clean outcome, not a silent success;
//   (b) the rendered library does not list the ghost book.
// Those are what this e2e test owns.
//
// How the failure is induced WITHOUT a live Google round-trip (forbidden by
// test-plan.md §4/§7): the e2e session carries no access_token, so getDriveClient
// throws DriveAuthError during confirm — a deterministic, no-network "the Drive
// write cannot complete" condition. (Deterministically simulating a mid-upload
// 5xx + orphan rollback would need a server-side Drive stub the harness doesn't
// have; that facet stays with Phase-1 integration.)

// Holds the seeded draft so afterEach removes exactly it.
let seededBookId: string | undefined;

test.afterEach(async () => {
  if (seededBookId) {
    await deleteBook(seededBookId); // book_drafts cascades on delete
    seededBookId = undefined;
  }
});

test("Risk #1: a confirm whose Drive write fails leaves no ghost book in the library", async ({
  authedPage: page,
}) => {
  // (3) Unique identifier — this title is the ghost marker. confirmDraft writes
  // the submitted title onto the row only if it persists; so if this title ever
  // shows up in the library, a confirm persisted despite the failed Drive write.
  const runId = randomUUID().slice(0, 8);
  const ghostTitle = `E2E Import Atomicity ${runId}`;

  const userId = await ensureE2eUser();
  seededBookId = await seedPendingDraft({ userId, title: ghostTitle });

  // The user is at the review step. (2) Wait on STATE: the review heading + the
  // title field pre-filled from the draft, confirming the form rendered (not the
  // AI-enrichment skeleton).
  await page.goto(`/review/${seededBookId}`);
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(ghostTitle);

  // Land the book in the library.
  await page.getByRole("button", { name: "Save & import" }).click();

  // (a) Clean, user-visible outcome — the Drive write could not complete, so the
  // user is told so and sent to reconnect; NOT silently dropped onto a success
  // page. (DriveAuthError → signOut → /signin?expired=1.)
  await expect(page).toHaveURL(/\/signin\?expired=1/);
  await expect(page.getByText(/Your Drive connection expired/)).toBeVisible();

  // The signOut cleared the cookie; re-authenticate to inspect the library as the
  // same operator (JWT sessions are stateless, so a fresh cookie just works).
  await addSessionCookie(page.context());
  await page.goto("/");

  // (b) No ghost book. Wait for the authed app shell to render first (the
  // "Library" nav exists only here, not on /signin) so the absence assertion
  // can't pass against an unrendered page; then assert the marker is nowhere in
  // the rendered library.
  await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(page.getByText(ghostTitle)).toHaveCount(0);
});
