import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

export type Database = Record<string, never>;

declare global {
  var __bookshelfDb: Kysely<Database> | undefined;
}

function createDb(): Kysely<Database> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: process.env.DATABASE_URL }),
    }),
  });
}

export const db = globalThis.__bookshelfDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalThis.__bookshelfDb = db;
}
