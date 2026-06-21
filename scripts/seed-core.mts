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

export type Book = {
  slug: string;
  title: string;
  author: string | null;
  isbn: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  language?: string | null;
  description?: string | null;
  epubMetadata?: {
    title: string | null;
    author: string | null;
    isbn: string | null;
    publisher: string | null;
    language: string | null;
    publishedDate: string | null;
    description: string | null;
  };
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

/** Whether a book carries an actual cover image (vs. a deliberate empty state). */
export function hasCover(book: Book): boolean {
  return book.coverFile !== null && !(book.incomplete ?? []).includes("cover");
}

/** Whether a book carries an author (vs. a deliberate empty state). */
export function hasAuthor(book: Book): boolean {
  return book.author !== null && !(book.incomplete ?? []).includes("author");
}

/** Fail fast on a malformed manifest before touching the DB. */
export function preflight(books: Book[]): void {
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

export async function seed(pool: Pool, email: string, books: Book[]): Promise<void> {
  preflight(books);

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

    const titles = books.map((b) => b.title);
    await client.query(`DELETE FROM books WHERE user_id = $1 AND title = ANY($2)`, [
      userId,
      titles,
    ]);

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
      const epubSnapshot = book.epubMetadata ? JSON.stringify(book.epubMetadata) : null;

      const { rows } = await client.query<{ id: string }>(
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
          book.publisher ?? null,
          book.language ?? null,
          book.publishedDate ?? null,
          book.description ?? null,
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

/**
 * High-level entry for in-process callers (server actions, tests).
 * Creates its own Pool, runs the seed, and ends the pool.
 * Passes force: true so production NODE_ENV does not block.
 */
export async function runSeed(opts: {
  databaseUrl: string;
  email: string;
  force?: boolean;
}): Promise<{ seeded: number }> {
  const books = JSON.parse(readFileSync(path.join(SEED_DIR, "books.json"), "utf8")) as Book[];
  const pool = new Pool({ connectionString: opts.databaseUrl });
  try {
    await seed(pool, opts.email, books);
    return { seeded: books.length };
  } finally {
    await pool.end();
  }
}
