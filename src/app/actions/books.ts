"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { drive_v3 } from "googleapis";
import { auth, signOut } from "@/auth";
import { getDriveClient } from "@/lib/drive/client";
import { DriveAuthError } from "@/lib/drive/errors";
import { getOrCreateLibraryFolder, getOrCreateTrashFolder } from "@/lib/drive/library-folder";
import { composeFilename, findAvailableFilename } from "@/lib/drive/upload";
import { moveDriveFile } from "@/lib/drive/trash";
import { getUserIdByEmail } from "@/lib/users";
import { trashConfirmedBook, restoreTrashedBook } from "@/lib/books";
import { db } from "@/lib/db";

export async function trashBookAction(
  bookId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const userId = await getUserIdByEmail(session.user.email);

  const book = await db
    .selectFrom("books")
    .select(["drive_file_id", "title", "author", "series", "part"])
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .where("trashed_at", "is", null)
    .executeTakeFirst();

  if (!book) return { ok: false, message: "Book not found." };

  if (!book.drive_file_id) {
    console.warn(`trashBookAction: book ${bookId} has no drive_file_id — skipping Drive move`);
    const result = await trashConfirmedBook(bookId, userId);
    if (!result) return { ok: false, message: "Could not trash book. Please try again." };
    revalidatePath("/");
    revalidatePath(`/books/${bookId}`);
    return { ok: true };
  }

  let drive: drive_v3.Drive;
  try {
    drive = await getDriveClient();
  } catch (e) {
    if (e instanceof DriveAuthError) {
      await signOut({ redirect: false });
      redirect("/signin?expired=1");
    }
    throw e;
  }

  const libraryFolderId = await getOrCreateLibraryFolder(drive, session.user.email);
  const trashFolderId = await getOrCreateTrashFolder(drive, libraryFolderId);

  const desired = composeFilename({
    author: book.author,
    series: book.series,
    part: book.part,
    title: book.title,
  });
  const driveFileId = book.drive_file_id;

  let originalName: string;
  try {
    const nameRes = await drive.files.get({ fileId: driveFileId, fields: "name" });
    originalName = nameRes.data.name ?? desired;
  } catch (e: unknown) {
    const code = (e as { code?: number }).code;
    if (code === 404) {
      console.warn(
        `trashBookAction: book ${bookId} file not found in Drive (404) — proceeding DB-only`
      );
      const result = await trashConfirmedBook(bookId, userId);
      if (!result) return { ok: false, message: "Could not trash book. Please try again." };
      revalidatePath("/");
      revalidatePath(`/books/${bookId}`);
      return { ok: true };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Drive file lookup failed: ${msg}` };
  }

  const finalName = await findAvailableFilename(drive, trashFolderId, desired);

  let driveMoveDone = false;
  try {
    await moveDriveFile(drive, driveFileId, libraryFolderId, trashFolderId, finalName);
    driveMoveDone = true;
  } catch (e: unknown) {
    const code = (e as { code?: number }).code;
    if (code === 404) {
      console.warn(
        `trashBookAction: book ${bookId} file not found in Drive (404) — proceeding DB-only`
      );
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: `Drive move failed: ${msg}` };
    }
  }

  try {
    const result = await trashConfirmedBook(bookId, userId);
    if (!result) {
      if (driveMoveDone) {
        try {
          // restore original filename — forward move renamed file to finalName in Trash
          await moveDriveFile(drive, driveFileId, trashFolderId, libraryFolderId, originalName);
        } catch (rollbackErr) {
          console.error("trashBookAction: Drive rollback failed:", rollbackErr);
        }
      }
      return { ok: false, message: "Could not trash book. Please try again." };
    }
  } catch (e) {
    if (driveMoveDone) {
      try {
        // restore original filename — forward move renamed file to finalName in Trash
        await moveDriveFile(drive, driveFileId, trashFolderId, libraryFolderId, originalName);
      } catch (rollbackErr) {
        console.error("trashBookAction: Drive rollback failed:", rollbackErr);
      }
    }
    console.error("trashBookAction: DB update failed:", e);
    return { ok: false, message: "Could not trash book. Please try again." };
  }

  revalidatePath("/");
  revalidatePath(`/books/${bookId}`);
  return { ok: true };
}

export async function restoreBookAction(
  bookId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const userId = await getUserIdByEmail(session.user.email);

  const book = await db
    .selectFrom("books")
    .select(["drive_file_id", "title", "author", "series", "part"])
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .where("trashed_at", "is not", null)
    .executeTakeFirst();

  if (!book) return { ok: false, message: "Book is not in trash." };

  if (!book.drive_file_id) {
    console.warn(`restoreBookAction: book ${bookId} has no drive_file_id — skipping Drive move`);
    const result = await restoreTrashedBook(bookId, userId);
    if (!result) return { ok: false, message: "Could not restore book. Please try again." };
    revalidatePath("/");
    revalidatePath("/trash");
    revalidatePath(`/books/${bookId}`);
    return { ok: true };
  }

  let drive: drive_v3.Drive;
  try {
    drive = await getDriveClient();
  } catch (e) {
    if (e instanceof DriveAuthError) {
      await signOut({ redirect: false });
      redirect("/signin?expired=1");
    }
    throw e;
  }

  const libraryFolderId = await getOrCreateLibraryFolder(drive, session.user.email);
  const trashFolderId = await getOrCreateTrashFolder(drive, libraryFolderId);

  const driveFileId = book.drive_file_id;

  let originalName: string;
  try {
    const nameRes = await drive.files.get({ fileId: driveFileId, fields: "name" });
    originalName =
      nameRes.data.name ??
      composeFilename({
        author: book.author,
        series: book.series,
        part: book.part,
        title: book.title,
      });
  } catch (e: unknown) {
    const code = (e as { code?: number }).code;
    if (code === 404) {
      console.warn(
        `restoreBookAction: book ${bookId} file not found in Drive (404) — proceeding DB-only`
      );
      const result = await restoreTrashedBook(bookId, userId);
      if (!result) return { ok: false, message: "Could not restore book. Please try again." };
      revalidatePath("/");
      revalidatePath("/trash");
      revalidatePath(`/books/${bookId}`);
      return { ok: true };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Drive file lookup failed: ${msg}` };
  }

  const desired = composeFilename({
    author: book.author,
    series: book.series,
    part: book.part,
    title: book.title,
  });
  const finalName = await findAvailableFilename(drive, libraryFolderId, desired);

  let driveMoveDone = false;
  try {
    await moveDriveFile(drive, driveFileId, trashFolderId, libraryFolderId, finalName);
    driveMoveDone = true;
  } catch (e: unknown) {
    const code = (e as { code?: number }).code;
    if (code === 404) {
      console.warn(
        `restoreBookAction: book ${bookId} file not found in Drive (404) — proceeding DB-only`
      );
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: `Drive move failed: ${msg}` };
    }
  }

  try {
    const result = await restoreTrashedBook(bookId, userId);
    if (!result) {
      if (driveMoveDone) {
        try {
          // restore original name — forward move renamed file to finalName in Library
          await moveDriveFile(drive, driveFileId, libraryFolderId, trashFolderId, originalName);
        } catch (rollbackErr) {
          console.error("restoreBookAction: Drive rollback failed:", rollbackErr);
        }
      }
      return { ok: false, message: "Could not restore book. Please try again." };
    }
  } catch (e) {
    if (driveMoveDone) {
      try {
        // restore original name — forward move renamed file to finalName in Library
        await moveDriveFile(drive, driveFileId, libraryFolderId, trashFolderId, originalName);
      } catch (rollbackErr) {
        console.error("restoreBookAction: Drive rollback failed:", rollbackErr);
      }
    }
    console.error("restoreBookAction: DB update failed:", e);
    return { ok: false, message: "Could not restore book. Please try again." };
  }

  revalidatePath("/");
  revalidatePath("/trash");
  revalidatePath(`/books/${bookId}`);
  return { ok: true };
}
