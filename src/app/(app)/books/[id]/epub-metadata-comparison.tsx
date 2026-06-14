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

const COMPACT_ROWS: { label: string; key: keyof DbMetadata }[] = [
  { label: "Title", key: "title" },
  { label: "Author", key: "author" },
  { label: "ISBN", key: "isbn" },
  { label: "Publisher", key: "publisher" },
  { label: "Language", key: "language" },
  { label: "Published", key: "publishedDate" },
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
  return <span className="inline-block h-3.5 w-16 animate-pulse rounded bg-zinc-200" />;
}

export function EpubMetadataComparison({ bookId, db }: Props): React.JSX.Element {
  const [epubData, setEpubData] = useState<EpubResponse | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/books/${bookId}/epub-metadata`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<EpubResponse>;
      })
      .then(setEpubData)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setFetchFailed(true);
      });
    return () => controller.abort();
  }, [bookId]);

  const loading = epubData === null && !fetchFailed;
  const unavailable = fetchFailed || (epubData !== null && !epubData.available);
  const failReason = epubData !== null && !epubData.available ? epubData.reason : null;

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

  const showEpubCol = !unavailable;
  const longDesc = (db.description?.length ?? 0) > 160;

  return (
    <div>
      {showEpubCol && (
        <div className="mb-1 flex gap-4 text-xs font-medium text-zinc-400">
          <div className="w-20 shrink-0" />
          <div className="flex-1">Library</div>
          <div className="flex-1">Epub</div>
        </div>
      )}

      <div className="divide-y divide-zinc-100">
        {COMPACT_ROWS.map(({ label, key }) => {
          const dbVal = db[key] as string | null;
          const epubVal = epub ? (epub[key] as string | null) : null;
          const differs = epub !== null && !valuesMatch(dbVal, epubVal);

          return (
            <Fragment key={key}>
              <div className="flex items-baseline gap-4 py-1.5">
                <span className="w-20 shrink-0 text-xs font-medium text-zinc-400">{label}</span>
                <span
                  className={`flex-1 min-w-0 text-sm ${
                    dbVal
                      ? differs
                        ? "font-medium text-amber-700"
                        : "text-zinc-800"
                      : "text-zinc-300"
                  }`}
                >
                  {displayValue(dbVal)}
                </span>
                {showEpubCol && (
                  <span className="flex-1 min-w-0 text-sm">
                    {loading ? (
                      <Skeleton />
                    ) : (
                      <span
                        className={
                          epubVal
                            ? differs
                              ? "font-medium text-amber-700"
                              : "text-zinc-400"
                            : "text-zinc-300"
                        }
                      >
                        {displayValue(epubVal)}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      {db.description && (
        <div className="mt-2 border-t border-zinc-100 pt-2.5">
          <div className="flex items-start gap-4">
            <span className="w-20 shrink-0 pt-px text-xs font-medium text-zinc-400">
              Description
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm leading-relaxed text-zinc-700 ${descExpanded ? "" : "line-clamp-3"}`}
              >
                {db.description}
              </p>
              {longDesc && (
                <button
                  type="button"
                  onClick={() => setDescExpanded((o) => !o)}
                  className="mt-1 text-xs text-zinc-400 hover:text-zinc-600"
                >
                  {descExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {unavailable && (
        <p className="mt-2 text-xs italic text-zinc-400">
          Epub metadata unavailable
          {failReason ? ` (${REASON_LABELS[failReason] ?? failReason})` : ""}
        </p>
      )}
    </div>
  );
}
