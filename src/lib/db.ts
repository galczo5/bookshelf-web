import "server-only";
import { ColumnType, Generated, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { EnrichmentProposals } from "@/lib/enrichment/types";

export interface AuthTokensTable {
  email: string;
  refresh_token_ciphertext: Buffer;
  updated_at: ColumnType<Date, string | undefined, string>;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  created_at: Generated<Date>;
}

export interface BooksTable {
  id: Generated<string>;
  user_id: string;
  drive_file_id: string | null;
  title: string;
  author: string | null;
  isbn: string | null;
  cover_bytes: Buffer | null;
  cover_mime: string | null;
  trashed_at: ColumnType<Date | null, string | null | undefined, string | null>;
  review_state: Generated<"pending" | "confirmed">;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, string | undefined, string>;
}

export interface BookDraftsTable {
  book_id: string;
  filename: string;
  staged_bytes: Buffer;
  proposals: ColumnType<EnrichmentProposals | null, EnrichmentProposals | null, EnrichmentProposals | null>;
  created_at: Generated<Date>;
}

export interface TagsTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  created_at: Generated<Date>;
}

export interface BookTagsTable {
  book_id: string;
  tag_id: string;
  added_at: Generated<Date>;
}

export interface NotesTable {
  id: Generated<string>;
  book_id: string;
  body: string;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, string | undefined, string>;
}

export interface Database {
  auth_tokens: AuthTokensTable;
  users: UsersTable;
  books: BooksTable;
  book_drafts: BookDraftsTable;
  tags: TagsTable;
  book_tags: BookTagsTable;
  notes: NotesTable;
}

declare global {
  var _pgPool: Pool | undefined;
  var __bookshelfDb: Kysely<Database> | undefined;
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!globalThis._pgPool) {
    globalThis._pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return globalThis._pgPool;
}

function getDb(): Kysely<Database> {
  if (!globalThis.__bookshelfDb) {
    globalThis.__bookshelfDb = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: getPool() }),
    });
  }
  return globalThis.__bookshelfDb;
}

export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    return getPool()[prop as keyof Pool];
  },
});

export function query(text: string, params?: unknown[]) {
  return getPool().query(text, params);
}

export const db = new Proxy({} as Kysely<Database>, {
  get(_, prop) {
    const instance = getDb();
    const value = instance[prop as keyof Kysely<Database>];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(instance);
    }
    return value;
  },
});
