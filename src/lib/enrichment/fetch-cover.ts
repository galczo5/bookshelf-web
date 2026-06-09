import "server-only";

/**
 * Download a cover image from an HTTPS URL, enforcing an image content-type
 * and a 5 MB ceiling. Shared by the import-review confirm flow and the
 * post-import re-enrichment flow.
 */
export async function fetchCover(url: string): Promise<{ bytes: Buffer; mime: string }> {
  if (!url.startsWith("https://")) {
    throw new Error("Cover URL must use HTTPS");
  }

  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) {
    throw new Error(`Cover fetch failed with status ${resp.status}`);
  }

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Cover URL did not return an image (got ${contentType})`);
  }

  const mime = contentType.split(";")[0].trim();
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response body");

  const chunks: Uint8Array[] = [];
  let total = 0;
  const MAX = 5 * 1024 * 1024;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX) {
        await reader.cancel();
        throw new Error("Cover image exceeds 5 MB limit");
      }
      chunks.push(value);
    }
  }

  return { bytes: Buffer.concat(chunks), mime };
}
