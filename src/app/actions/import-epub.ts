"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { parseEpub, EpubParseError } from "@/lib/epub/parse";
import { getUserIdByEmail } from "@/lib/users";
import { createDraft } from "@/lib/book-drafts";

export type ImportEpubState = null | { ok: false; message: string };

export async function importEpubAction(
  _prev: ImportEpubState,
  formData: FormData
): Promise<ImportEpubState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const file = formData.get("file");
  if (!file || !(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No file provided" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let metadata: Awaited<ReturnType<typeof parseEpub>>;
  try {
    metadata = await parseEpub(buffer);
  } catch (e) {
    if (e instanceof EpubParseError) {
      return { ok: false, message: "This file does not look like a valid epub." };
    }
    throw e;
  }

  const derivedTitle = (metadata.title ?? file.name.replace(/\.epub$/i, "").trim()) || "Untitled";

  const userId = await getUserIdByEmail(session.user.email);

  const bookId = await createDraft({
    userId,
    filename: file.name,
    derivedTitle,
    embeddedMetadata: {
      author: metadata.author,
      isbn: metadata.isbn,
      coverBytes: metadata.cover?.bytes ?? null,
      coverMime: metadata.cover?.mime ?? null,
      publisher: metadata.publisher,
      language: metadata.language,
      publishedDate: metadata.publishedDate,
      description: metadata.description,
    },
    stagedBytes: buffer,
  });

  redirect(`/review/${bookId}`);
}
