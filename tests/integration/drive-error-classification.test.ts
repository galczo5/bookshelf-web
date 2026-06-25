/**
 * Characterization tests for Risk #3 — Drive API error misclassification
 * (`context/foundation/test-plan.md` §2 Risk #3).
 *
 * These pin how every Drive-touching path classifies errors TODAY. There is no
 * central Drive error classifier: each call site only ever distinguishes a
 * pre-flight `DriveAuthError` (session state) and, at two sites, a raw `404`.
 * Everything else (live-401 / 429 / 5xx / quota) collapses into one generic
 * outcome per call site.
 *
 * Tests assert OBSERVABLE OUTCOMES ONLY (returned state object, thrown redirect
 * URL, HTTP Response status/JSON, DB state) — never the SQL or the internal
 * branch — so they survive refactors but catch behavior changes.
 *
 * Three known defects are encoded as passing, labeled tests (KNOWN GAP /
 * KNOWN MISCLASS). They are the breadcrumb for the future classifier change:
 * each carries a comment naming the source line and what reversing it would prove.
 * See §6.6 / §6.7 in the test plan.
 */
import { describe, it, beforeAll, beforeEach, expect, vi } from "vitest";
import { sql } from "kysely";

import { confirmReviewAction } from "@/app/actions/confirm-review";
import { trashBookAction, restoreBookAction } from "@/app/actions/books";
import { checkDriveAction } from "@/app/actions/check-drive";
import { runSyncCheckNowAction, importFromDriveAction } from "@/app/actions/drive-sync";
import { applyMetadataAction } from "@/app/actions/enrich-metadata";
import { GET as downloadRoute } from "@/app/api/books/[id]/download/route";
import { GET as epubMetadataRoute } from "@/app/api/books/[id]/epub-metadata/route";

import { getDriveClient } from "@/lib/drive/client";
import { auth } from "@/auth";
import { checkDriveConnection } from "@/lib/drive/connection-check";
import { runSyncCheckNow } from "@/lib/drive/run-sync-check";
import { DriveAuthError } from "@/lib/drive/errors";
import {
  getOrCreateLibraryFolder,
  getOrCreateTrashFolder,
  getOrCreateOriginalFilesFolder,
} from "@/lib/drive/library-folder";
import { db } from "@/lib/db";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";

import { resetDb, seedDraft, seedBook, readState, TEST_USER } from "../helpers/db";
import { createDriveFake, driveError } from "../helpers/drive-fake";
import { loadFixtureEpub } from "../helpers/fixtures";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/drive/client", () => ({ getDriveClient: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/drive/connection-check", () => ({ checkDriveConnection: vi.fn() }));
vi.mock("@/lib/drive/run-sync-check", () => ({
  runSyncCheckNow: vi.fn(),
  runSyncCheckIfStale: vi.fn(),
}));

const driveFake = createDriveFake();
const fixtureBytes = loadFixtureEpub();

/** Run the body, returning the redirect URL it threw — or fail if it didn't redirect. */
async function captureRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (isRedirectError(err)) return getURLFromRedirectError(err);
    throw err;
  }
  throw new Error("Expected a redirect, but none was thrown");
}

/** Run the body, returning whatever it threw (and asserting it was NOT a redirect). */
async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    if (isRedirectError(err)) throw new Error("Expected a non-redirect throw, got a redirect");
    return err;
  }
  throw new Error("Expected a throw, but none occurred");
}

async function seedTrashedBook(): Promise<string> {
  const id = await seedBook();
  await db
    .updateTable("books")
    .set({ trashed_at: sql`NOW()` })
    .where("id", "=", id)
    .execute();
  return id;
}

async function trashedAt(bookId: string): Promise<Date | null> {
  const row = await db
    .selectFrom("books")
    .select("trashed_at")
    .where("id", "=", bookId)
    .executeTakeFirstOrThrow();
  return (row.trashed_at as Date | null) ?? null;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Drive error classification (characterization)", () => {
  // Warm the module-level folder caches in library-folder.ts so the upload / trash /
  // restore / rename paths resolve folders from cache instead of hitting the fake.
  // This makes injected failures (failNextCreate/Get/Update) land on the targeted
  // operation rather than on incidental folder list/create calls.
  beforeAll(async () => {
    const lib = await getOrCreateLibraryFolder(driveFake.client, TEST_USER.email);
    await getOrCreateTrashFolder(driveFake.client, lib);
    await getOrCreateOriginalFilesFolder(driveFake.client, lib);
  });

  beforeEach(async () => {
    await resetDb();
    driveFake.reset();
    vi.mocked(getDriveClient).mockResolvedValue(driveFake.client);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValue({ user: { email: TEST_USER.email } } as any);
  });

  describe("confirm-review (upload)", () => {
    it("KNOWN GAP: live 401 from a Drive write is NOT re-auth'd — generic message, no redirect", async () => {
      // confirm-review.ts:102 catches with `if (e instanceof DriveAuthError)`. A live
      // `code===401` from drive.files.* is a plain Gaxios error, NOT a DriveAuthError,
      // so it falls through to the generic rollback path instead of redirecting to
      // /signin?expired=1. Reversing this (treating code===401 as DriveAuthError) would
      // make this redirect and throw NEXT_REDIRECT, failing the equality below.
      const bookId = await seedDraft({
        filename: "test.epub",
        derivedTitle: "Test Book",
        stagedBytes: fixtureBytes,
      });
      driveFake.failNextCreate(driveError(401));

      const fd = new FormData();
      fd.set("bookId", bookId);
      fd.set("title", "Test Book");
      fd.set("coverChoice", "");

      const result = await confirmReviewAction(null, fd);

      expect(result).toEqual({ ok: false, message: "Could not finish import. Please try again." });
    });

    it("contrast: a pre-flight DriveAuthError DOES redirect to /signin?expired=1", async () => {
      vi.mocked(getDriveClient).mockRejectedValue(new DriveAuthError());
      const bookId = await seedDraft({
        filename: "test.epub",
        derivedTitle: "Test Book",
        stagedBytes: fixtureBytes,
      });

      const fd = new FormData();
      fd.set("bookId", bookId);
      fd.set("title", "Test Book");
      fd.set("coverChoice", "");

      const url = await captureRedirect(() => confirmReviewAction(null, fd));
      expect(url).toBe("/signin?expired=1");
    });
  });

  describe("books trashBookAction", () => {
    it("raw 404 on files.get → DB-only trash succeeds (Drive not required)", async () => {
      const bookId = await seedBook();
      driveFake.failNextGet(driveError(404));

      const result = await trashBookAction(bookId);

      expect(result).toEqual({ ok: true });
      expect(await trashedAt(bookId)).toBeInstanceOf(Date);
    });

    it("KNOWN GAP: transient 429 is not retried — surfaced as a terminal lookup failure, DB unchanged", async () => {
      // books.ts:71 only special-cases code===404; any other code (here 429) returns a
      // generic `Drive file lookup failed: …` and the book stays untrashed. The exact 429
      // message proves a single attempt: a retry would re-call files.get, find no file in
      // the fake, and surface a 404 → DB-only trash → {ok:true} instead.
      const bookId = await seedBook();
      driveFake.failNextGet(driveError(429));

      const result = await trashBookAction(bookId);

      expect(result).toEqual({
        ok: false,
        message: "Drive file lookup failed: Drive API error 429",
      });
      expect(await trashedAt(bookId)).toBeNull();
    });
  });

  describe("books restoreBookAction", () => {
    it("raw 404 on files.get → DB-only restore succeeds (Drive not required)", async () => {
      const bookId = await seedTrashedBook();
      driveFake.failNextGet(driveError(404));

      const result = await restoreBookAction(bookId);

      expect(result).toEqual({ ok: true });
      expect(await trashedAt(bookId)).toBeNull();
    });

    it("KNOWN GAP: transient 503 is not retried — surfaced as a terminal lookup failure, stays trashed", async () => {
      // books.ts:193 mirrors the trash path: only code===404 is special-cased; a 503
      // surfaces generically and the book stays in trash. Reversing the code===404 branch
      // would change the 404 sibling test's outcome.
      const bookId = await seedTrashedBook();
      driveFake.failNextGet(driveError(503));

      const result = await restoreBookAction(bookId);

      expect(result).toEqual({
        ok: false,
        message: "Drive file lookup failed: Drive API error 503",
      });
      expect(await trashedAt(bookId)).toBeInstanceOf(Date);
    });
  });

  describe("check-drive", () => {
    it("DriveAuthError → redirect to /signin?expired=1", async () => {
      vi.mocked(checkDriveConnection).mockRejectedValue(new DriveAuthError());

      const url = await captureRedirect(() => checkDriveAction(null, new FormData()));
      expect(url).toBe("/signin?expired=1");
    });

    it("non-auth 500 → generic { ok:false, message } with the raw error text", async () => {
      vi.mocked(checkDriveConnection).mockRejectedValue(driveError(500));

      const result = await checkDriveAction(null, new FormData());
      expect(result).toEqual({ ok: false, message: "Drive API error 500" });
    });
  });

  describe("drive-sync", () => {
    it("runSyncCheckNowAction: DriveAuthError → redirect to /signin?expired=1", async () => {
      vi.mocked(runSyncCheckNow).mockRejectedValue(new DriveAuthError());

      const url = await captureRedirect(() => runSyncCheckNowAction());
      expect(url).toBe("/signin?expired=1");
    });

    it("runSyncCheckNowAction: non-auth 500 → re-thrown raw (not a redirect)", async () => {
      vi.mocked(runSyncCheckNow).mockRejectedValue(driveError(500));

      const err = await captureThrow(() => runSyncCheckNowAction());
      expect((err as { code?: number }).code).toBe(500);
    });

    it("importFromDriveAction: DriveAuthError → redirect to /signin?expired=1", async () => {
      vi.mocked(getDriveClient).mockRejectedValue(new DriveAuthError());

      const fd = new FormData();
      fd.set("fileId", "drive-x");
      fd.set("fileName", "x.epub");

      const url = await captureRedirect(() => importFromDriveAction(fd));
      expect(url).toBe("/signin?expired=1");
    });

    it("importFromDriveAction: non-auth 500 on files.get → re-thrown raw (not a redirect)", async () => {
      driveFake.failNextGet(driveError(500));

      const fd = new FormData();
      fd.set("fileId", "drive-x");
      fd.set("fileName", "x.epub");

      const err = await captureThrow(() => importFromDriveAction(fd));
      expect((err as { code?: number }).code).toBe(500);
    });
  });

  describe("enrich-metadata (rename working copy)", () => {
    it("non-auth 500 on rename is swallowed → { ok:true, renameWarning:true } with renamePending persisted", async () => {
      const bookId = await seedBook(); // drive_file_name = "Seed Author - Seed Title.epub"
      driveFake.failNextUpdate(driveError(500));

      const fd = new FormData();
      fd.set("bookId", bookId);
      fd.set("title", "New Title"); // differs → triggers the rename path
      fd.set("author", "Seed Author");

      const result = await applyMetadataAction(null, fd);

      expect(result).toEqual({ ok: true, renameWarning: true });
      expect((await readState(bookId)).renamePending).toBe(true);
    });
  });

  describe("download route (GET)", () => {
    it("KNOWN MISCLASS: raw 404 is surfaced as 502 (indistinguishable from transient)", async () => {
      // download/route.ts:48 maps any files.get error → 502 "Could not reach Google Drive",
      // so a genuine 404 (file gone) is reported as a transient Drive-unreachable error.
      // Reversing this (mapping 404 → a distinct 404/410 response) would change this status.
      const bookId = await seedBook();
      driveFake.failNextGet(driveError(404));

      const res = await downloadRoute(new Request("http://test/"), params(bookId));
      expect(res.status).toBe(502);
    });

    it("transient 500 also → 502 (collapse: 404 and 5xx are indistinguishable here)", async () => {
      const bookId = await seedBook();
      driveFake.failNextGet(driveError(500));

      const res = await downloadRoute(new Request("http://test/"), params(bookId));
      expect(res.status).toBe(502);
    });
  });

  describe("epub-metadata route (GET)", () => {
    it("KNOWN MISCLASS: raw 404 → { available:false, reason:'drive_error' } (404 indistinguishable)", async () => {
      // epub-metadata/route.ts:83 maps any files.get error → reason:"drive_error", collapsing
      // a true 404 into the same bucket as a transient failure. Reversing this would require a
      // distinct reason for 404 and change this JSON.
      const bookId = await seedBook();
      driveFake.failNextGet(driveError(404));

      const res = await epubMetadataRoute(new Request("http://test/"), params(bookId));
      expect(await res.json()).toEqual({ available: false, reason: "drive_error" });
    });

    it("transient 500 also → { available:false, reason:'drive_error' } (collapse)", async () => {
      const bookId = await seedBook();
      driveFake.failNextGet(driveError(500));

      const res = await epubMetadataRoute(new Request("http://test/"), params(bookId));
      expect(await res.json()).toEqual({ available: false, reason: "drive_error" });
    });
  });
});
