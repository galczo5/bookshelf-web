/**
 * Generates tests/fixtures/minimal.epub — a tiny, valid EPUB 3 fixture
 * with known metadata for use in integration tests.
 *
 * Expected parseEpub result:
 *   { title: "Test Book", author: "Test Author", isbn: "9780000000000", cover: <1×1 PNG> }
 *
 * Run with: tsx scripts/generate-epub-fixture.mts
 */
import JSZip from "jszip";
import { writeFileSync } from "node:fs";
import path from "node:path";

const MIMETYPE = "application/epub+zip";

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:identifier id="uid" scheme="ISBN">9780000000000</dc:identifier>
  </metadata>
  <manifest>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`;

const CHAPTER_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 1</title></head>
  <body><p>Test content.</p></body>
</html>`;

// Minimal 1×1 red pixel PNG (67 bytes)
const COVER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

const zip = new JSZip();

// mimetype must be first and stored (uncompressed) per the EPUB spec
zip.file("mimetype", MIMETYPE, { compression: "STORE" });
zip.file("META-INF/container.xml", CONTAINER_XML);
zip.file("OEBPS/content.opf", CONTENT_OPF);
zip.file("OEBPS/cover.png", Buffer.from(COVER_PNG_BASE64, "base64"));
zip.file("OEBPS/chapter1.xhtml", CHAPTER_XHTML);

const buffer = await zip.generateAsync({ type: "nodebuffer" });
const outPath = path.join(import.meta.dirname, "../tests/fixtures/minimal.epub");
writeFileSync(outPath, buffer);
console.log(`Generated ${outPath} (${buffer.length} bytes)`);
