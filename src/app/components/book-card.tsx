import Link from "next/link";
import { CoverPlaceholder } from "@/app/components/cover-placeholder";
import type { BookSummary } from "@/lib/books";

export function BookCard({
  book,
  variant,
}: {
  book: BookSummary;
  variant: "grid" | "list";
}): React.JSX.Element {
  const coverUrl = `/api/books/${book.id}/cover`;

  if (variant === "grid") {
    return (
      <Link
        href={`/books/${book.id}`}
        className="group flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md"
      >
        <div className="aspect-[2/3] w-full overflow-hidden bg-zinc-100">
          {book.hasCover ? (
            <img
              src={coverUrl}
              alt={book.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <CoverPlaceholder
              title={book.title}
              className="h-full w-full"
            />
          )}
        </div>
        <div className="flex flex-col gap-0.5 p-3">
          <p className="line-clamp-2 text-sm font-semibold leading-tight text-zinc-900 group-hover:text-blue-600">
            {book.title}
          </p>
          {book.author && (
            <p className="line-clamp-1 text-xs text-zinc-500">{book.author}</p>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/books/${book.id}`}
      className="group flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="h-14 w-10 flex-shrink-0 overflow-hidden rounded bg-zinc-100">
        {book.hasCover ? (
          <img
            src={coverUrl}
            alt={book.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <CoverPlaceholder title={book.title} className="h-full w-full" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900 group-hover:text-blue-600">
          {book.title}
        </p>
        {book.author && (
          <p className="truncate text-xs text-zinc-500">{book.author}</p>
        )}
        {book.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {book.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
