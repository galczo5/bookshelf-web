"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { getDriveClient } from "@/lib/drive/client";
import { DriveAuthError } from "@/lib/drive/errors";
import { getOrCreateLibraryFolder } from "@/lib/drive/library-folder";
import { composeFilename } from "@/lib/drive/upload";
import { renameWorkingCopy } from "@/lib/drive/rename";
import { getUserIdByEmail } from "@/lib/users";
import { getConfirmedBook, updateBookMetadata, setWorkingCopyFilename } from "@/lib/books";
import { db } from "@/lib/db";
import { enrichBook, EnrichmentFailedError } from "@/lib/enrichment/client";
import { fetchCover } from "@/lib/enrichment/fetch-cover";
import type { EnrichmentInput, EnrichmentProposals } from "@/lib/enrichment/types";

export type EnrichMetadataState = {
  ok: boolean;
  proposals?: EnrichmentProposals;
  message?: string;
};

export async function enrichMetadataAction(
  _prev: EnrichMetadataState,
  formData: FormData
): Promise<EnrichMetadataState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookId = String(formData.get("bookId") ?? "").trim();
  if (!bookId) return { ok: false, message: "Missing book id" };

  try {
    const userId = await getUserIdByEmail(session.user.email);
    const book = await getConfirmedBook(bookId, userId);
    if (!book) return { ok: false, message: "Book not found" };

    const filename = [book.author, book.title].filter(Boolean).join(" - ") + ".epub";
    const input: EnrichmentInput = {
      filename,
      embeddedTitle: book.title || null,
      embeddedAuthor: book.author,
      embeddedIsbn: book.isbn,
      frontMatterStrings: [],
    };

    const proposals = await enrichBook(input);
    return { ok: true, proposals };
  } catch (err) {
    if (err instanceof EnrichmentFailedError) {
      return { ok: false, message: "Enrichment failed. Please try again." };
    }
    return { ok: false, message: "Enrichment failed. Please try again." };
  }
}

export type ApplyMetadataState =
  | null
  | { ok: false; message: string }
  | { ok: true; renameWarning?: boolean };

export async function applyMetadataAction(
  _prev: ApplyMetadataState,
  formData: FormData
): Promise<ApplyMetadataState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookId = String(formData.get("bookId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const author = String(formData.get("author") ?? "").trim();
  const isbn = String(formData.get("isbn") ?? "").trim();
  const publisher = String(formData.get("publisher") ?? "").trim();
  const language = String(formData.get("language") ?? "").trim();
  const publishedDate = String(formData.get("publishedDate") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const seriesRaw = String(formData.get("series") ?? "").trim();
  const partRaw = String(formData.get("part") ?? "").trim();
  const coverChoice = String(formData.get("coverChoice") ?? "").trim();

  if (!bookId) return { ok: false, message: "Missing book id" };
  if (!title) return { ok: false, message: "Title is required" };

  const userId = await getUserIdByEmail(session.user.email);

  let cover: { bytes: Buffer; mime: string } | undefined;
  if (coverChoice.startsWith("ai:")) {
    try {
      cover = await fetchCover(coverChoice.slice(3));
    } catch {
      return { ok: false, message: "Could not download the chosen cover. Pick another or skip." };
    }
  }

  const series = seriesRaw || null;
  const part = partRaw || null;

  const result = await updateBookMetadata(bookId, userId, {
    title,
    author: author || null,
    isbn: isbn || null,
    publisher: publisher || null,
    language: language || null,
    publishedDate: publishedDate || null,
    description: description || null,
    series,
    part,
    cover,
  });

  if (!result) return { ok: false, message: "Book not found" };

  // Attempt Drive rename if a name field changed.
  const driveRow = await db
    .selectFrom("books")
    .select(["drive_file_id", "drive_file_name"])
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  const desired = composeFilename({ author: author || null, series, part, title });
  let renameWarning = false;

  if (driveRow?.drive_file_id && desired !== driveRow.drive_file_name) {
    try {
      const drive = await getDriveClient();
      const folderId = await getOrCreateLibraryFolder(drive, session.user.email!);
      const finalName = await renameWorkingCopy(drive, driveRow.drive_file_id, folderId, desired);
      await setWorkingCopyFilename(bookId, userId, {
        driveFileName: finalName,
        renamePending: false,
      });
    } catch (e) {
      if (e instanceof DriveAuthError) {
        await signOut({ redirect: false });
        redirect("/signin?expired=1");
      }
      renameWarning = true;
      await setWorkingCopyFilename(bookId, userId, { renamePending: true });
    }
  }

  revalidatePath(`/books/${bookId}`);
  return { ok: true, ...(renameWarning && { renameWarning: true }) };
}
