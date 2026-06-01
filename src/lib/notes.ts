import "server-only";
import { db } from "@/lib/db";

export interface Note {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listBookNotes(bookId: string, userId: string): Promise<Note[]> {
  const rows = await db
    .selectFrom("notes")
    .innerJoin("books", "books.id", "notes.book_id")
    .select([
      "notes.id",
      "notes.body",
      "notes.created_at",
      "notes.updated_at",
    ])
    .where("notes.book_id", "=", bookId)
    .where("books.user_id", "=", userId)
    .orderBy("notes.created_at", "asc")
    .execute();

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function createNote(
  bookId: string,
  userId: string,
  body: string
): Promise<Note> {
  const book = await db
    .selectFrom("books")
    .select("id")
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (!book) throw new Error("Book not found or access denied");

  const row = await db
    .insertInto("notes")
    .values({ book_id: bookId, body })
    .returning(["id", "body", "created_at", "updated_at"])
    .executeTakeFirstOrThrow();

  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function updateNote(
  noteId: string,
  userId: string,
  body: string
): Promise<Note> {
  const row = await db
    .updateTable("notes")
    .set({ body, updated_at: new Date().toISOString() })
    .where("notes.id", "=", noteId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("books")
          .select("id")
          .whereRef("books.id", "=", "notes.book_id")
          .where("books.user_id", "=", userId)
      )
    )
    .returning(["id", "body", "created_at", "updated_at"])
    .executeTakeFirst();

  if (!row) throw new Error("Note not found or access denied");

  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function deleteNote(noteId: string, userId: string): Promise<void> {
  const result = await db
    .deleteFrom("notes")
    .where("notes.id", "=", noteId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("books")
          .select("id")
          .whereRef("books.id", "=", "notes.book_id")
          .where("books.user_id", "=", userId)
      )
    )
    .executeTakeFirst();

  if (!result) throw new Error("Note not found or access denied");
}
