import "server-only";
import type { drive_v3 } from "googleapis";
import { findAvailableFilename } from "@/lib/drive/upload";

export async function renameWorkingCopy(
  drive: drive_v3.Drive,
  fileId: string,
  libraryFolderId: string,
  desiredName: string
): Promise<string> {
  const finalName = await findAvailableFilename(drive, libraryFolderId, desiredName);
  await drive.files.update({
    fileId,
    requestBody: { name: finalName },
  });
  return finalName;
}
