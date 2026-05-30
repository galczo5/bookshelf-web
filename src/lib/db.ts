import "server-only";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

export type Database = Record<string, never>;

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
    return getDb()[prop as keyof Kysely<Database>];
  },
});
