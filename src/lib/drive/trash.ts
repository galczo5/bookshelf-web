import "server-only";
import type { drive_v3 } from "googleapis";

export async function moveDriveFile(
  drive: drive_v3.Drive,
  fileId: string,
  fromFolderId: string,
  toFolderId: string,
  name?: string
): Promise<void> {
  await drive.files.update({
    fileId,
    addParents: toFolderId,
    removeParents: fromFolderId,
    requestBody: name ? { name } : undefined,
    fields: "id, parents",
  });
}
