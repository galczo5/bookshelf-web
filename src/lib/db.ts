import "server-only";
import { Pool } from "pg";

declare global {
  var _pgPool: Pool | undefined;
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

export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    return getPool()[prop as keyof Pool];
  },
});

export function query(text: string, params?: unknown[]) {
  return getPool().query(text, params);
}
