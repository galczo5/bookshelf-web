"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameTagAction } from "@/app/actions/tags";
import type { Tag } from "@/lib/tags";

type TagWithCount = Tag & { bookCount: number };

export function TagsManager({
  initialTags,
}: {
  initialTags: TagWithCount[];
}): React.JSX.Element {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEdit(tag: Tag) {
    setEditingId(tag.id);
    setEditValue(tag.name);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setError(null);
  }

  function handleRename(tag: Tag) {
    const newName = editValue.trim();
    if (!newName) {
      setError("Name cannot be empty.");
      return;
    }
    if (newName === tag.name) {
      cancelEdit();
      return;
    }

    const formData = new FormData();
    formData.set("tagId", tag.id);
    formData.set("newName", newName);

    startTransition(async () => {
      setError(null);
      const result = await renameTagAction({ ok: true }, formData);
      if (!result.ok) {
        setError(result.message ?? "Could not rename tag.");
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  if (initialTags.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        No tags yet. Add tags to books from the book detail page.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {initialTags.map((tag) => (
        <li key={tag.id} className="flex items-center gap-4 py-3">
          {editingId === tag.id ? (
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(tag);
                    if (e.key === "Escape") cancelEdit();
                  }}
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button
                  type="button"
                  onClick={() => handleRename(tag)}
                  disabled={isPending}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          ) : (
            <>
              <span className="flex-1 text-sm font-medium text-zinc-900">
                {tag.name}
              </span>
              <span className="text-xs text-zinc-400">
                {tag.bookCount} {tag.bookCount === 1 ? "book" : "books"}
              </span>
              <button
                type="button"
                onClick={() => startEdit(tag)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Rename
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
