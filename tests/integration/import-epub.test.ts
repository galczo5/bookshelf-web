import { describe, it, beforeEach, expect, vi } from "vitest";
import { importEpubAction } from "@/app/actions/import-epub";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { resetDb, TEST_USER } from "../helpers/db";
import { loadFixtureEpub } from "../helpers/fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }));

describe("importEpubAction", () => {
  const fixtureBytes = loadFixtureEpub();

  beforeEach(async () => {
    await resetDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValue({ user: { email: TEST_USER.email } } as any);
  });

  it("happy import: draft created, redirects to /review/<bookId>", async () => {
    const ab = fixtureBytes.buffer.slice(
      fixtureBytes.byteOffset,
      fixtureBytes.byteOffset + fixtureBytes.byteLength
    ) as ArrayBuffer;
    const file = new File([ab], "minimal.epub", {
      type: "application/epub+zip",
    });
    const fd = new FormData();
    fd.set("file", file);

    let thrown: unknown;
    try {
      await importEpubAction(null, fd);
    } catch (err) {
      thrown = err;
    }

    if (!isRedirectError(thrown)) throw thrown ?? new Error("Expected redirect");
    const redirectUrl = getURLFromRedirectError(thrown);
    expect(redirectUrl).toMatch(/^\/review\/.+/);

    const bookId = redirectUrl.replace("/review/", "");

    const book = await db
      .selectFrom("books")
      .select(["review_state", "drive_file_id"])
      .where("id", "=", bookId)
      .executeTakeFirstOrThrow();

    expect(book.review_state).toBe("pending");
    expect(book.drive_file_id).toBeNull();

    const draft = await db
      .selectFrom("book_drafts")
      .select("book_id")
      .where("book_id", "=", bookId)
      .executeTakeFirst();

    expect(draft).not.toBeUndefined();
  });

  it("invalid epub: returns error, no books row inserted", async () => {
    const file = new File([new TextEncoder().encode("not-an-epub")], "bad.epub", {
      type: "application/epub+zip",
    });
    const fd = new FormData();
    fd.set("file", file);

    const result = await importEpubAction(null, fd);

    expect(result).toEqual({
      ok: false,
      message: "This file does not look like a valid epub.",
    });

    const count = await db
      .selectFrom("books")
      .select((eb) => eb.fn.count("id").as("n"))
      .executeTakeFirstOrThrow();

    expect(Number(count.n)).toBe(0);
  });
});
