import { randomUUID } from "node:crypto";
import { test, expect } from "./helpers/fixtures";
import { ensureE2eUser, seedConfirmedBook, deleteBook } from "./helpers/db";

// Seed / reference E2E test for this project. Copy its conventions when adding
// new specs:
//
//   1. getByRole is the default selector — query the way a user (or assistive
//      tech) perceives the UI, not by CSS class or test id. Reach for other
//      locators only when no role fits.
//   2. Wait on STATE, never on time — assert that the expected thing is visible
//      / hidden. No page.waitForTimeout, no sleeps. Playwright auto-retries the
//      assertion until it holds or the expect timeout trips.
//   3. Unique identifiers in test data — every row this test creates carries a
//      per-run id, so parallel runs and a shared dev DB never collide.
//   4. Cleanup — delete exactly what the test created (see afterEach). E2E runs
//      against a long-lived DB, so it does NOT truncate; it tidies up after
//      itself.
//   5. Test name tied to a risk — the title names the failure scenario from
//      context/foundation/test-plan.md it defends against, so a red run points
//      straight at the risk it broke.

// Holds the per-test seeded book so afterEach can delete precisely that row.
let seededBookId: string | undefined;

test.afterEach(async () => {
  if (seededBookId) {
    await deleteBook(seededBookId);
    seededBookId = undefined;
  }
});

// Risk #6 (test-plan.md §2): "Notes save silently drops content." A note that
// looks saved in the UI must still be there after a real browser refresh —
// proving it reached the DB, not just optimistic client state. Only a real
// browser + cookie + server-action + reload round-trip exercises this, which is
// why it lives in e2e rather than integration (test-plan.md §4).
test("Risk #6: a saved note survives a full page refresh", async ({ authedPage: page }) => {
  // (3) Unique identifiers — one run id threads through the book and the note.
  const runId = randomUUID().slice(0, 8);
  const bookTitle = `E2E Durability Book ${runId}`;
  const noteBody = `Durability probe note ${runId}`;

  const userId = await ensureE2eUser();
  seededBookId = await seedConfirmedBook({ userId, title: bookTitle });

  await page.goto(`/books/${seededBookId}`);
  // (1) + (2) Confirm the right page rendered by its heading role, not a class.
  await expect(page.getByRole("heading", { name: bookTitle })).toBeVisible();

  // Open the note composer and write the note. (1) buttons/dialog by role.
  await page.getByRole("button", { name: "+ New note" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill(noteBody);
  await dialog.getByRole("button", { name: "Save" }).click();

  // (2) Wait on the save-accepted STATE: the dialog closes only when the server
  // action returns ok — on failure it stays open with an inline error. So the
  // dialog disappearing is the signal the save was accepted, with no sleep.
  await expect(dialog).toBeHidden();

  // The actual Risk #6 assertion: a hard reload re-renders the page from the
  // database. If the note had only lived in client state, it would vanish here.
  await page.reload();
  await expect(page.getByText(noteBody)).toBeVisible();
});
