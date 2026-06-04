import { describe, it, beforeEach, expect, vi } from "vitest";
import { confirmReviewAction } from "@/app/actions/confirm-review";
import { getDriveClient } from "@/lib/drive/client";
import { auth } from "@/auth";
import { confirmDraft } from "@/lib/book-drafts";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { resetDb, seedDraft, readState, TEST_USER } from "../helpers/db";
import { createDriveFake } from "../helpers/drive-fake";
import { loadFixtureEpub } from "../helpers/fixtures";

vi.mock("@/lib/drive/client", () => ({ getDriveClient: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/book-drafts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/book-drafts")>();
  return { ...actual, confirmDraft: vi.fn(actual.confirmDraft) };
});

describe("confirmReviewAction", () => {
  const driveFake = createDriveFake();
  const fixtureBytes = loadFixtureEpub();

  beforeEach(async () => {
    await resetDb();
    driveFake.reset();
    vi.mocked(getDriveClient).mockResolvedValue(driveFake.client);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValue({ user: { email: TEST_USER.email } } as any);
    vi.mocked(confirmDraft).mockClear();
  });

  it("happy path: books row confirmed, Drive file present, draft row removed", async () => {
    const bookId = await seedDraft({
      filename: "test.epub",
      derivedTitle: "Test Book",
      stagedBytes: fixtureBytes,
    });

    const fd = new FormData();
    fd.set("bookId", bookId);
    fd.set("title", "Test Book");
    fd.set("author", "Test Author");
    fd.set("isbn", "");
    fd.set("coverChoice", "embedded");

    let thrown: unknown;
    try {
      await confirmReviewAction(null, fd);
    } catch (err) {
      thrown = err;
    }

    if (!isRedirectError(thrown)) throw thrown ?? new Error("Expected redirect");
    expect(getURLFromRedirectError(thrown)).toBe("/");

    const state = await readState(bookId);
    expect(state.reviewState).toBe("confirmed");
    expect(state.driveFileId).not.toBeNull();
    expect(state.hasDraft).toBe(false);
    expect(driveFake.files.has(state.driveFileId!)).toBe(true);
  });

  it("mid-upload Drive failure: books row stays pending, draft present, delete never called", async () => {
    const bookId = await seedDraft({
      filename: "test.epub",
      derivedTitle: "Test Book",
      stagedBytes: fixtureBytes,
    });

    driveFake.failNextCreate(new Error("Drive 500"));

    const fd = new FormData();
    fd.set("bookId", bookId);
    fd.set("title", "Test Book");
    fd.set("coverChoice", "");

    const result = await confirmReviewAction(null, fd);

    expect(result).toEqual({
      ok: false,
      message: "Could not finish import. Please try again.",
    });

    const state = await readState(bookId);
    expect(state.reviewState).toBe("pending");
    expect(state.driveFileId).toBeNull();
    expect(state.hasDraft).toBe(true);

    // Upload never completed, so rollback delete must not have been triggered.
    // A regression removing the `if (fileId)` guard in confirm-review.ts would call
    // delete(undefined) — the fake tracks all delete calls to catch exactly this.
    expect(driveFake.deleteCallCount).toBe(0);
    expect(driveFake.files.size).toBe(0);
  });

  it("confirm-DB failure, rollback succeeds: Drive file removed, generic error returned", async () => {
    const bookId = await seedDraft({
      filename: "test.epub",
      derivedTitle: "Test Book",
      stagedBytes: fixtureBytes,
    });

    // Force confirmDraft to fail after the Drive upload has already succeeded.
    vi.mocked(confirmDraft).mockRejectedValueOnce(
      new Error("simulated DB failure")
    );

    const fd = new FormData();
    fd.set("bookId", bookId);
    fd.set("title", "Test Book");
    fd.set("coverChoice", "");

    const result = await confirmReviewAction(null, fd);

    expect(result).toEqual({
      ok: false,
      message: "Could not finish import. Please try again.",
    });

    const state = await readState(bookId);
    expect(state.reviewState).toBe("pending");
    expect(state.driveFileId).toBeNull();
    expect(state.hasDraft).toBe(true);

    // Rollback delete was called and succeeded — Drive fake is now empty.
    expect(driveFake.deleteCallCount).toBe(1);
    expect(driveFake.files.size).toBe(0);
  });

  it("confirm-DB failure + rollback also fails: orphan file stays in Drive (per epub-import-to-drive plan's accepted contract)", async () => {
    const bookId = await seedDraft({
      filename: "test.epub",
      derivedTitle: "Test Book",
      stagedBytes: fixtureBytes,
    });

    vi.mocked(confirmDraft).mockRejectedValueOnce(
      new Error("simulated DB failure")
    );
    // The rollback delete will also fail — orphan file is intentionally left behind.
    // This is consistent with the app-independent library guardrail: the file remains
    // navigable in Google Drive even without the app. See epub-import-to-drive plan §rollback.
    driveFake.failNextDelete(new Error("Drive delete 500"));

    const fd = new FormData();
    fd.set("bookId", bookId);
    fd.set("title", "Test Book");
    fd.set("coverChoice", "");

    const result = await confirmReviewAction(null, fd);

    expect(result).toEqual({
      ok: false,
      message: "Could not finish import. Please try again.",
    });

    const state = await readState(bookId);
    expect(state.reviewState).toBe("pending");
    expect(state.driveFileId).toBeNull();
    expect(state.hasDraft).toBe(true);

    // Orphan: rollback delete was attempted but failed → file still present in Drive.
    expect(driveFake.deleteCallCount).toBe(1);
    expect(driveFake.files.size).toBeGreaterThanOrEqual(1);
  });

  it("unauthorized session: redirect to /signin, Drive not touched", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValue(null as any);

    const fd = new FormData();
    fd.set("bookId", "any-id");
    fd.set("title", "Test Book");
    fd.set("coverChoice", "");

    let thrown: unknown;
    try {
      await confirmReviewAction(null, fd);
    } catch (err) {
      thrown = err;
    }

    if (!isRedirectError(thrown)) throw thrown ?? new Error("Expected redirect");
    expect(getURLFromRedirectError(thrown)).toBe("/signin");

    expect(driveFake.deleteCallCount).toBe(0);
    expect(driveFake.files.size).toBe(0);
  });
});
