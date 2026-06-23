import Link from "next/link";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserIdByEmail } from "@/lib/users";
import { db } from "@/lib/db";
import { runBackupNowAction } from "@/app/actions/backup";
import { RestoreButton } from "@/components/restore-button";
import { getLatestSyncCheck } from "@/lib/drive-sync-db";
import {
  runSyncCheckNowAction,
  importFromDriveAction,
  markDriveFileMissingAction,
} from "@/app/actions/drive-sync";

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function SettingsPage() {
  const session = await auth();
  const email = session?.user?.email ?? "";
  let backups: Array<{
    id: string;
    drive_file_id: string | null;
    drive_file_name: string | null;
    backed_up_at: Date;
    error: string | null;
  }> = [];
  let syncCheck: Awaited<ReturnType<typeof getLatestSyncCheck>> = null;
  let missingBooks: Array<{ id: string; title: string }> = [];

  if (email) {
    try {
      const userId = await getUserIdByEmail(email);
      [backups, syncCheck] = await Promise.all([
        db
          .selectFrom("backups")
          .select(["id", "drive_file_id", "drive_file_name", "backed_up_at", "error"])
          .where("user_id", "=", userId)
          .orderBy("backed_up_at", "desc")
          .limit(30)
          .execute(),
        getLatestSyncCheck(userId),
      ]);

      if (syncCheck && syncCheck.missingBookIds.length > 0) {
        missingBooks = await db
          .selectFrom("books")
          .select(["id", "title"])
          .where("id", "in", syncCheck.missingBookIds)
          .execute();
      }
    } catch {
      // not fatal — show empty backup history
    }
  }

  const latest = backups[0];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your Bookshelf configuration.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Update your Google OAuth credentials, OpenAI API key, or owner email. Changes take
            effect after the app restarts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/setup">Reconfigure</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backups</CardTitle>
          <CardDescription>
            Daily snapshot of your library (books, tags, notes) saved to Google Drive.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {latest?.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <p className="font-medium">Last backup failed</p>
              <p className="mt-0.5 text-destructive/80">
                {formatRelativeTime(new Date(latest.backed_up_at))} — {latest.error}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {latest
                ? `Last backup: ${formatRelativeTime(new Date(latest.backed_up_at))}`
                : "No backups yet"}
            </p>
          )}

          <form action={runBackupNowAction}>
            <Button type="submit" variant="outline" size="sm">
              Back up now
            </Button>
          </form>

          {backups.length > 0 && (
            <div className="flex flex-col gap-1 pt-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                History
              </p>
              {backups.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={b.error ? "text-destructive" : "text-green-600"}>
                      {b.error ? "✗" : "✓"}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {formatDateTime(new Date(b.backed_up_at))}
                    </span>
                  </div>
                  {b.drive_file_id ? (
                    <RestoreButton
                      backupId={b.id}
                      backupDate={formatDateTime(new Date(b.backed_up_at))}
                    />
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      Restore
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Drive Sync</CardTitle>
          <CardDescription>
            {syncCheck
              ? `Last checked: ${formatRelativeTime(new Date(syncCheck.checkedAt))}`
              : "Not yet scanned"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={runSyncCheckNowAction}>
            <Button type="submit" variant="outline" size="sm">
              Refresh now
            </Button>
          </form>

          {!syncCheck ||
          (syncCheck.untrackedFiles.length === 0 && syncCheck.missingBookIds.length === 0) ? (
            <p className="text-sm text-muted-foreground">No sync issues detected.</p>
          ) : (
            <>
              {syncCheck.untrackedFiles.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    Untracked files on Drive
                  </p>
                  {syncCheck.untrackedFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="truncate">{file.name}</span>
                      <form action={importFromDriveAction}>
                        <input type="hidden" name="fileId" value={file.id} />
                        <input type="hidden" name="fileName" value={file.name} />
                        <Button type="submit" variant="outline" size="sm">
                          Import
                        </Button>
                      </form>
                    </div>
                  ))}
                </div>
              )}

              {missingBooks.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    Books with missing Drive files
                  </p>
                  {missingBooks.map((book) => (
                    <div
                      key={book.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="truncate">{book.title}</span>
                      <form action={markDriveFileMissingAction}>
                        <input type="hidden" name="bookId" value={book.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Mark as broken
                        </Button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
