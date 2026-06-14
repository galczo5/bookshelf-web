import "server-only";

export interface OpenLibraryData {
  isbns: string[];
  publishers: string[];
  publishDates: string[];
  languages: string[];
}

export async function fetchOpenLibraryData(
  title: string,
  author: string | null
): Promise<OpenLibraryData | null> {
  const params = new URLSearchParams({
    limit: "3",
    fields: "isbn,publisher,publish_date,language",
  });
  params.set("title", title);
  if (author) params.set("author", author);

  try {
    const res = await fetch(`https://openlibrary.org/search.json?${params}`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "bookshelf-app/1.0" },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { docs?: unknown[] };
    if (!Array.isArray(data.docs) || data.docs.length === 0) return null;

    const isbn13s: string[] = [];
    const isbn10s: string[] = [];
    const publishers = new Set<string>();
    const publishDates = new Set<string>();
    const languages = new Set<string>();

    for (const doc of data.docs.slice(0, 3)) {
      const d = doc as Record<string, unknown>;
      if (Array.isArray(d.isbn)) {
        for (const v of d.isbn) {
          if (typeof v !== "string") continue;
          if (v.startsWith("978") || v.startsWith("979")) {
            if (isbn13s.length < 5) isbn13s.push(v);
          } else {
            if (isbn10s.length < 3) isbn10s.push(v);
          }
        }
      }
      if (Array.isArray(d.publisher)) {
        d.publisher.slice(0, 2).forEach((v) => typeof v === "string" && publishers.add(v));
      }
      if (Array.isArray(d.publish_date)) {
        d.publish_date.slice(0, 2).forEach((v) => typeof v === "string" && publishDates.add(v));
      }
      if (Array.isArray(d.language)) {
        d.language.slice(0, 2).forEach((v) => typeof v === "string" && languages.add(v));
      }
    }

    // Prefer ISBN-13, fall back to ISBN-10
    const isbns = isbn13s.length > 0 ? isbn13s.slice(0, 3) : isbn10s.slice(0, 3);

    if (isbns.length === 0 && publishers.size === 0) return null;

    return {
      isbns,
      publishers: [...publishers].slice(0, 3),
      publishDates: [...publishDates].slice(0, 3),
      languages: [...languages].slice(0, 2),
    };
  } catch {
    return null;
  }
}
