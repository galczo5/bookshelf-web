import "server-only";
import { db } from "@/lib/db";
import type { DriveSyncFile } from "@/lib/db";

export type { DriveSyncFile };

export interface SyncCheckRow {
  id: string;
  userId: string;
  checkedAt: Date;
  untrackedFiles: DriveSyncFile[];
  missingBookIds: string[];
}

export async function getLatestSyncCheck(userId: string): Promise<SyncCheckRow | null> {
  const row = await db
    .selectFrom("drive_sync_checks")
    .select(["id", "user_id", "checked_at", "untracked_files", "missing_book_ids"])
    .where("user_id", "=", userId)
    .orderBy("checked_at", "desc")
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    checkedAt: row.checked_at,
    untrackedFiles: row.untracked_files,
    missingBookIds: row.missing_book_ids,
  };
}

export async function insertSyncCheckResult(
  userId: string,
  untrackedFiles: DriveSyncFile[],
  missingBookIds: string[]
): Promise<void> {
  await db
    .insertInto("drive_sync_checks")
    .values({
      user_id: userId,
      untracked_files: JSON.stringify(untrackedFiles),
      missing_book_ids: JSON.stringify(missingBookIds),
    })
    .execute();
}
