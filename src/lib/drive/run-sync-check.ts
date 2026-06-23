import "server-only";
import { getDriveClient } from "@/lib/drive/client";
import { checkDriveSync } from "@/lib/drive/sync-check";
import { getLatestSyncCheck, insertSyncCheckResult } from "@/lib/drive-sync-db";
import type { SyncCheckResult } from "@/lib/drive/sync-check";

let _syncInProgress: Promise<SyncCheckResult> | null = null;

async function doScan(userId: string, email: string): Promise<SyncCheckResult> {
  const drive = await getDriveClient();
  const result = await checkDriveSync(drive, email, userId);
  await insertSyncCheckResult(userId, result.untrackedFiles, result.missingBookIds);
  return result;
}

export async function runSyncCheckIfStale(userId: string, email: string): Promise<SyncCheckResult> {
  if (_syncInProgress) return _syncInProgress;

  const latest = await getLatestSyncCheck(userId);
  if (latest) {
    const ageMs = Date.now() - new Date(latest.checkedAt).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      return { untrackedFiles: latest.untrackedFiles, missingBookIds: latest.missingBookIds };
    }
  }

  _syncInProgress = doScan(userId, email).finally(() => {
    _syncInProgress = null;
  });

  return _syncInProgress;
}

export async function runSyncCheckNow(userId: string, email: string): Promise<SyncCheckResult> {
  if (_syncInProgress) return _syncInProgress;

  _syncInProgress = doScan(userId, email).finally(() => {
    _syncInProgress = null;
  });

  return _syncInProgress;
}
