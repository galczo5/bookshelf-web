import "server-only";
import type { drive_v3 } from "googleapis";

const folderCache = new Map<string, string>();
// best-effort caches keyed by libraryFolderId; callers handle stale-ID 404s gracefully
const trashFolderCache = new Map<string, string>();
const originalFilesFolderCache = new Map<string, string>();

export async function getOrCreateLibraryFolder(
  drive: drive_v3.Drive,
  email: string
): Promise<string> {
  const cached = folderCache.get(email);
  if (cached) return cached;

  const listRes = await drive.files.list({
    q: "name='Bookshelf' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: "files(id)",
  });

  const existingId = listRes.data.files?.[0]?.id;
  if (existingId) {
    folderCache.set(email, existingId);
    return existingId;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: "Bookshelf",
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  const newId = createRes.data.id!;
  folderCache.set(email, newId);
  return newId;
}

export async function getOrCreateTrashFolder(
  drive: drive_v3.Drive,
  libraryFolderId: string
): Promise<string> {
  const cached = trashFolderCache.get(libraryFolderId);
  if (cached) return cached;

  const listRes = await drive.files.list({
    q: `'${libraryFolderId}' in parents and name='Trash' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });

  const existingId = listRes.data.files?.[0]?.id;
  if (existingId) {
    trashFolderCache.set(libraryFolderId, existingId);
    return existingId;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: "Trash",
      mimeType: "application/vnd.google-apps.folder",
      parents: [libraryFolderId],
    },
    fields: "id",
  });

  const newId = createRes.data.id!;
  trashFolderCache.set(libraryFolderId, newId);
  return newId;
}

export async function getOrCreateOriginalFilesFolder(
  drive: drive_v3.Drive,
  libraryFolderId: string
): Promise<string> {
  const cached = originalFilesFolderCache.get(libraryFolderId);
  if (cached) return cached;

  const listRes = await drive.files.list({
    q: `'${libraryFolderId}' in parents and name='Original files' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });

  const existingId = listRes.data.files?.[0]?.id;
  if (existingId) {
    originalFilesFolderCache.set(libraryFolderId, existingId);
    return existingId;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: "Original files",
      mimeType: "application/vnd.google-apps.folder",
      parents: [libraryFolderId],
    },
    fields: "id",
  });

  const newId = createRes.data.id!;
  originalFilesFolderCache.set(libraryFolderId, newId);
  return newId;
}
