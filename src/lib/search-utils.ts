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

export function highlightMatches(
  text: string,
  query: string
): Array<{ text: string; mark: boolean }> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [{ text, mark: false }];

  // foldDiacritics preserves codepoint count for BMP Latin characters,
  // so indices in `folded` align 1-to-1 with `text`.
  const folded = foldDiacritics(text);

  const ranges: Array<[number, number]> = [];
  for (const tok of tokens) {
    let from = 0;
    while (from <= folded.length - tok.length) {
      const idx = folded.indexOf(tok, from);
      if (idx === -1) break;
      ranges.push([idx, idx + tok.length]);
      from = idx + tok.length;
    }
  }
  if (ranges.length === 0) return [{ text, mark: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const out: Array<{ text: string; mark: boolean }> = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) out.push({ text: text.slice(cursor, s), mark: false });
    out.push({ text: text.slice(s, e), mark: true });
    cursor = e;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), mark: false });
  return out;
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
