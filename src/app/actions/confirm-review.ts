"use server";

import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDriveClient } from "@/lib/drive/client";
import { DriveAuthError } from "@/lib/drive/errors";
import { getOrCreateLibraryFolder } from "@/lib/drive/library-folder";
import { uploadBookToDrive, findAvailableFilename, composeFilename } from "@/lib/drive/upload";
import { getUserIdByEmail } from "@/lib/users";
import { getDraftWithBook, confirmDraft } from "@/lib/book-drafts";
import { fetchCover } from "@/lib/enrichment/fetch-cover";

export type ConfirmReviewState = null | { ok: false; message: string };

export async function confirmReviewAction(
  _prev: ConfirmReviewState,
  formData: FormData
): Promise<ConfirmReviewState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookId = String(formData.get("bookId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const author = String(formData.get("author") ?? "").trim();
  const isbn = String(formData.get("isbn") ?? "").trim();
  const coverChoice = String(formData.get("coverChoice") ?? "").trim();

  if (!bookId) return { ok: false, message: "Missing draft id" };
  if (!title) return { ok: false, message: "Title is required" };

  const userId = await getUserIdByEmail(session.user.email);
  const draft = await getDraftWithBook(bookId, userId);
  if (!draft) return { ok: false, message: "Draft not found" };

  let coverBytes: Buffer | null = null;
  let coverMime: string | null = null;

  if (coverChoice === "embedded") {
    coverBytes = draft.embedded.coverBytes;
    coverMime = draft.embedded.coverMime;
  } else if (coverChoice.startsWith("ai:")) {
    const url = coverChoice.slice(3);
    try {
      const fetched = await fetchCover(url);
      coverBytes = fetched.bytes;
      coverMime = fetched.mime;
    } catch {
      return {
        ok: false,
        message: "Could not download the chosen cover. Pick another or skip.",
      };
    }
  }

  let fileId: string | undefined;

  try {
    const drive = await getDriveClient();
    const folderId = await getOrCreateLibraryFolder(drive, session.user.email);
    const desired = composeFilename({ author: author || null, series: null, part: null, title });
    const finalName = await findAvailableFilename(drive, folderId, desired);
    fileId = await uploadBookToDrive(drive, folderId, finalName, draft.stagedBytes);

    await confirmDraft(bookId, userId, {
      title,
      author: author || null,
      isbn: isbn || null,
      coverBytes,
      coverMime,
      driveFileId: fileId,
    });
  } catch (e) {
    if (e instanceof DriveAuthError) {
      await signOut({ redirect: false });
      redirect("/signin?expired=1");
    }
    if (fileId) {
      try {
        const drive = await getDriveClient();
        await drive.files.delete({ fileId });
      } catch (deleteErr) {
        console.error("Rollback delete failed:", deleteErr);
      }
    }
    console.error("Confirm review failed:", e);
    return { ok: false, message: "Could not finish import. Please try again." };
  }

  redirect("/");
}
