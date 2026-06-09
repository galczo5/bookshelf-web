import { sql } from "kysely";
import { db } from "@/lib/db";
import { createDraft } from "@/lib/book-drafts";

export const TEST_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "test@example.com",
} as const;

export async function resetDb(): Promise<void> {
  await sql`TRUNCATE TABLE notes, book_tags, book_drafts, books, tags, users RESTART IDENTITY CASCADE`.execute(
    db
  );
  await db.insertInto("users").values({ id: TEST_USER.id, email: TEST_USER.email }).execute();
}

export async function seedDraft(input: {
  filename: string;
  derivedTitle: string;
  stagedBytes: Buffer;
  embedded?: {
    author?: string | null;
    isbn?: string | null;
    coverBytes?: Buffer | null;
    coverMime?: string | null;
  };
}): Promise<string> {
  return createDraft({
    userId: TEST_USER.id,
    filename: input.filename,
    derivedTitle: input.derivedTitle,
    stagedBytes: input.stagedBytes,
    embeddedMetadata: {
      author: input.embedded?.author ?? null,
      isbn: input.embedded?.isbn ?? null,
      coverBytes: input.embedded?.coverBytes ?? null,
      coverMime: input.embedded?.coverMime ?? null,
      publisher: null,
      language: null,
      publishedDate: null,
      description: null,
    },
  });
}

export async function readState(bookId: string): Promise<{
  reviewState: string;
  driveFileId: string | null;
  hasDraft: boolean;
}> {
  const row = await db
    .selectFrom("books")
    .leftJoin("book_drafts", "book_drafts.book_id", "books.id")
    .select([
      "books.review_state as reviewState",
      "books.drive_file_id as driveFileId",
      "book_drafts.book_id as draftBookId",
    ])
    .where("books.id", "=", bookId)
    .executeTakeFirstOrThrow();

  return {
    reviewState: row.reviewState,
    driveFileId: row.driveFileId,
    hasDraft: row.draftBookId !== null,
  };
}
