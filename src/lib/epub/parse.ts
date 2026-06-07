import "server-only";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface EpubMetadata {
  title: string | null;
  author: string | null;
  isbn: string | null;
  cover: { bytes: Buffer; mime: string } | null;
}

export class EpubParseError extends Error {
  code = "EPUB_PARSE_ERROR" as const;
}

const xmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  isArray: (name) => ["manifest", "item", "metadata", "dc:creator", "dc:identifier"].includes(name),
});

export async function parseEpub(buffer: Buffer): Promise<EpubMetadata> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new EpubParseError("Not a valid zip archive");
  }

  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new EpubParseError("Missing META-INF/container.xml");

  let containerXml: string;
  try {
    containerXml = await containerFile.async("string");
  } catch {
    throw new EpubParseError("Cannot read container.xml");
  }

  let containerDoc: ReturnType<typeof xmlParser.parse>;
  try {
    containerDoc = xmlParser.parse(containerXml);
  } catch {
    throw new EpubParseError("Cannot parse container.xml");
  }

  const rootfilePath: string | undefined =
    containerDoc?.container?.rootfiles?.rootfile?.["@_full-path"];
  if (!rootfilePath) throw new EpubParseError("Cannot locate OPF rootfile path");

  const opfFile = zip.file(rootfilePath);
  if (!opfFile) throw new EpubParseError(`OPF file not found at: ${rootfilePath}`);

  let opfXml: string;
  try {
    opfXml = await opfFile.async("string");
  } catch {
    throw new EpubParseError("Cannot read OPF file");
  }

  let opfDoc: ReturnType<typeof xmlParser.parse>;
  try {
    opfDoc = xmlParser.parse(opfXml);
  } catch {
    throw new EpubParseError("Cannot parse OPF file");
  }

  const pkg = opfDoc?.package ?? opfDoc?.["opf:package"];
  const metadata = pkg?.metadata ?? pkg?.["opf:metadata"];
  const manifest = pkg?.manifest ?? pkg?.["opf:manifest"];

  // --- title ---
  const titleRaw = metadata?.["dc:title"];
  const title: string | null = extractFirst(titleRaw);

  // --- author ---
  const creatorRaw = metadata?.["dc:creator"];
  const author: string | null = extractAuthors(creatorRaw);

  // --- isbn ---
  const identifiers: unknown[] = asArray(metadata?.["dc:identifier"]);
  const isbn: string | null = extractIsbn(identifiers);

  // --- cover ---
  const opfDir = rootfilePath.includes("/")
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf("/") + 1)
    : "";

  const items: unknown[] = asArray(manifest?.item);
  const cover = await extractCover(zip, opfDir, items, metadata);

  return { title, author, isbn, cover };
}

function extractFirst(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw.trim() || null;
  if (typeof raw === "number") return String(raw);
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === "string") return first.trim() || null;
    if (first && typeof first === "object") {
      const text = (first as Record<string, unknown>)["#text"];
      if (typeof text === "string") return text.trim() || null;
    }
  }
  if (typeof raw === "object") {
    const text = (raw as Record<string, unknown>)["#text"];
    if (typeof text === "string") return text.trim() || null;
  }
  return null;
}

function extractAuthors(raw: unknown): string | null {
  if (!raw) return null;
  const arr = asArray(raw);
  const names = arr
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (typeof item === "number") return String(item);
      if (item && typeof item === "object") {
        const text = (item as Record<string, unknown>)["#text"];
        if (typeof text === "string") return text.trim();
      }
      return "";
    })
    .filter(Boolean);
  return names.length ? names.join(", ") : null;
}

function extractIsbn(identifiers: unknown[]): string | null {
  for (const id of identifiers) {
    if (!id || typeof id !== "object") continue;
    const obj = id as Record<string, unknown>;
    const scheme =
      (obj["@_opf:scheme"] as string | undefined) ?? (obj["@_scheme"] as string | undefined) ?? "";
    if (scheme.toLowerCase() === "isbn") {
      const text = obj["#text"];
      if (typeof text === "string" && text.trim()) return text.trim();
      if (typeof text === "number") return String(text);
    }
  }
  return null;
}

async function extractCover(
  zip: JSZip,
  opfDir: string,
  items: unknown[],
  metadata: unknown
): Promise<{ bytes: Buffer; mime: string } | null> {
  // EPUB 3: manifest item with properties="cover-image"
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const props = (obj["@_properties"] as string | undefined) ?? "";
    if (props.split(" ").includes("cover-image")) {
      const href = obj["@_href"] as string | undefined;
      const mime = (obj["@_media-type"] as string | undefined) ?? "image/jpeg";
      if (href) {
        const bytes = await readZipEntry(zip, opfDir + href);
        if (bytes) return { bytes, mime };
      }
    }
  }

  // EPUB 2: <meta name="cover" content="<itemId>">
  if (metadata && typeof metadata === "object") {
    const metas = asArray((metadata as Record<string, unknown>)["meta"]);
    for (const meta of metas) {
      if (!meta || typeof meta !== "object") continue;
      const obj = meta as Record<string, unknown>;
      const name = (obj["@_name"] as string | undefined) ?? "";
      if (name.toLowerCase() === "cover") {
        const itemId = (obj["@_content"] as string | undefined) ?? "";
        if (itemId) {
          const coverItem = items.find(
            (i) => i && typeof i === "object" && (i as Record<string, unknown>)["@_id"] === itemId
          ) as Record<string, unknown> | undefined;
          if (coverItem) {
            const href = coverItem["@_href"] as string | undefined;
            const mime = (coverItem["@_media-type"] as string | undefined) ?? "image/jpeg";
            if (href) {
              const bytes = await readZipEntry(zip, opfDir + href);
              if (bytes) return { bytes, mime };
            }
          }
        }
      }
    }
  }

  return null;
}

async function readZipEntry(zip: JSZip, path: string): Promise<Buffer | null> {
  const f = zip.file(path);
  if (!f) return null;
  try {
    const arr = await f.async("nodebuffer");
    return arr;
  } catch {
    return null;
  }
}

function asArray(val: unknown): unknown[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}
