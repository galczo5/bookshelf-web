import "server-only";
import { Readable } from "stream";
import type { drive_v3 } from "googleapis";

function sanitizeSegment(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "unknown";
  let s = raw.replace(/[/\\:*?"<>|]/g, "_");
  s = s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  s = s.slice(0, 100).trim();
  return s || "unknown";
}

export function composeFilename(fields: {
  author: string | null;
  series: string | null;
  part: string | null;
  title: string;
}): string {
  const segments: string[] = [];
  const author = sanitizeSegment(fields.author);
  segments.push(author);
  if (fields.series && fields.series.trim()) segments.push(sanitizeSegment(fields.series));
  if (fields.part && fields.part.trim()) segments.push(sanitizeSegment(fields.part));
  segments.push(sanitizeSegment(fields.title));
  return segments.join(" - ") + ".epub";
}

export function sanitizeOriginalFilename(filename: string): string {
  const lower = filename.toLowerCase();
  const hasEpub = lower.endsWith(".epub");
  const base = hasEpub ? filename.slice(0, filename.length - 5) : filename;
  return sanitizeSegment(base) + ".epub";
}

export async function findAvailableFilename(
  drive: drive_v3.Drive,
  folderId: string,
  desired: string
): Promise<string> {
  const dotIdx = desired.lastIndexOf(".");
  const base = dotIdx !== -1 ? desired.slice(0, dotIdx) : desired;
  const ext = dotIdx !== -1 ? desired.slice(dotIdx) : "";

  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0 ? desired : `${base} (${attempt + 1})${ext}`;
    const escaped = candidate.replace(/'/g, "\\'");
    const res = await drive.files.list({
      q: `'${folderId}' in parents and name = '${escaped}' and trashed=false`,
      fields: "files(id)",
    });
    if (!res.data.files?.length) return candidate;
  }
  throw new Error(`No available filename after 100 attempts: ${desired}`);
}

export async function uploadBookToDrive(
  drive: drive_v3.Drive,
  folderId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: "application/epub+zip",
      body: Readable.from(buffer),
    },
    fields: "id",
  });
  return res.data.id!;
}
