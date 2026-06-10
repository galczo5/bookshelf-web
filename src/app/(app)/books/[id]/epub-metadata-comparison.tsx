"use client";

import { Fragment, useEffect, useState } from "react";

interface DbMetadata {
  title: string;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  language: string | null;
  publishedDate: string | null;
  description: string | null;
}

type NullableMetadata = { [K in keyof DbMetadata]: string | null };

type EpubResponse =
  | {
      available: true;
      title: string | null;
      author: string | null;
      isbn: string | null;
      publisher: string | null;
      language: string | null;
      publishedDate: string | null;
      description: string | null;
    }
  | { available: false; reason: "no_drive_file" | "drive_error" | "parse_error" };

interface Props {
  bookId: string;
  db: DbMetadata;
}

const ROWS: { label: string; key: keyof DbMetadata }[] = [
  { label: "Title", key: "title" },
  { label: "Author", key: "author" },
  { label: "ISBN", key: "isbn" },
  { label: "Publisher", key: "publisher" },
  { label: "Language", key: "language" },
  { label: "Published", key: "publishedDate" },
  { label: "Description", key: "description" },
];

const REASON_LABELS: Record<string, string> = {
  no_drive_file: "no Drive file attached",
  drive_error: "Drive unreachable",
  parse_error: "epub could not be parsed",
};

function displayValue(val: string | null | undefined): string {
  return val?.trim() || "—";
}

function valuesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) => v?.trim() || null;
  return norm(a) === norm(b);
}

function Skeleton() {
  return <div className="h-4 w-20 animate-pulse rounded bg-zinc-200" />;
}

export function EpubMetadataComparison({ bookId, db }: Props): React.JSX.Element {
  const [epubData, setEpubData] = useState<EpubResponse | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    fetch(`/api/books/${bookId}/epub-metadata`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<EpubResponse>;
      })
      .then(setEpubData)
      .catch(() => setFetchFailed(true));
  }, [bookId]);

  const loading = epubData === null && !fetchFailed;
  const unavailable = fetchFailed || (epubData !== null && !epubData.available);
  const failReason =
    epubData !== null && !epubData.available ? (epubData as { reason: string }).reason : null;

  const epub: NullableMetadata | null =
    epubData !== null && epubData.available === true
      ? {
          title: epubData.title,
          author: epubData.author,
          isbn: epubData.isbn,
          publisher: epubData.publisher,
          language: epubData.language,
          publishedDate: epubData.publishedDate,
          description: epubData.description,
        }
      : null;

  return (
    <div>
      <div className="grid grid-cols-[max-content_1fr_1fr] gap-x-4 text-sm">
        <div />
        <div className="pb-2 font-medium text-zinc-400">In library</div>
        <div className="pb-2 font-medium text-zinc-400">From epub</div>

        {ROWS.map(({ label, key }) => {
          const dbVal = db[key] as string | null;
          const epubVal = epub ? (epub[key] as string | null) : null;
          const differs = epub !== null && !valuesMatch(dbVal, epubVal);

          return (
            <Fragment key={key}>
              <div className="py-1 pr-2 font-medium text-zinc-400">{label}</div>
              <div
                className={`py-1 ${dbVal ? "text-zinc-700" : "text-zinc-300"} ${differs ? "rounded bg-amber-50 px-1 text-amber-900" : ""}`}
              >
                {displayValue(dbVal)}
              </div>
              <div className={`py-1 ${differs ? "rounded bg-amber-50 px-1 text-amber-900" : ""}`}>
                {loading ? (
                  <Skeleton />
                ) : unavailable ? (
                  <span className="text-zinc-300">—</span>
                ) : (
                  <span className={epubVal ? "text-zinc-700" : "text-zinc-300"}>
                    {displayValue(epubVal)}
                  </span>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      {unavailable && (
        <p className="mt-2 text-xs italic text-zinc-400">
          Epub metadata unavailable
          {failReason ? ` (${REASON_LABELS[failReason] ?? failReason})` : ""}
        </p>
      )}
    </div>
  );
}
