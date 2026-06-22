"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { runBackup } from "@/lib/backup/run-backup";
import { getDriveClient } from "@/lib/drive/client";
import { db } from "@/lib/db";
import { restoreLibraryFromJSON } from "@/lib/backup/restore";

export async function runBackupNowAction(): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const userId = await getUserIdByEmail(session.user.email);
  await runBackup(userId, session.user.email);
  revalidatePath("/settings");
}

export async function restoreBackupAction(
  backupId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const userId = await getUserIdByEmail(session.user.email);

  const backup = await db
    .selectFrom("backups")
    .select(["drive_file_id"])
    .where("id", "=", backupId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (!backup || !backup.drive_file_id) {
    return { ok: false, message: "Backup not found." };
  }

  try {
    const drive = await getDriveClient();
    const res = await drive.files.get(
      { fileId: backup.drive_file_id, alt: "media" },
      { responseType: "text" }
    );
    const jsonStr = res.data as string;

    await restoreLibraryFromJSON(userId, jsonStr);

    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
