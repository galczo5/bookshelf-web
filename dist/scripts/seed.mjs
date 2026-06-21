/**
 * Idempotent dev seeder: prefills a local Postgres with 50 public-domain books
 * (covers, tags, notes) so the library, tag-filter, search, note, and
 * trash/restore surfaces have realistic data without a live Google Drive or a
 * real import flow.
 *
 * Run with: DATABASE_URL=... BOOKSHELF_ALLOWED_EMAIL=you@example.com npm run db:seed
 *   (or pass --email <addr> instead of BOOKSHELF_ALLOWED_EMAIL)
 *
 * Design notes:
 *   - Mirrors scripts/migrate.mts for the raw `pg` Pool + CLI-entry shape. It
 *     MUST NOT import `@/lib/db` or `@/lib/epub/parse` — both are `server-only`
 *     and throw outside a React Server context.
 *   - The production guard checks `NODE_ENV === 'production'`, not the target
 *     database. Running with NODE_ENV unset but DATABASE_URL pointed at a prod
 *     DB bypasses the guard, so keep DATABASE_URL pointed at local dev.
 *   - Seed books have `drive_file_id = NULL` by design: that routes trash/restore
 *     through the DB-only branch (src/app/actions/books.ts), so it works in dev
 *     with no Drive credentials. A non-null placeholder would force a failing
 *     Drive API call.
 *   - Books are inserted `review_state = 'confirmed'`, non-trashed, so the
 *     library query (src/lib/books.ts) shows them.
 *   - Idempotency without a marker column: cleanup deletes only the manifest's
 *     known titles for the seed user (notes/book_tags cascade), so a developer's
 *     real imports (different titles, non-null drive ids) survive. Re-running
 *     leaves exactly 50 seed books.
 *   - The committed mock epubs (scripts/seed/epubs/) are NOT read here; the seed
 *     sources metadata from books.json and cover bytes from scripts/seed/covers/.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";
import { seed } from "./seed-core.mjs";
const SEED_DIR = path.join(import.meta.dirname, "seed");
/** Resolve the seed operator email from `--email <addr>` or the env var. */
function resolveEmail(argv) {
  var _a;
  const i = argv.indexOf("--email");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return (_a = process.env.BOOKSHELF_ALLOWED_EMAIL) !== null && _a !== void 0 ? _a : null;
}
// CLI entry point — only executes when this script is the process entry point.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const argv = process.argv.slice(2);
  if (process.env.NODE_ENV === "production" && !argv.includes("--force")) {
    console.error("Refusing to seed in production. Pass --force to override.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const email = resolveEmail(argv);
  if (!email) {
    console.error("No seed email: pass --email <addr> or set BOOKSHELF_ALLOWED_EMAIL");
    process.exit(1);
  }
  const books = JSON.parse(readFileSync(path.join(SEED_DIR, "books.json"), "utf8"));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await seed(pool, email, books);
  } catch (err) {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
