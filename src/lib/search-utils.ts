export function foldDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(foldDiacritics);
}

export function matchesQuery(
  book: { title: string; author: string | null },
  query: string
): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const foldedTitle = foldDiacritics(book.title);
  const foldedAuthor = foldDiacritics(book.author ?? "");
  return tokens.every(
    (tok) => foldedTitle.includes(tok) || foldedAuthor.includes(tok)
  );
}
