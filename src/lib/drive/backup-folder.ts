import "server-only";
import type { drive_v3 } from "googleapis";

const backupFolderCache = new Map<string, string>();

export async function getOrCreateBackupFolder(
  drive: drive_v3.Drive,
  libraryFolderId: string
): Promise<string> {
  const cached = backupFolderCache.get(libraryFolderId);
  if (cached) return cached;

  const listRes = await drive.files.list({
    q: `'${libraryFolderId}' in parents and name='Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });

  const existingId = listRes.data.files?.[0]?.id;
  if (existingId) {
    backupFolderCache.set(libraryFolderId, existingId);
    return existingId;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: "Backups",
      mimeType: "application/vnd.google-apps.folder",
      parents: [libraryFolderId],
    },
    fields: "id",
  });

  const newId = createRes.data.id!;
  backupFolderCache.set(libraryFolderId, newId);
  return newId;
}
