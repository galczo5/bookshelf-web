import type { EnrichmentInput } from "./types";

export function buildEnrichmentPrompt(input: EnrichmentInput): string {
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

  lines.push(
    "",
    "## Instructions",
    "Return a JSON object matching the provided schema. For each field:",
    "- If the embedded value is present AND authoritative, return null for that field (no proposal needed).",
    "- If the embedded value is missing or likely wrong, use web search to find the best value and return a proposal.",
    "- 'provenance' must be a short phrase describing where the value came from (e.g., 'found on 8 bookseller listings', 'inferred from filename only — low confidence').",
    "- 'confidence' is 'high' when corroborated by multiple sources, 'low' when inferred or speculative.",
    "- 'alternatives' lists up to 3 other plausible values (not the primary value). Empty array if none.",
    "",
    "For cover URLs:",
    "- Return direct image URLs only (jpg, png, webp) — NOT page URLs.",
    "- Up to 3 URLs in 'urls'; 'primary' must be one of them.",
    "- Return null if no reliable cover image URL is found.",
    "",
    "Do NOT include any content from the book body. Only use filename, title, author, and ISBN to ground your search.",
    "Do NOT invent values; if uncertain and no web results confirm a value, return null for that field."
  );

  return lines.join("\n");
}
