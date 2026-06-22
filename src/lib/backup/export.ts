import "server-only";
import { db } from "@/lib/db";

export interface BackupPayload {
  version: 1;
  exported_at: string;
  books: unknown[];
  tags: unknown[];
  book_tags: unknown[];
  notes: unknown[];
}

export async function exportLibraryToJSON(userId: string): Promise<string> {
  const [books, tags, bookTags, notes] = await Promise.all([
    db.selectFrom("books").selectAll().where("user_id", "=", userId).execute(),
    db.selectFrom("tags").selectAll().where("user_id", "=", userId).execute(),
    db
      .selectFrom("book_tags")
      .selectAll()
      .where("book_id", "in", db.selectFrom("books").select("id").where("user_id", "=", userId))
      .execute(),
    db
      .selectFrom("notes")
      .selectAll()
      .where("book_id", "in", db.selectFrom("books").select("id").where("user_id", "=", userId))
      .execute(),
  ]);

  const serializedBooks = books.map((b) => ({
    ...b,
    cover_bytes: b.cover_bytes ? b.cover_bytes.toString("base64") : null,
  }));

  const payload: BackupPayload = {
    version: 1,
    exported_at: new Date().toISOString(),
    books: serializedBooks,
    tags,
    book_tags: bookTags,
    notes,
  };

  return JSON.stringify(payload);
}
