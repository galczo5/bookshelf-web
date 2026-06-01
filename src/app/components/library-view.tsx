"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookCard } from "@/app/components/book-card";
import { applyTagsToBooksAction } from "@/app/actions/tags";
import type { BookSummary } from "@/lib/books";
import type { Tag } from "@/lib/tags";

export function LibraryView({
  books,
  tags,
}: {
  books: BookSummary[];
  tags: Tag[];
}): React.JSX.Element {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkInput, setBulkInput] = useState("");
  const [bulkSuggestions, setBulkSuggestions] = useState<Tag[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  function toggleSelectionMode() {
    setSelectionMode((prev) => {
      if (prev) {
        setSelected(new Set());
        setBulkInput("");
        setBulkError(null);
      }
      return !prev;
    });
  }

  function toggleSelect(bookId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }

  function handleBulkInputChange(value: string) {
    setBulkInput(value);
    if (value.trim()) {
      setBulkSuggestions(
        tags.filter((t) => t.name.toLowerCase().includes(value.toLowerCase()))
      );
    } else {
      setBulkSuggestions([]);
    }
  }

  function handleBulkApply(tagName?: string) {
    const name = (tagName ?? bulkInput).trim();
    if (!name) {
      setBulkError("Enter a tag name.");
      return;
    }
    setBulkError(null);
    setBulkSuggestions([]);
    const formData = new FormData();
    formData.set("bookIds", [...selected].join(","));
    formData.set("tagNames", name);

    startTransition(async () => {
      const result = await applyTagsToBooksAction({ ok: true }, formData);
      if (!result.ok) {
        setBulkError(result.message ?? "Failed to apply tag.");
        return;
      }
      router.refresh();
      setBulkInput("");
      setSelected(new Set());
      setSelectionMode(false);
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
        <button
          type="button"
          onClick={toggleSelectionMode}
          className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
            selectionMode
              ? "border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100"
              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          {selectionMode ? "Cancel" : "Select"}
        </button>
      </div>

      {selectionMode && selected.size > 0 && (
        <div className="relative rounded-xl border border-blue-200 bg-blue-50 p-3">
          <p className="mb-2 text-sm font-medium text-blue-800">
            {selected.size} book{selected.size !== 1 ? "s" : ""} selected — add a tag:
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={bulkInput}
                onChange={(e) => handleBulkInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleBulkApply();
                  }
                }}
                placeholder="Tag name…"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              {bulkSuggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-md">
                  {bulkSuggestions.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => handleBulkApply(t.name)}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        {t.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleBulkApply()}
              disabled={isPending || !bulkInput.trim()}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {isPending ? "Applying…" : "Apply"}
            </button>
          </div>
          {bulkError && <p className="mt-1.5 text-sm text-red-600">{bulkError}</p>}
        </div>
      )}

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
            <BookCard
              key={b.id}
              book={b}
              variant="grid"
              allUserTags={tags}
              selectionMode={selectionMode}
              selected={selected.has(b.id)}
              onSelectToggle={() => toggleSelect(b.id)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              variant="list"
              allUserTags={tags}
              selectionMode={selectionMode}
              selected={selected.has(b.id)}
              onSelectToggle={() => toggleSelect(b.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
