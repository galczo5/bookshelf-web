import type { EnrichmentInput } from "./types";
import type { OpenLibraryData } from "./open-library";

export function buildEnrichmentPrompt(
  input: EnrichmentInput,
  openLibrary?: OpenLibraryData | null
): string {
  const lines: string[] = [
    "You are a book metadata expert. Use web search to find accurate metadata for the ebook described below.",
    "",
    "## Ebook details",
    `Filename: ${input.filename}`,
    `Embedded title: ${input.embeddedTitle ?? "(missing)"}`,
    `Embedded author: ${input.embeddedAuthor ?? "(missing)"}`,
    `Embedded ISBN: ${input.embeddedIsbn ?? "(missing)"}`,
  ];

  if (input.frontMatterStrings.length > 0) {
    lines.push("Front matter snippets:", ...input.frontMatterStrings.map((s) => `  - ${s}`));
  }

  if (openLibrary) {
    lines.push(
      "",
      "## Open Library data (structured — use as primary source for isbn, publisher, publishedDate, language)"
    );
    if (openLibrary.isbns.length > 0) {
      lines.push(`ISBNs found: ${openLibrary.isbns.join(", ")}`);
    }
    if (openLibrary.publishers.length > 0) {
      lines.push(`Publishers: ${openLibrary.publishers.join(", ")}`);
    }
    if (openLibrary.publishDates.length > 0) {
      lines.push(`Publish dates: ${openLibrary.publishDates.join(", ")}`);
    }
    if (openLibrary.languages.length > 0) {
      lines.push(`Languages: ${openLibrary.languages.join(", ")}`);
    }
  }

  lines.push(
    "",
    "## Instructions",
    "Return a JSON object matching the provided schema. For each field:",
    "- If the embedded value is present AND authoritative, return null for that field (no proposal needed).",
    "- If the embedded value is missing or likely wrong, use the Open Library data above (if present) or web search to find the best value and return a proposal.",
    "- 'provenance' must be a short phrase describing where the value came from (e.g., 'found on 8 bookseller listings', 'Open Library — 3 editions', 'inferred from filename only — low confidence').",
    "- 'confidence' is 'high' when corroborated by multiple sources, 'low' when inferred or speculative.",
    "- 'alternatives' lists up to 3 other plausible values (not the primary value). Empty array if none.",
    "",
    "For isbn specifically:",
    "- If Open Library ISBNs are listed above, pick one (prefer ISBN-13 starting with 978 or 979) and set confidence to 'high'.",
    "- List remaining Open Library ISBNs as alternatives.",
    "- Only fall back to web search if no Open Library ISBN was provided.",
    "",
    "For cover URLs:",
    "- Return direct image URLs only (jpg, png, webp) — NOT page URLs.",
    "- Up to 3 URLs in 'urls'; 'primary' must be one of them.",
    "- Return null if no reliable cover image URL is found.",
    "",
    "For publisher, language, publishedDate, and description:",
    "- publisher: the original publisher name (e.g. 'Penguin Books').",
    "- language: the primary language as a short tag or name (e.g. 'en', 'English', 'Polish').",
    "- publishedDate: the original publication date; prefer ISO format (e.g. '2004', '2004-03-01').",
    "- description: a short plain-text synopsis (no HTML tags). Return null if none is reliably known.",
    "",
    "Do NOT include any content from the book body. Only use filename, title, author, and ISBN to ground your search.",
    "Do NOT invent values; if uncertain and no web results confirm a value, return null for that field."
  );

  return lines.join("\n");
}
