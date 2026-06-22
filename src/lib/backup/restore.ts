import "server-only";
import { db } from "@/lib/db";

export class BackupRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupRestoreError";
  }
}

interface RawBook {
  cover_bytes: string | null;
  [key: string]: unknown;
}

export async function restoreLibraryFromJSON(userId: string, json: string): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new BackupRestoreError("Backup JSON is not valid JSON.");
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as Record<string, unknown>).version !== 1
  ) {
    throw new BackupRestoreError("Backup version mismatch or invalid structure.");
  }

  const { books, tags, book_tags, notes } = payload as {
    books: RawBook[];
    tags: Record<string, unknown>[];
    book_tags: Record<string, unknown>[];
    notes: Record<string, unknown>[];
  };

  const booksToInsert = books.map((b) => ({
    ...b,
    cover_bytes: b.cover_bytes ? Buffer.from(b.cover_bytes, "base64") : null,
  }));

  await db.transaction().execute(async (trx) => {
    const userBookIds = trx.selectFrom("books").select("id").where("user_id", "=", userId);

    // Delete in FK order
    await trx.deleteFrom("book_tags").where("book_id", "in", userBookIds).execute();

    await trx.deleteFrom("notes").where("book_id", "in", userBookIds).execute();

    await trx.deleteFrom("books").where("user_id", "=", userId).execute();

    await trx.deleteFrom("tags").where("user_id", "=", userId).execute();

    // Insert in FK order. Backup rows were exported from the same schema, so
    // the shapes are correct at runtime; `any` avoids unresolvable Kysely
    // generic constraints when inserting from unknown[].
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if (tags.length > 0) {
      await trx
        .insertInto("tags")
        .values(tags as any)
        .execute();
    }

    if (booksToInsert.length > 0) {
      await trx
        .insertInto("books")
        .values(booksToInsert as any)
        .execute();
    }

    if (book_tags.length > 0) {
      await trx
        .insertInto("book_tags")
        .values(book_tags as any)
        .execute();
    }

    if (notes.length > 0) {
      await trx
        .insertInto("notes")
        .values(notes as any)
        .execute();
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
}
