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
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";

const SEED_DIR = path.join(import.meta.dirname, "seed");
const COVERS_DIR = path.join(SEED_DIR, "covers");

type Book = {
  slug: string;
  title: string;
  author: string | null;
  isbn: string | null;
  coverFile: string | null;
  coverSourceUrl: string | null;
  tags: string[];
  notes?: string[];
  incomplete?: ("author" | "cover")[];
};

function mimeForCover(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  throw new Error(`Unsupported cover extension for ${file}`);
}

/** Resolve the seed operator email from `--email <addr>` or the env var. */
function resolveEmail(argv: string[]): string | null {
  const i = argv.indexOf("--email");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return process.env.BOOKSHELF_ALLOWED_EMAIL ?? null;
}

/** Whether a book carries an actual cover image (vs. a deliberate empty state). */
function hasCover(book: Book): boolean {
  return book.coverFile !== null && !(book.incomplete ?? []).includes("cover");
}

/** Whether a book carries an author (vs. a deliberate empty state). */
function hasAuthor(book: Book): boolean {
  return book.author !== null && !(book.incomplete ?? []).includes("author");
}

/** Fail fast on a malformed manifest before touching the DB. */
function preflight(books: Book[]): void {
  if (books.length !== 50) {
    throw new Error(`Manifest has ${books.length} entries, expected 50`);
  }
  const slugs = new Set<string>();
  for (const book of books) {
    if (slugs.has(book.slug)) throw new Error(`Duplicate slug: ${book.slug}`);
    slugs.add(book.slug);
    if (hasCover(book)) {
      const coverPath = path.join(COVERS_DIR, book.coverFile!);
      if (!existsSync(coverPath)) {
        throw new Error(`Missing cover file for ${book.slug}: ${coverPath}`);
      }
    }
  }
}

async function seed(pool: Pool, email: string, books: Book[]): Promise<void> {
  preflight(books);

  // Upsert the seed operator (pattern from e2e/helpers/db.ts).
  const { rows: userRows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email]
  );
  const userId = userRows[0].id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotent cleanup: only the manifest's known titles for this user.
    // notes / book_tags cascade on book delete.
    const titles = books.map((b) => b.title);
    await client.query(`DELETE FROM books WHERE user_id = $1 AND title = ANY($2)`, [
      userId,
      titles,
    ]);

    // Upsert all distinct tags up front; collect their ids.
    const tagNames = [...new Set(books.flatMap((b) => b.tags))];
    const tagId = new Map<string, string>();
    for (const name of tagNames) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO tags (user_id, name) VALUES ($1, $2)
         ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [userId, name]
      );
      tagId.set(name, rows[0].id);
    }

    for (const book of books) {
      const coverBytes = hasCover(book)
        ? readFileSync(path.join(COVERS_DIR, book.coverFile!))
        : null;
      const coverMime = hasCover(book) ? mimeForCover(book.coverFile!) : null;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO books
           (user_id, drive_file_id, title, author, isbn, cover_bytes, cover_mime, review_state)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, 'confirmed')
         RETURNING id`,
        [userId, book.title, hasAuthor(book) ? book.author : null, book.isbn, coverBytes, coverMime]
      );
      const bookId = rows[0].id;

      for (const name of book.tags) {
        await client.query(
          `INSERT INTO book_tags (book_id, tag_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [bookId, tagId.get(name)]
        );
      }

      for (const body of book.notes ?? []) {
        await client.query(`INSERT INTO notes (book_id, body) VALUES ($1, $2)`, [bookId, body]);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`Seeded ${books.length} books`);
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

  const books = JSON.parse(readFileSync(path.join(SEED_DIR, "books.json"), "utf8")) as Book[];

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
