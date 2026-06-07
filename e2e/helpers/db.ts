import { Pool } from "pg";

// E2E talks to Postgres directly via `pg` rather than through `@/lib/db`, which
// is marked `server-only` and throws outside a React Server context. Raw SQL
// here keeps the harness self-contained.
//
// Unlike the integration harness (tests/helpers/db.ts → resetDb TRUNCATEs every
// table), e2e must be safe against a long-lived / shared dev database. So the
// convention is the opposite: seed rows with a unique identifier, then delete
// only those rows in cleanup. Two parallel runs never collide and never wipe
// each other's data.

// `allowExitOnIdle` lets the runner process exit without an explicit pool
// teardown once all connections are idle.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  allowExitOnIdle: true,
});

// A stable e2e operator. The email here MUST match the email the session cookie
// is minted for (see e2e/helpers/fixtures.ts) — the book page resolves the
// user_id from session.user.email.
export const E2E_USER = { email: "e2e@example.com" } as const;

/** Idempotently ensure the e2e operator exists; returns their user id. */
export async function ensureE2eUser(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [E2E_USER.email]
  );
  return rows[0].id;
}

/**
 * Seed a confirmed, non-trashed book the book page will render. `title` carries
 * the per-test unique identifier so cleanup is exact and runs don't collide.
 */
export async function seedConfirmedBook(input: { userId: string; title: string }): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO books (user_id, title, drive_file_id, review_state)
     VALUES ($1, $2, $3, 'confirmed')
     RETURNING id`,
    [input.userId, input.title, `e2e-drive-${input.title}`]
  );
  return rows[0].id;
}

/** Remove a seeded book; notes/tags cascade. Safe to call in cleanup. */
export async function deleteBook(bookId: string): Promise<void> {
  await pool.query(`DELETE FROM books WHERE id = $1`, [bookId]);
}
