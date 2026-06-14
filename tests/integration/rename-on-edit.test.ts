import { describe, it, beforeEach, expect, vi } from "vitest";
import { applyMetadataAction } from "@/app/actions/enrich-metadata";
import { retryRenameAction } from "@/app/actions/books";
import { getDriveClient } from "@/lib/drive/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { resetDb, TEST_USER } from "../helpers/db";
import { createDriveFake } from "../helpers/drive-fake";

vi.mock("@/lib/drive/client", () => ({ getDriveClient: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const driveFake = createDriveFake();

async function seedConfirmedBook(opts: {
  title: string;
  author: string | null;
  driveFileId: string;
  driveFileName: string;
  renamePending?: boolean;
}): Promise<string> {
  const row = await db
    .insertInto("books")
    .values({
      user_id: TEST_USER.id,
      drive_file_id: opts.driveFileId,
      drive_file_name: opts.driveFileName,
      title: opts.title,
      author: opts.author,
      review_state: "confirmed",
      rename_pending: opts.renamePending ?? false,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function readBookDriveState(bookId: string) {
  return db
    .selectFrom("books")
    .select(["drive_file_name", "rename_pending", "series", "part"])
    .where("id", "=", bookId)
    .executeTakeFirstOrThrow();
}

function applyFd(bookId: string, overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("bookId", bookId);
  fd.set("title", "Some Title");
  fd.set("author", "Some Author");
  fd.set("isbn", "");
  fd.set("publisher", "");
  fd.set("language", "");
  fd.set("publishedDate", "");
  fd.set("description", "");
  fd.set("series", "");
  fd.set("part", "");
  fd.set("coverChoice", "");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

describe("rename-on-edit (applyMetadataAction)", () => {
  beforeEach(async () => {
    await resetDb();
    driveFake.reset();
    vi.mocked(getDriveClient).mockResolvedValue(driveFake.client);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValue({ user: { email: TEST_USER.email } } as any);
  });

  it("changing title renames the working copy and clears rename_pending", async () => {
    const result1 = await driveFake.client.files.create({
      requestBody: { name: "Some Author - Old Title.epub", parents: ["lib"] },
      media: { mimeType: "application/epub+zip", body: Buffer.from("") },
    });
    const fileId = result1.data.id!;

    const bookId = await seedConfirmedBook({
      title: "Old Title",
      author: "Some Author",
      driveFileId: fileId,
      driveFileName: "Some Author - Old Title.epub",
    });

    const result = await applyMetadataAction(null, applyFd(bookId, { title: "New Title" }));

    expect(result).toEqual({ ok: true });
    const state = await readBookDriveState(bookId);
    expect(state.drive_file_name).toBe("Some Author - New Title.epub");
    expect(state.rename_pending).toBe(false);
    expect(driveFake.files.get(fileId)?.name).toBe("Some Author - New Title.epub");
  });

  it("editing a non-name field does not rename the file", async () => {
    const bookId = await seedConfirmedBook({
      title: "Some Title",
      author: "Some Author",
      driveFileId: "file-no-rename",
      driveFileName: "Some Author - Some Title.epub",
    });

    const result = await applyMetadataAction(null, applyFd(bookId, { publisher: "New Publisher" }));

    expect(result).toEqual({ ok: true });
    const state = await readBookDriveState(bookId);
    expect(state.drive_file_name).toBe("Some Author - Some Title.epub");
    expect(state.rename_pending).toBe(false);
  });

  it("Drive rename failure sets rename_pending and returns renameWarning", async () => {
    const bookId = await seedConfirmedBook({
      title: "Old Title",
      author: "Some Author",
      driveFileId: "file-rename-fail",
      driveFileName: "Some Author - Old Title.epub",
    });

    const brokenClient = {
      ...driveFake.client,
      files: {
        ...driveFake.client.files,
        update: async () => {
          throw new Error("Drive 503");
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getDriveClient).mockResolvedValue(brokenClient as any);

    const result = await applyMetadataAction(null, applyFd(bookId, { title: "New Title" }));

    expect(result).toEqual({ ok: true, renameWarning: true });
    const state = await readBookDriveState(bookId);
    expect(state.drive_file_name).toBe("Some Author - Old Title.epub");
    expect(state.rename_pending).toBe(true);
  });
});

describe("retryRenameAction", () => {
  beforeEach(async () => {
    await resetDb();
    driveFake.reset();
    vi.mocked(getDriveClient).mockResolvedValue(driveFake.client);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValue({ user: { email: TEST_USER.email } } as any);
  });

  it("succeeds when Drive is reachable and clears rename_pending", async () => {
    const created = await driveFake.client.files.create({
      requestBody: { name: "Some Author - Old Title.epub", parents: ["lib"] },
      media: { mimeType: "application/epub+zip", body: Buffer.from("") },
    });
    const fileId = created.data.id!;

    const bookId = await seedConfirmedBook({
      title: "New Title",
      author: "Some Author",
      driveFileId: fileId,
      driveFileName: "Some Author - Old Title.epub",
      renamePending: true,
    });

    const result = await retryRenameAction(bookId);

    expect(result).toEqual({ ok: true });
    const state = await readBookDriveState(bookId);
    expect(state.drive_file_name).toBe("Some Author - New Title.epub");
    expect(state.rename_pending).toBe(false);
    expect(driveFake.files.get(fileId)?.name).toBe("Some Author - New Title.epub");
  });

  it("returns error when Drive rename fails, leaves rename_pending true", async () => {
    const bookId = await seedConfirmedBook({
      title: "New Title",
      author: "Some Author",
      driveFileId: "non-existent-file",
      driveFileName: "Some Author - Old.epub",
      renamePending: true,
    });

    const result = await retryRenameAction(bookId);

    expect(result).toMatchObject({ ok: false });
    const state = await readBookDriveState(bookId);
    expect(state.rename_pending).toBe(true);
  });
});
