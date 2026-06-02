"use client";

import { highlightMatches } from "@/lib/search-utils";

export function Highlighted({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.JSX.Element {
  const segments = highlightMatches(text, query);
  return (
    <>
      {segments.map((seg, i) =>
        seg.mark ? <mark key={i}>{seg.text}</mark> : seg.text
      )}
    </>
  );
}
