export const runtime = "nodejs";

import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { db } from "@/lib/db";
import { getDriveClient } from "@/lib/drive/client";
import { DriveAuthError } from "@/lib/drive/errors";
import { parseEpub, EpubParseError } from "@/lib/epub/parse";

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
    .executeTakeFirst();

  if (!row) {
    return new Response(null, { status: 404 });
  }

  if (!row.drive_file_id) {
    return Response.json({ available: false, reason: "no_drive_file" });
  }

  let drive: Awaited<ReturnType<typeof getDriveClient>>;
  try {
    drive = await getDriveClient();
  } catch (err) {
    if (err instanceof DriveAuthError) {
      return Response.json({ available: false, reason: "drive_error" });
    }
    throw err;
  }

  let buffer: Buffer;
  try {
    const res = await drive.files.get(
      { fileId: row.drive_file_id, alt: "media" },
      { responseType: "arraybuffer" }
    );
    buffer = Buffer.from(res.data as ArrayBuffer);
  } catch {
    return Response.json({ available: false, reason: "drive_error" });
  }

  let metadata: Awaited<ReturnType<typeof parseEpub>>;
  try {
    metadata = await parseEpub(buffer);
  } catch (err) {
    if (err instanceof EpubParseError) {
      return Response.json({ available: false, reason: "parse_error" });
    }
    throw err;
  }

  return Response.json(
    {
      available: true,
      title: metadata.title,
      author: metadata.author,
      isbn: metadata.isbn,
      publisher: metadata.publisher,
      language: metadata.language,
      publishedDate: metadata.publishedDate,
      description: metadata.description,
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
