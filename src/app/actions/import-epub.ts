"use server";

import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDriveClient } from "@/lib/drive/client";
import { DriveAuthError } from "@/lib/drive/errors";
import { getOrCreateLibraryFolder } from "@/lib/drive/library-folder";
import { uploadBookToDrive, findAvailableFilename } from "@/lib/drive/upload";
import { parseEpub, EpubParseError } from "@/lib/epub/parse";
import { getUserIdByEmail } from "@/lib/users";
import { db } from "@/lib/db";

export type ImportEpubState =
  | null
  | { ok: true; title: string; author: string | null }
  | { ok: false; message: string };

function sanitizeSegment(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "unknown";
  let s = raw.replace(/[/\\:*?"<>|]/g, "_");
  s = s.replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "");
  s = s.slice(0, 100).trim();
  return s || "unknown";
}

function composeFilename(author: string | null, title: string): string {
  return `${sanitizeSegment(author)} — ${sanitizeSegment(title)}.epub`;
}

export async function importEpubAction(
  _prev: ImportEpubState,
  formData: FormData
): Promise<ImportEpubState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const file = formData.get("file");
  if (!file || !(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No file provided" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let metadata: Awaited<ReturnType<typeof parseEpub>>;
  try {
    metadata = await parseEpub(buffer);
  } catch (e) {
    if (e instanceof EpubParseError) {
      return { ok: false, message: "This file does not look like a valid epub." };
    }
    throw e;
  }

  const title =
    (metadata.title ?? file.name.replace(/\.epub$/i, "").trim()) || "Untitled";

  try {
    const drive = await getDriveClient();
    const folderId = await getOrCreateLibraryFolder(drive, session.user.email);
    const desiredFilename = composeFilename(metadata.author, title);
    const finalFilename = await findAvailableFilename(drive, folderId, desiredFilename);
    const fileId = await uploadBookToDrive(drive, folderId, finalFilename, buffer);

    const userId = await getUserIdByEmail(session.user.email);

    try {
      await db
        .insertInto("books")
        .values({
          user_id: userId,
          drive_file_id: fileId,
          title,
          author: metadata.author,
          isbn: metadata.isbn,
          cover_bytes: metadata.cover?.bytes ?? null,
          cover_mime: metadata.cover?.mime ?? null,
        })
        .execute();
    } catch (err) {
      try {
        await drive.files.delete({ fileId });
      } catch (deleteErr) {
        console.error("Rollback delete failed:", deleteErr);
      }
      throw err;
    }

    return { ok: true, title, author: metadata.author };
  } catch (e) {
    if (e instanceof DriveAuthError) {
      await signOut({ redirect: false });
      redirect("/signin?expired=1");
    }
    console.error("Import failed:", e);
    return { ok: false, message: "Import failed. Please try again." };
  }
}
