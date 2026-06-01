"use client";

import Link from "next/link";
import { Tag as TagIcon, Check } from "lucide-react";
import { CoverPlaceholder } from "@/app/components/cover-placeholder";
import { QuickTagPopover } from "@/app/components/quick-tag-popover";
import type { BookSummary } from "@/lib/books";
import type { Tag } from "@/lib/tags";

interface BookCardProps {
  book: BookSummary;
  variant: "grid" | "list";
  allUserTags: Tag[];
  selectionMode: boolean;
  selected: boolean;
  onSelectToggle: () => void;
}

export function BookCard({
  book,
  variant,
  allUserTags,
  selectionMode,
  selected,
  onSelectToggle,
}: BookCardProps): React.JSX.Element {
  const coverUrl = `/api/books/${book.id}/cover`;

  if (variant === "grid") {
    if (selectionMode) {
      return (
        <button
          type="button"
          onClick={onSelectToggle}
          className={`group relative flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition-all ${
            selected
              ? "border-blue-500 ring-2 ring-blue-400"
              : "border-zinc-200 hover:border-blue-300"
          }`}
        >
          <div className="aspect-[2/3] w-full overflow-hidden bg-zinc-100">
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
          {selected && (
            <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-white shadow">
              <Check size={14} strokeWidth={3} />
            </div>
          )}
          <div className="flex flex-col gap-0.5 p-3">
            <p className="line-clamp-2 text-sm font-semibold leading-tight text-zinc-900">
              {book.title}
            </p>
            {book.author && (
              <p className="line-clamp-1 text-xs text-zinc-500">{book.author}</p>
            )}
          </div>
        </button>
      );
    }

    return (
      <div className="group relative flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md">
        <Link href={`/books/${book.id}`} className="flex flex-col">
          <div className="aspect-[2/3] w-full overflow-hidden bg-zinc-100">
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
          <div className="flex flex-col gap-0.5 p-3">
            <p className="line-clamp-2 text-sm font-semibold leading-tight text-zinc-900 group-hover:text-blue-600">
              {book.title}
            </p>
            {book.author && (
              <p className="line-clamp-1 text-xs text-zinc-500">{book.author}</p>
            )}
          </div>
        </Link>
        <QuickTagPopover
          bookId={book.id}
          allUserTags={allUserTags}
          trigger={
            <button
              type="button"
              aria-label="Add tag"
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-zinc-500 opacity-0 shadow transition-opacity hover:text-blue-600 group-hover:opacity-100"
            >
              <TagIcon size={14} />
            </button>
          }
        />
      </div>
    );
  }

  if (selectionMode) {
    return (
      <button
        type="button"
        onClick={onSelectToggle}
        className={`group flex w-full items-center gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm transition-all ${
          selected
            ? "border-blue-500 ring-2 ring-blue-400"
            : "border-zinc-200 hover:border-blue-300"
        }`}
      >
        <div
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
            selected ? "border-blue-500 bg-blue-500 text-white" : "border-zinc-300"
          }`}
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </div>
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
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {book.title}
          </p>
          {book.author && (
            <p className="truncate text-xs text-zinc-500">{book.author}</p>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="group relative flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
      <Link
        href={`/books/${book.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
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
      <QuickTagPopover
        bookId={book.id}
        allUserTags={allUserTags}
        trigger={
          <button
            type="button"
            aria-label="Add tag"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-blue-600"
          >
            <TagIcon size={15} />
          </button>
        }
      />
    </div>
  );
}
