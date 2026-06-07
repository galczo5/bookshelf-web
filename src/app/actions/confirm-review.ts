"use server";

import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDriveClient } from "@/lib/drive/client";
import { DriveAuthError } from "@/lib/drive/errors";
import { getOrCreateLibraryFolder } from "@/lib/drive/library-folder";
import { uploadBookToDrive, findAvailableFilename, composeFilename } from "@/lib/drive/upload";
import { getUserIdByEmail } from "@/lib/users";
import { getDraftWithBook, confirmDraft } from "@/lib/book-drafts";

export type ConfirmReviewState = null | { ok: false; message: string };

async function fetchCover(url: string): Promise<{ bytes: Buffer; mime: string }> {
  if (!url.startsWith("https://")) {
    throw new Error("Cover URL must use HTTPS");
  }

  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) {
    throw new Error(`Cover fetch failed with status ${resp.status}`);
  }

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Cover URL did not return an image (got ${contentType})`);
  }

  const mime = contentType.split(";")[0].trim();
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response body");

  const chunks: Uint8Array[] = [];
  let total = 0;
  const MAX = 5 * 1024 * 1024;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX) {
        await reader.cancel();
        throw new Error("Cover image exceeds 5 MB limit");
      }
      chunks.push(value);
    }
  }

  return { bytes: Buffer.concat(chunks), mime };
}

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
    const desired = composeFilename(author || null, title);
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
