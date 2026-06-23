import "server-only";
import { db } from "@/lib/db";
import type { EnrichmentProposals } from "@/lib/enrichment/types";

export interface CreateDraftInput {
  userId: string;
  filename: string;
  derivedTitle: string;
  embeddedMetadata: {
    author: string | null;
    isbn: string | null;
    coverBytes: Buffer | null;
    coverMime: string | null;
    publisher: string | null;
    language: string | null;
    publishedDate: string | null;
    description: string | null;
  };
  stagedBytes: Buffer;
}

export interface DraftWithBook {
  bookId: string;
  filename: string;
  embedded: {
    title: string;
    author: string | null;
    isbn: string | null;
    coverBytes: Buffer | null;
    coverMime: string | null;
  };
  stagedBytes: Buffer;
  proposals: EnrichmentProposals | null;
  sourceDriveFileId: string | null;
}

export interface ConfirmDraftInput {
  title: string;
  author: string | null;
  isbn: string | null;
  coverBytes: Buffer | null;
  coverMime: string | null;
  driveFileId: string;
  driveFileName: string;
  originalDriveFileId: string;
}

export async function createDraft(
  input: CreateDraftInput,
  options?: { sourceDriveFileId?: string }
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto("books")
      .values({
        user_id: input.userId,
        drive_file_id: null,
        title: input.derivedTitle,
        author: input.embeddedMetadata.author,
        isbn: input.embeddedMetadata.isbn,
        cover_bytes: input.embeddedMetadata.coverBytes,
        cover_mime: input.embeddedMetadata.coverMime,
        publisher: input.embeddedMetadata.publisher,
        language: input.embeddedMetadata.language,
        published_date: input.embeddedMetadata.publishedDate,
        description: input.embeddedMetadata.description,
        review_state: "pending",
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("book_drafts")
      .values({
        book_id: inserted.id,
        filename: input.filename,
        staged_bytes: input.stagedBytes,
        proposals: null,
        source_drive_file_id: options?.sourceDriveFileId ?? null,
      })
      .execute();

    return inserted.id;
  });
}

export async function getDraftWithBook(
  bookId: string,
  userId: string
): Promise<DraftWithBook | null> {
  const row = await db
    .selectFrom("books")
    .innerJoin("book_drafts", "book_drafts.book_id", "books.id")
    .select([
      "books.id as bookId",
      "books.title",
      "books.author",
      "books.isbn",
      "books.cover_bytes",
      "books.cover_mime",
      "book_drafts.filename",
      "book_drafts.staged_bytes",
      "book_drafts.proposals",
      "book_drafts.source_drive_file_id",
    ])
    .where("books.id", "=", bookId)
    .where("books.user_id", "=", userId)
    .where("books.review_state", "=", "pending")
    .executeTakeFirst();

  if (!row) return null;

  return {
    bookId: row.bookId,
    filename: row.filename,
    embedded: {
      title: row.title,
      author: row.author,
      isbn: row.isbn,
      coverBytes: row.cover_bytes,
      coverMime: row.cover_mime,
    },
    stagedBytes: row.staged_bytes,
    proposals: row.proposals,
    sourceDriveFileId: row.source_drive_file_id,
  };
}

export async function deleteDraftAndBook(bookId: string, userId: string): Promise<void> {
  await db
    .deleteFrom("books")
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .where("review_state", "=", "pending")
    .execute();
}

export async function updateProposals(
  bookId: string,
  proposals: EnrichmentProposals
): Promise<void> {
  await db.updateTable("book_drafts").set({ proposals }).where("book_id", "=", bookId).execute();
}

export async function confirmDraft(
  bookId: string,
  userId: string,
  confirmed: ConfirmDraftInput
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable("books")
      .set({
        drive_file_id: confirmed.driveFileId,
        drive_file_name: confirmed.driveFileName,
        original_drive_file_id: confirmed.originalDriveFileId,
        title: confirmed.title,
        author: confirmed.author,
        isbn: confirmed.isbn,
        cover_bytes: confirmed.coverBytes,
        cover_mime: confirmed.coverMime,
        review_state: "confirmed",
        updated_at: new Date().toISOString(),
      })
      .where("id", "=", bookId)
      .where("user_id", "=", userId)
      .where("review_state", "=", "pending")
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) === 0) {
      throw new Error(`Draft not found or already confirmed: ${bookId}`);
    }

    await trx.deleteFrom("book_drafts").where("book_id", "=", bookId).execute();
  });
}
