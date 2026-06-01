"use client";

import { useState } from "react";
import { BookCard } from "@/app/components/book-card";
import type { BookSummary } from "@/lib/books";
import type { Tag } from "@/lib/tags";

export function LibraryView({
  books,
  tags,
}: {
  books: BookSummary[];
  tags: Tag[];
}): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"grid" | "list">("grid");

  const q = searchQuery.toLowerCase();
  const filtered = books.filter((b) => {
    const matchesSearch =
      !q ||
      b.title.toLowerCase().includes(q) ||
      (b.author?.toLowerCase().includes(q) ?? false);
    const matchesTags =
      activeTags.size === 0 ||
      [...activeTags].every((tagId) => b.tags.some((t) => t.id === tagId));
    return matchesSearch && matchesTags;
  });

  function toggleTag(id: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search by title or author…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <button
          type="button"
          onClick={() => setView(view === "grid" ? "list" : "grid")}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          aria-label={view === "grid" ? "Switch to list view" : "Switch to grid view"}
        >
          {view === "grid" ? "List" : "Grid"}
        </button>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggleTag(t.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeTags.has(t.id)
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400">
          {books.length === 0 ? "No books yet." : "No books match your filters."}
        </p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((b) => (
            <BookCard key={b.id} book={b} variant="grid" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((b) => (
            <BookCard key={b.id} book={b} variant="list" />
          ))}
        </div>
      )}
    </div>
  );
}
