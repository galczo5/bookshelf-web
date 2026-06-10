"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTagAction, removeTagAction } from "@/app/actions/tags";
import type { Tag } from "@/lib/tags";

export function TagPicker({
  bookId,
  initialBookTags,
  allUserTags,
}: {
  bookId: string;
  initialBookTags: Tag[];
  allUserTags: Tag[];
}): React.JSX.Element {
  const router = useRouter();
  const [bookTags, setBookTags] = useState(initialBookTags);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const suggestions = input
    ? allUserTags.filter(
        (t) =>
          t.name.toLowerCase().includes(input.toLowerCase()) &&
          !bookTags.some((bt) => bt.id === t.id)
      )
    : [];

  function handleAdd(tagName: string) {
    const name = tagName.trim();
    if (!name) return;
    setInput("");
    setError(null);
    const formData = new FormData();
    formData.set("bookId", bookId);
    formData.set("tagName", name);

    startTransition(async () => {
      const result = await addTagAction({ ok: true }, formData);
      if (!result.ok || !result.tag) {
        setError(result.message ?? "Failed to add tag.");
        return;
      }
      setBookTags((prev) =>
        prev.some((t) => t.id === result.tag!.id) ? prev : [...prev, result.tag!]
      );
      router.refresh();
    });
  }

  function handleRemove(tagId: string) {
    setBookTags((prev) => prev.filter((t) => t.id !== tagId));
    const formData = new FormData();
    formData.set("bookId", bookId);
    formData.set("tagId", tagId);
    startTransition(async () => {
      await removeTagAction({ ok: true }, formData);
      router.refresh();
    });
  }

  return (
    <div>
      <h2 className="mb-3 text-base font-semibold text-zinc-900">Tags</h2>

      <div className="flex flex-wrap gap-2">
        {bookTags.map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700"
          >
            <span
              className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: t.color }}
            />
            {t.name}
            <button
              type="button"
              onClick={() => handleRemove(t.id)}
              disabled={isPending}
              className="ml-0.5 text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
              aria-label={`Remove tag ${t.name}`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <div className="relative mt-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd(input);
              }
            }}
            placeholder="Add a tag…"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            type="button"
            onClick={() => handleAdd(input)}
            disabled={isPending || !input.trim()}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-md">
            {suggestions.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => handleAdd(t.name)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  <span
                    className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
