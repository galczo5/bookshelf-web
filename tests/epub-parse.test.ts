import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseEpub } from "@/lib/epub/parse";

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

async function buildEpub(metadata: string): Promise<Buffer> {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>${metadata}</metadata>
  <manifest/>
  <spine/>
</package>`;

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", opf);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parseEpub — new metadata fields", () => {
  it("extracts publisher, language, publishedDate, description when all present", async () => {
    const buf = await buildEpub(`
      <dc:title>A Book</dc:title>
      <dc:publisher>Penguin</dc:publisher>
      <dc:language>en</dc:language>
      <dc:date>2023-05-01</dc:date>
      <dc:description>A great read.</dc:description>
    `);

    const result = await parseEpub(buf);
    expect(result.publisher).toBe("Penguin");
    expect(result.language).toBe("en");
    expect(result.publishedDate).toBe("2023-05-01");
    expect(result.description).toBe("A great read.");
  });

  it("returns null for each field when absent", async () => {
    const buf = await buildEpub(`<dc:title>Sparse</dc:title>`);

    const result = await parseEpub(buf);
    expect(result.publisher).toBeNull();
    expect(result.language).toBeNull();
    expect(result.publishedDate).toBeNull();
    expect(result.description).toBeNull();
  });

  it("strips HTML tags from description", async () => {
    const buf = await buildEpub(`
      <dc:title>Tagged</dc:title>
      <dc:description>&lt;p&gt;A &lt;strong&gt;bold&lt;/strong&gt; description.&lt;/p&gt;</dc:description>
    `);

    const result = await parseEpub(buf);
    expect(result.description).toBe("A bold description.");
  });

  it("returns null for description that is only HTML tags", async () => {
    const buf = await buildEpub(`
      <dc:title>Empty tags</dc:title>
      <dc:description>&lt;p&gt;&lt;/p&gt;</dc:description>
    `);

    const result = await parseEpub(buf);
    expect(result.description).toBeNull();
  });
});
