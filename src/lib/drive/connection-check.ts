import "server-only";
import { getDriveClient } from "./client";

export interface ConnectionCheckResult {
  email: string;
  displayName?: string;
  storageQuotaGB?: number;
}

export async function checkDriveConnection(): Promise<ConnectionCheckResult> {
  const drive = await getDriveClient();
  const res = await drive.about.get({
    fields: "user(displayName,emailAddress),storageQuota(limit,usage)",
  });
  const { user, storageQuota } = res.data;
  const storageQuotaGB = storageQuota?.limit
    ? Math.round((Number(storageQuota.limit) / 1e9) * 10) / 10
    : undefined;
  return {
    email: user?.emailAddress ?? "",
    displayName: user?.displayName ?? undefined,
    storageQuotaGB,
  };
}
