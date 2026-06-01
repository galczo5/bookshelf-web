import type { TagSuggestionInput } from "./types";

export function buildTagSuggestionPrompt(input: TagSuggestionInput): string {
  const lines: string[] = [
    "You are a book categorization expert. Use web search to find genre, theme, and subject tags for the book described below.",
    "",
    "## Book details",
    `Title: ${input.title}`,
    `Author: ${input.author ?? "(unknown)"}`,
    `ISBN: ${input.isbn ?? "(unknown)"}`,
  ];

  if (input.existingTagNames.length > 0) {
    lines.push(
      "",
      "## User's existing tags",
      "Prefer reusing these exact tags (case-insensitive match). Set isNew: false when reusing one.",
      ...input.existingTagNames.map((t) => `  - ${t}`)
    );
  }

  lines.push(
    "",
    "## Instructions",
    "Return a JSON object matching the provided schema with 3–8 tag proposals.",
    "- Search for the book to identify its genres, themes, subjects, and mood.",
    "- Prefer reusing an existing tag when it fits. Set isNew: false and use the existing tag's exact casing.",
    "- Only propose a new tag (isNew: true) when no existing tag is a reasonable fit.",
    "- 'provenance' must be a short phrase citing where the classification comes from (e.g., 'described as historical fiction on 3 bookseller listings', 'genre listed on Goodreads').",
    "",
    "Do NOT include any content from the book body. Use only title, author, and ISBN.",
    "Do NOT invent metadata; base all proposals on web search results."
  );

  return lines.join("\n");
}
