/**
 * Generates one minimal, valid, empty-body EPUB 3 per entry in
 * scripts/seed/books.json and writes them to scripts/seed/epubs/<slug>.epub.
 *
 * These are mock library files for the dev seed (`npm run db:seed`) — structurally
 * valid epubs carrying each book's real embedded metadata + cover, but with a single
 * placeholder chapter for a body. They are committed artifacts and double as an
 * import-fixture corpus; the seeder itself does NOT read them.
 *
 * Mirrors the structure of scripts/generate-epub-fixture.mts:
 *   - `mimetype` is the first entry and STOREd (uncompressed) per the EPUB spec.
 *   - container.xml points at OEBPS/content.opf.
 *   - content.opf carries dc:title / dc:creator / dc:identifier and the cover item.
 *
 * Incomplete books (manifest `incomplete` flag) intentionally omit fields:
 *   - "author" → no dc:creator
 *   - "cover"  → no cover image item
 *
 * No DB and no `server-only` imports (JSZip only); output is deterministic given
 * the manifest + covers (fixed entry timestamps).
 *
 * Run with: tsx scripts/seed/generate-epubs.mts
 */
import JSZip from "jszip";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const MIMETYPE = "application/epub+zip";
const SEED_DIR = import.meta.dirname;
const COVERS_DIR = path.join(SEED_DIR, "covers");
const EPUBS_DIR = path.join(SEED_DIR, "epubs");
// Fixed timestamp keeps generated zip bytes deterministic across runs.
const FIXED_DATE = new Date("2020-01-01T00:00:00Z");

type Book = {
  slug: string;
  title: string;
  author: string | null;
  isbn: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  description?: string | null;
  coverFile: string | null;
  incomplete?: ("author" | "cover")[];
};

const books = JSON.parse(readFileSync(path.join(SEED_DIR, "books.json"), "utf8")) as Book[];

/** XML-escape text destined for element content / attributes. */
function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function mimeForCover(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  throw new Error(`Unsupported cover extension for ${file}`);
}

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function contentOpf(book: Book, cover: { file: string; mime: string } | null): string {
  const hasAuthor = book.author !== null && !(book.incomplete ?? []).includes("author");
  const metadata = [
    `    <dc:title>${xml(book.title)}</dc:title>`,
    `    <dc:language>en</dc:language>`,
    `    <dc:identifier id="uid">urn:bookshelf:seed:${xml(book.slug)}</dc:identifier>`,
  ];
  if (hasAuthor) metadata.push(`    <dc:creator>${xml(book.author!)}</dc:creator>`);
  if (book.isbn) {
    metadata.push(`    <dc:identifier scheme="ISBN">${xml(book.isbn)}</dc:identifier>`);
  }
  if (book.publisher) metadata.push(`    <dc:publisher>${xml(book.publisher)}</dc:publisher>`);
  if (book.publishedDate) metadata.push(`    <dc:date>${xml(book.publishedDate)}</dc:date>`);
  if (book.description)
    metadata.push(`    <dc:description>${xml(book.description)}</dc:description>`);
  const manifest = [];
  if (cover) {
    manifest.push(
      `    <item id="cover-image" href="${cover.file}" media-type="${cover.mime}" properties="cover-image"/>`
    );
  }
  manifest.push(
    `    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>
${metadata.join("\n")}
  </metadata>
  <manifest>
${manifest.join("\n")}
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`;
}

function chapterXhtml(book: Book): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${xml(book.title)}</title></head>
  <body>
    <h1>${xml(book.title)}</h1>
    <p>Placeholder body for a Bookshelf dev-seed mock epub. Not the real text.</p>
  </body>
</html>`;
}

/**
 * Validate that a generated buffer is an epub whose first local file entry is an
 * uncompressed `mimetype` containing `application/epub+zip`. Reads the raw local
 * file header rather than re-parsing with JSZip so we assert byte-level ordering.
 */
function assertValidEpub(slug: string, buf: Buffer): void {
  // Local file header signature.
  if (buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`${slug}: missing local file header signature`);
  }
  const compression = buf.readUInt16LE(8); // 0 = STORE
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const name = buf.toString("ascii", 30, 30 + nameLen);
  if (name !== "mimetype") {
    throw new Error(`${slug}: first entry is "${name}", expected "mimetype"`);
  }
  if (compression !== 0) {
    throw new Error(`${slug}: mimetype entry is compressed (method ${compression}), must be STORE`);
  }
  const dataStart = 30 + nameLen + extraLen;
  const content = buf.toString("ascii", dataStart, dataStart + MIMETYPE.length);
  if (content !== MIMETYPE) {
    throw new Error(`${slug}: mimetype content is "${content}", expected "${MIMETYPE}"`);
  }
}

mkdirSync(EPUBS_DIR, { recursive: true });

let count = 0;
for (const book of books) {
  const wantsCover = book.coverFile !== null && !(book.incomplete ?? []).includes("cover");
  let cover: { file: string; mime: string } | null = null;
  let coverBytes: Buffer | null = null;
  if (wantsCover) {
    coverBytes = readFileSync(path.join(COVERS_DIR, book.coverFile!));
    const outName = `cover${path.extname(book.coverFile!).toLowerCase()}`;
    cover = { file: outName, mime: mimeForCover(book.coverFile!) };
  }

  const zip = new JSZip();
  // mimetype must be first and STOREd (uncompressed) per the EPUB spec.
  zip.file("mimetype", MIMETYPE, { compression: "STORE", date: FIXED_DATE });
  zip.file("META-INF/container.xml", CONTAINER_XML, { date: FIXED_DATE });
  zip.file("OEBPS/content.opf", contentOpf(book, cover), { date: FIXED_DATE });
  if (cover && coverBytes) {
    zip.file(`OEBPS/${cover.file}`, coverBytes, { date: FIXED_DATE });
  }
  zip.file("OEBPS/chapter1.xhtml", chapterXhtml(book), { date: FIXED_DATE });

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  assertValidEpub(book.slug, buffer);
  writeFileSync(path.join(EPUBS_DIR, `${book.slug}.epub`), buffer);
  count++;
}

console.log(`Generated ${count} epubs in ${EPUBS_DIR}`);
