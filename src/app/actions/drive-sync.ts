"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { getDriveClient } from "@/lib/drive/client";
import { DriveAuthError } from "@/lib/drive/errors";
import { runSyncCheckNow } from "@/lib/drive/run-sync-check";
import { parseEpub, EpubParseError } from "@/lib/epub/parse";
import { createDraft } from "@/lib/book-drafts";
import { db } from "@/lib/db";

export async function runSyncCheckNowAction(): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  try {
    const userId = await getUserIdByEmail(session.user.email);
    await runSyncCheckNow(userId, session.user.email);
    revalidatePath("/settings");
  } catch (e) {
    if (e instanceof DriveAuthError) {
      await signOut({ redirect: false });
      redirect("/signin?expired=1");
    }
    throw e;
  }
}

export async function importFromDriveAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const fileId = formData.get("fileId") as string;
  const fileName = formData.get("fileName") as string;

  try {
    const drive = await getDriveClient();
    const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    const buffer = Buffer.from(res.data as ArrayBuffer);

    let metadata: Awaited<ReturnType<typeof parseEpub>>;
    try {
      metadata = await parseEpub(buffer);
    } catch (e) {
      if (e instanceof EpubParseError) redirect("/?error=import_failed");
      throw e;
    }

    const derivedTitle = (metadata.title ?? fileName.replace(/\.epub$/i, "").trim()) || "Untitled";

    const userId = await getUserIdByEmail(session.user.email);

    const bookId = await createDraft(
      {
        userId,
        filename: fileName,
        derivedTitle,
        embeddedMetadata: {
          author: metadata.author,
          isbn: metadata.isbn,
          coverBytes: metadata.cover?.bytes ?? null,
          coverMime: metadata.cover?.mime ?? null,
          publisher: metadata.publisher,
          language: metadata.language,
          publishedDate: metadata.publishedDate,
          description: metadata.description,
        },
        stagedBytes: buffer,
      },
      { sourceDriveFileId: fileId }
    );

    redirect(`/review/${bookId}`);
  } catch (e) {
    if (e instanceof DriveAuthError) {
      await signOut({ redirect: false });
      redirect("/signin?expired=1");
    }
    throw e;
  }
}

export async function markDriveFileMissingAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookId = formData.get("bookId") as string;
  const userId = await getUserIdByEmail(session.user.email);

  await db
    .updateTable("books")
    .set({ drive_file_id: null, drive_file_name: null, updated_at: new Date().toISOString() })
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .execute();

  revalidatePath("/settings");
}
