import "server-only";
import { sql } from "kysely";
import { db } from "@/lib/db";

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  hasCover: boolean;
  createdAt: Date;
  tags: Array<{ id: string; name: string }>;
}

export interface BookDetail extends BookSummary {
  isbn: string | null;
  coverMime: string | null;
}

export async function listConfirmedBooks(userId: string): Promise<BookSummary[]> {
  const books = await db
    .selectFrom("books")
    .select([
      "id",
      "title",
      "author",
      "created_at",
      sql<boolean>`cover_bytes IS NOT NULL`.as("has_cover"),
    ])
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .where("trashed_at", "is", null)
    .orderBy("created_at", "desc")
    .execute();

  if (books.length === 0) return [];

  const bookIds = books.map((b) => b.id);
  const tagRows = await db
    .selectFrom("book_tags")
    .innerJoin("tags", "tags.id", "book_tags.tag_id")
    .select(["book_tags.book_id", "tags.id as tag_id", "tags.name as tag_name"])
    .where("book_tags.book_id", "in", bookIds)
    .execute();

  const tagsByBookId = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of tagRows) {
    const list = tagsByBookId.get(row.book_id) ?? [];
    list.push({ id: row.tag_id, name: row.tag_name });
    tagsByBookId.set(row.book_id, list);
  }

  return books.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    hasCover: b.has_cover,
    createdAt: b.created_at,
    tags: tagsByBookId.get(b.id) ?? [],
  }));
}

export async function getConfirmedBook(
  bookId: string,
  userId: string
): Promise<BookDetail | null> {
  const book = await db
    .selectFrom("books")
    .select([
      "id",
      "title",
      "author",
      "isbn",
      "cover_mime",
      "created_at",
      sql<boolean>`cover_bytes IS NOT NULL`.as("has_cover"),
    ])
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .where("trashed_at", "is", null)
    .executeTakeFirst();

  if (!book) return null;

  const tagRows = await db
    .selectFrom("book_tags")
    .innerJoin("tags", "tags.id", "book_tags.tag_id")
    .select(["tags.id as tag_id", "tags.name as tag_name"])
    .where("book_tags.book_id", "=", bookId)
    .execute();

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    coverMime: book.cover_mime,
    hasCover: book.has_cover,
    createdAt: book.created_at,
    tags: tagRows.map((r) => ({ id: r.tag_id, name: r.tag_name })),
  };
}
