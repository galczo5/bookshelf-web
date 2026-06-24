import "server-only";
import type { drive_v3 } from "googleapis";
import { db } from "@/lib/db";
import type { DriveSyncFile } from "@/lib/db";
import { getOrCreateLibraryFolder } from "@/lib/drive/library-folder";

export type SyncCheckResult = {
  untrackedFiles: DriveSyncFile[];
  missingBookIds: string[];
};

export async function checkDriveSync(
  drive: drive_v3.Drive,
  email: string,
  userId: string
): Promise<SyncCheckResult> {
  const libraryFolderId = await getOrCreateLibraryFolder(drive, email);

  const allDriveFiles: DriveSyncFile[] = [];
  let pageToken: string | undefined;
  do {
    const listRes = await drive.files.list({
      q: `'${libraryFolderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: "nextPageToken,files(id,name)",
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const f of listRes.data.files ?? []) {
      allDriveFiles.push({ id: f.id!, name: f.name! });
    }
    pageToken = listRes.data.nextPageToken ?? undefined;
  } while (pageToken);

  const driveFiles = allDriveFiles;
  const driveFileIds = new Set(driveFiles.map((f) => f.id));

  const [confirmedBooks, pendingSourceIds] = await Promise.all([
    db
      .selectFrom("books")
      .select(["id", "drive_file_id"])
      .where("user_id", "=", userId)
      .where("review_state", "=", "confirmed")
      .where("trashed_at", "is", null)
      .where("drive_file_id", "is not", null)
      .execute(),
    db
      .selectFrom("book_drafts")
      .innerJoin("books", "books.id", "book_drafts.book_id")
      .select("book_drafts.source_drive_file_id")
      .where("books.user_id", "=", userId)
      .where("books.review_state", "=", "pending")
      .where("book_drafts.source_drive_file_id", "is not", null)
      .execute(),
  ]);

  const knownDriveFileIds = new Set(confirmedBooks.map((b) => b.drive_file_id!));
  const pendingSourceFileIds = new Set(
    pendingSourceIds.map((r) => r.source_drive_file_id).filter(Boolean) as string[]
  );

  const untrackedFiles = driveFiles.filter(
    (f) => !knownDriveFileIds.has(f.id) && !pendingSourceFileIds.has(f.id)
  );

  const missingBookIds = confirmedBooks
    .filter((b) => !driveFileIds.has(b.drive_file_id!))
    .map((b) => b.id);

  return { untrackedFiles, missingBookIds };
}
