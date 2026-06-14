export const runtime = "nodejs";

import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { db } from "@/lib/db";
import { getDriveClient } from "@/lib/drive/client";
import { DriveAuthError } from "@/lib/drive/errors";
import { parseEpub, EpubParseError } from "@/lib/epub/parse";

const CACHE = { headers: { "Cache-Control": "private, max-age=300" } };

function metadataResponse(m: {
  title: string | null;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  language: string | null;
  publishedDate: string | null;
  description: string | null;
}): Response {
  return Response.json(
    {
      available: true,
      title: m.title,
      author: m.author,
      isbn: m.isbn,
      publisher: m.publisher,
      language: m.language,
      publishedDate: m.publishedDate,
      description: m.description,
    },
    CACHE
  );
}

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
    .select(["drive_file_id", "epub_metadata_snapshot"])
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (!row) {
    return new Response(null, { status: 404 });
  }

  if (!row.drive_file_id) {
    if (!row.epub_metadata_snapshot) {
      return Response.json({ available: false, reason: "no_drive_file" });
    }
    return metadataResponse(row.epub_metadata_snapshot);
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

  return metadataResponse(metadata);
}
