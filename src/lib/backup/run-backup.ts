import "server-only";
import { Readable } from "stream";
import { db } from "@/lib/db";
import { getDriveClient } from "@/lib/drive/client";
import { getOrCreateLibraryFolder } from "@/lib/drive/library-folder";
import { getOrCreateBackupFolder } from "@/lib/drive/backup-folder";
import { exportLibraryToJSON } from "@/lib/backup/export";
import { sql } from "kysely";

let _backupInProgress: Promise<void> | null = null;

export async function runBackup(userId: string, email: string): Promise<void> {
  try {
    const jsonStr = await exportLibraryToJSON(userId);

    const drive = await getDriveClient();
    const libraryFolderId = await getOrCreateLibraryFolder(drive, email);
    const backupFolderId = await getOrCreateBackupFolder(drive, libraryFolderId);

    const now = new Date();
    const timestamp = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "T")
      .slice(0, 15)
      .concat("Z");
    const filename = `backup-${timestamp}.json`;

    const uploadRes = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [backupFolderId],
        mimeType: "application/json",
      },
      media: {
        mimeType: "application/json",
        body: Readable.from(Buffer.from(jsonStr)),
      },
      fields: "id,name",
    });

    const driveFileId = uploadRes.data.id!;
    const driveFileName = uploadRes.data.name!;

    await db
      .insertInto("backups")
      .values({
        user_id: userId,
        drive_file_id: driveFileId,
        drive_file_name: driveFileName,
        error: null,
      })
      .execute();

    // Prune: keep only 30 most recent backups
    const allBackups = await db
      .selectFrom("backups")
      .select(["id", "drive_file_id"])
      .where("user_id", "=", userId)
      .orderBy("backed_up_at", "desc")
      .execute();

    const toDelete = allBackups.slice(30);
    for (const row of toDelete) {
      if (row.drive_file_id) {
        try {
          await drive.files.delete({ fileId: row.drive_file_id });
        } catch {
          // best-effort; stale file IDs are acceptable
        }
      }
      await db.deleteFrom("backups").where("id", "=", row.id).execute();
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .insertInto("backups")
      .values({
        user_id: userId,
        drive_file_id: null,
        drive_file_name: null,
        error: message,
      })
      .execute();
  }
}

export async function runBackupIfNeeded(userId: string, email: string): Promise<void> {
  if (_backupInProgress) return _backupInProgress;

  // Skip if last backup (any status) was within 24h
  const lastBackup = await db
    .selectFrom("backups")
    .select("backed_up_at")
    .where("user_id", "=", userId)
    .orderBy("backed_up_at", "desc")
    .limit(1)
    .executeTakeFirst();

  if (lastBackup) {
    const ageMs = Date.now() - new Date(lastBackup.backed_up_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) return;
  }

  // Skip if nothing changed since last successful backup
  const lastSuccess = await db
    .selectFrom("backups")
    .select("backed_up_at")
    .where("user_id", "=", userId)
    .where("error", "is", null)
    .orderBy("backed_up_at", "desc")
    .limit(1)
    .executeTakeFirst();

  if (lastSuccess) {
    const lastSuccessAt = new Date(lastSuccess.backed_up_at).toISOString();

    const userBookIds = db.selectFrom("books").select("id").where("user_id", "=", userId);

    const [newestBook, newestNote, newestTag, newestBookTag] = await Promise.all([
      db
        .selectFrom("books")
        .select(sql<Date>`MAX(updated_at)`.as("newest"))
        .where("user_id", "=", userId)
        .executeTakeFirst(),
      db
        .selectFrom("notes")
        .select(sql<Date>`MAX(updated_at)`.as("newest"))
        .where("book_id", "in", userBookIds)
        .executeTakeFirst(),
      db
        .selectFrom("tags")
        .select(sql<Date>`MAX(created_at)`.as("newest"))
        .where("user_id", "=", userId)
        .executeTakeFirst(),
      db
        .selectFrom("book_tags")
        .select(sql<Date>`MAX(added_at)`.as("newest"))
        .where("book_id", "in", userBookIds)
        .executeTakeFirst(),
    ]);

    const newestChange = [
      newestBook?.newest,
      newestNote?.newest,
      newestTag?.newest,
      newestBookTag?.newest,
    ]
      .filter(Boolean)
      .map((d) => new Date(d!).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    if (newestChange <= new Date(lastSuccessAt).getTime()) return;
  }

  _backupInProgress = runBackup(userId, email).finally(() => {
    _backupInProgress = null;
  });

  return _backupInProgress;
}
