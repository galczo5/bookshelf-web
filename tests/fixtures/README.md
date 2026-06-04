# Test Fixtures

## minimal.epub

A minimal, valid EPUB 3 archive (< 5 KB) committed as a binary for integration tests.

**Expected `parseEpub` result:**

```json
{
  "title": "Test Book",
  "author": "Test Author",
  "isbn": "9780000000000",
  "cover": { "mime": "image/png", "bytes": "<1×1 PNG>" }
}
```

**Structure:**

```
mimetype                      (STORE, uncompressed — required by EPUB spec)
META-INF/container.xml
OEBPS/content.opf             (title, author, identifier with scheme="ISBN", cover manifest item)
OEBPS/cover.png               (1×1 pixel PNG)
OEBPS/chapter1.xhtml          (stub chapter)
```

**To regenerate:**

```bash
tsx scripts/generate-epub-fixture.mts
```

The generator script is `scripts/generate-epub-fixture.mts`. It uses `jszip` (already a project dependency) and writes the binary to this directory.
