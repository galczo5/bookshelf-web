export const runtime = "nodejs";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { db } from "@/lib/db";
import { getDriveClient } from "@/lib/drive/client";
import { DriveAuthError } from "@/lib/drive/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return new Response(null, { status: 401 });
  }

  const { id } = await params;
  const userId = await getUserIdByEmail(session.user.email);

  const row = await db
    .selectFrom("books")
    .select("drive_file_id")
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .executeTakeFirst();

  if (!row?.drive_file_id) {
    return new Response(null, { status: 404 });
  }

  let drive: Awaited<ReturnType<typeof getDriveClient>>;
  try {
    drive = await getDriveClient();
  } catch (err) {
    if (err instanceof DriveAuthError) {
      redirect("/signin");
    }
    throw err;
  }

  let webContentLink: string | null | undefined;
  try {
    const file = await drive.files.get({ fileId: row.drive_file_id, fields: "webContentLink" });
    webContentLink = file.data.webContentLink;
  } catch {
    return new Response("Could not reach Google Drive", { status: 502 });
  }

  if (!webContentLink) {
    return new Response("Download link unavailable", { status: 502 });
  }

  return Response.redirect(webContentLink, 302);
}
