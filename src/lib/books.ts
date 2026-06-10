import "server-only";
import { Kysely, sql } from "kysely";
import { db, type Database } from "@/lib/db";

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  hasCover: boolean;
  createdAt: Date;
  tags: Array<{ id: string; name: string; color: string }>;
}

export interface BookDetail extends BookSummary {
  isbn: string | null;
  coverMime: string | null;
  trashedAt: Date | null;
  updatedAt: Date;
  publisher: string | null;
  language: string | null;
  publishedDate: string | null;
  description: string | null;
}

export interface TrashedBookSummary extends BookSummary {
  trashedAt: Date;
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
    .select([
      "book_tags.book_id",
      "tags.id as tag_id",
      "tags.name as tag_name",
      "tags.color as tag_color",
    ])
    .where("book_tags.book_id", "in", bookIds)
    .execute();

  const tagsByBookId = new Map<string, Array<{ id: string; name: string; color: string }>>();
  for (const row of tagRows) {
    const list = tagsByBookId.get(row.book_id) ?? [];
    list.push({ id: row.tag_id, name: row.tag_name, color: row.tag_color });
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

export async function getConfirmedBook(bookId: string, userId: string): Promise<BookDetail | null> {
  const book = await db
    .selectFrom("books")
    .select([
      "id",
      "title",
      "author",
      "isbn",
      "cover_mime",
      "publisher",
      "language",
      "published_date",
      "description",
      "created_at",
      "updated_at",
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
    .select(["tags.id as tag_id", "tags.name as tag_name", "tags.color as tag_color"])
    .where("book_tags.book_id", "=", bookId)
    .execute();

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    coverMime: book.cover_mime,
    publisher: book.publisher,
    language: book.language,
    publishedDate: book.published_date,
    description: book.description,
    hasCover: book.has_cover,
    createdAt: book.created_at,
    updatedAt: book.updated_at,
    trashedAt: null,
    tags: tagRows.map((r) => ({ id: r.tag_id, name: r.tag_name, color: r.tag_color })),
  };
}

export async function listTrashedBooks(userId: string): Promise<TrashedBookSummary[]> {
  const books = await db
    .selectFrom("books")
    .select([
      "id",
      "title",
      "author",
      "created_at",
      "trashed_at",
      sql<boolean>`cover_bytes IS NOT NULL`.as("has_cover"),
    ])
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .where("trashed_at", "is not", null)
    .orderBy("trashed_at", "desc")
    .execute();

  if (books.length === 0) return [];

  const bookIds = books.map((b) => b.id);
  const tagRows = await db
    .selectFrom("book_tags")
    .innerJoin("tags", "tags.id", "book_tags.tag_id")
    .select([
      "book_tags.book_id",
      "tags.id as tag_id",
      "tags.name as tag_name",
      "tags.color as tag_color",
    ])
    .where("book_tags.book_id", "in", bookIds)
    .execute();

  const tagsByBookId = new Map<string, Array<{ id: string; name: string; color: string }>>();
  for (const row of tagRows) {
    const list = tagsByBookId.get(row.book_id) ?? [];
    list.push({ id: row.tag_id, name: row.tag_name, color: row.tag_color });
    tagsByBookId.set(row.book_id, list);
  }

  return books.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    hasCover: b.has_cover,
    createdAt: b.created_at,
    trashedAt: b.trashed_at as Date,
    tags: tagsByBookId.get(b.id) ?? [],
  }));
}

export async function getOwnedBook(bookId: string, userId: string): Promise<BookDetail | null> {
  const book = await db
    .selectFrom("books")
    .select([
      "id",
      "title",
      "author",
      "isbn",
      "cover_mime",
      "publisher",
      "language",
      "published_date",
      "description",
      "created_at",
      "updated_at",
      "trashed_at",
      sql<boolean>`cover_bytes IS NOT NULL`.as("has_cover"),
    ])
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .executeTakeFirst();

  if (!book) return null;

  const tagRows = await db
    .selectFrom("book_tags")
    .innerJoin("tags", "tags.id", "book_tags.tag_id")
    .select(["tags.id as tag_id", "tags.name as tag_name", "tags.color as tag_color"])
    .where("book_tags.book_id", "=", bookId)
    .execute();

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    coverMime: book.cover_mime,
    publisher: book.publisher,
    language: book.language,
    publishedDate: book.published_date,
    description: book.description,
    hasCover: book.has_cover,
    createdAt: book.created_at,
    updatedAt: book.updated_at,
    trashedAt: book.trashed_at ?? null,
    tags: tagRows.map((r) => ({ id: r.tag_id, name: r.tag_name, color: r.tag_color })),
  };
}

export interface UpdateBookMetadataFields {
  title: string;
  author: string | null;
  isbn: string | null;
  publisher?: string | null;
  language?: string | null;
  publishedDate?: string | null;
  description?: string | null;
  /** When provided, replaces the stored cover. When omitted, the cover is left unchanged. */
  cover?: { bytes: Buffer; mime: string };
}

export async function updateBookMetadata(
  bookId: string,
  userId: string,
  fields: UpdateBookMetadataFields
): Promise<{ updated: true } | null> {
  const values: Record<string, unknown> = {
    title: fields.title,
    author: fields.author,
    isbn: fields.isbn,
    updated_at: sql`NOW()`,
  };

  if ("publisher" in fields) values.publisher = fields.publisher;
  if ("language" in fields) values.language = fields.language;
  if ("publishedDate" in fields) values.published_date = fields.publishedDate;
  if ("description" in fields) values.description = fields.description;

  if (fields.cover) {
    values.cover_bytes = fields.cover.bytes;
    values.cover_mime = fields.cover.mime;
  }

  const row = await db
    .updateTable("books")
    .set(values)
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .where("trashed_at", "is", null)
    .returning("id")
    .executeTakeFirst();

  if (!row) return null;
  return { updated: true };
}

export async function trashConfirmedBook(
  bookId: string,
  userId: string,
  trx?: Kysely<Database>
): Promise<{ trashedAt: Date } | null> {
  const row = await (trx ?? db)
    .updateTable("books")
    .set({ trashed_at: sql`NOW()` })
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .where("trashed_at", "is", null)
    .returning("trashed_at")
    .executeTakeFirst();

  if (!row) return null;
  return { trashedAt: row.trashed_at as Date };
}

export async function restoreTrashedBook(
  bookId: string,
  userId: string,
  trx?: Kysely<Database>
): Promise<{ restored: true } | null> {
  const row = await (trx ?? db)
    .updateTable("books")
    .set({ trashed_at: null })
    .where("id", "=", bookId)
    .where("user_id", "=", userId)
    .where("review_state", "=", "confirmed")
    .where("trashed_at", "is not", null)
    .returning("id")
    .executeTakeFirst();

  if (!row) return null;
  return { restored: true };
}
