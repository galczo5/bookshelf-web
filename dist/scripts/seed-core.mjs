/**
 * Importable seed core — no `server-only` and no `@/lib/*` imports so this
 * can be called from a Next.js server action and from the CLI alike.
 *
 * Asset resolution: SEED_DIR is derived from import.meta.dirname so the
 * Dockerfile only needs to place books.json + covers/ adjacent to the
 * compiled/bundled module (see Dockerfile.allinone, Phase 3).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
const SEED_DIR = path.join(import.meta.dirname, "seed");
const COVERS_DIR = path.join(SEED_DIR, "covers");
function mimeForCover(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  throw new Error(`Unsupported cover extension for ${file}`);
}
/** Whether a book carries an actual cover image (vs. a deliberate empty state). */
export function hasCover(book) {
  var _a;
  return (
    book.coverFile !== null &&
    !((_a = book.incomplete) !== null && _a !== void 0 ? _a : []).includes("cover")
  );
}
/** Whether a book carries an author (vs. a deliberate empty state). */
export function hasAuthor(book) {
  var _a;
  return (
    book.author !== null &&
    !((_a = book.incomplete) !== null && _a !== void 0 ? _a : []).includes("author")
  );
}
/** Fail fast on a malformed manifest before touching the DB. */
export function preflight(books) {
  if (books.length !== 50) {
    throw new Error(`Manifest has ${books.length} entries, expected 50`);
  }
  const slugs = new Set();
  for (const book of books) {
    if (slugs.has(book.slug)) throw new Error(`Duplicate slug: ${book.slug}`);
    slugs.add(book.slug);
    if (hasCover(book)) {
      const coverPath = path.join(COVERS_DIR, book.coverFile);
      if (!existsSync(coverPath)) {
        throw new Error(`Missing cover file for ${book.slug}: ${coverPath}`);
      }
    }
  }
}
export async function seed(pool, email, books) {
  var _a, _b, _c, _d, _e;
  preflight(books);
  const { rows: userRows } = await pool.query(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email]
  );
  const userId = userRows[0].id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const titles = books.map((b) => b.title);
    await client.query(`DELETE FROM books WHERE user_id = $1 AND title = ANY($2)`, [
      userId,
      titles,
    ]);
    const tagNames = [...new Set(books.flatMap((b) => b.tags))];
    const tagId = new Map();
    for (const name of tagNames) {
      const { rows } = await client.query(
        `INSERT INTO tags (user_id, name) VALUES ($1, $2)
         ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [userId, name]
      );
      tagId.set(name, rows[0].id);
    }
    for (const book of books) {
      const coverBytes = hasCover(book)
        ? readFileSync(path.join(COVERS_DIR, book.coverFile))
        : null;
      const coverMime = hasCover(book) ? mimeForCover(book.coverFile) : null;
      const epubSnapshot = book.epubMetadata ? JSON.stringify(book.epubMetadata) : null;
      const { rows } = await client.query(
        `INSERT INTO books
           (user_id, drive_file_id, title, author, isbn,
            publisher, language, published_date, description,
            cover_bytes, cover_mime, epub_metadata_snapshot, review_state)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed')
         RETURNING id`,
        [
          userId,
          book.title,
          hasAuthor(book) ? book.author : null,
          book.isbn,
          (_a = book.publisher) !== null && _a !== void 0 ? _a : null,
          (_b = book.language) !== null && _b !== void 0 ? _b : null,
          (_c = book.publishedDate) !== null && _c !== void 0 ? _c : null,
          (_d = book.description) !== null && _d !== void 0 ? _d : null,
          coverBytes,
          coverMime,
          epubSnapshot,
        ]
      );
      const bookId = rows[0].id;
      for (const name of book.tags) {
        await client.query(
          `INSERT INTO book_tags (book_id, tag_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [bookId, tagId.get(name)]
        );
      }
      for (const body of (_e = book.notes) !== null && _e !== void 0 ? _e : []) {
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
/**
 * High-level entry for in-process callers (server actions, tests).
 * Creates its own Pool, runs the seed, and ends the pool.
 * Passes force: true so production NODE_ENV does not block.
 */
export async function runSeed(opts) {
  const books = JSON.parse(readFileSync(path.join(SEED_DIR, "books.json"), "utf8"));
  const pool = new Pool({ connectionString: opts.databaseUrl });
  try {
    await seed(pool, opts.email, books);
    return { seeded: books.length };
  } finally {
    await pool.end();
  }
}
