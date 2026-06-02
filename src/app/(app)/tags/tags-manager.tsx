"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { renameTagAction } from "@/app/actions/tags";
import type { RenameTagActionState } from "@/app/actions/tags";
import type { Tag } from "@/lib/tags";

type TagWithCount = Tag & { bookCount: number };

type PendingMerge = {
  target: { id: string; name: string };
  targetBookCount: number;
  sourceBookCount: number;
};

type MergedNotice = {
  sourceTagId: string;
  target: { id: string; name: string };
  mergedBookCount: number;
};

export function TagsManager({
  initialTags,
}: {
  initialTags: TagWithCount[];
}): React.JSX.Element {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const [mergedNotice, setMergedNotice] = useState<MergedNotice | null>(null);
  const [isPending, startTransition] = useTransition();
  const mergedNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (mergedNoticeTimerRef.current) clearTimeout(mergedNoticeTimerRef.current);
    };
  }, []);

  function startEdit(tag: Tag) {
    setEditingId(tag.id);
    setEditValue(tag.name);
    setError(null);
    setPendingMerge(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setError(null);
    setPendingMerge(null);
  }

  function handleRename(tag: Tag) {
    const newName = editValue.trim();
    if (!newName) {
      setError("Tag name cannot be empty.");
      return;
    }
    if (newName.length > 50) {
      setError("Tag name is too long (50 characters max).");
      return;
    }

    const formData = new FormData();
    formData.set("tagId", tag.id);
    formData.set("newName", newName);
    formData.set("confirmedMerge", pendingMerge ? "1" : "0");

    const initial: RenameTagActionState = { ok: false, kind: "error", message: "" };

    startTransition(async () => {
      setError(null);
      const result = await renameTagAction(initial, formData);

      if (result.ok && result.kind === "renamed") {
        setEditingId(null);
        setPendingMerge(null);
        router.refresh();
        return;
      }

      if (result.ok && result.kind === "merged") {
        if (mergedNoticeTimerRef.current) clearTimeout(mergedNoticeTimerRef.current);
        setMergedNotice({
          sourceTagId: tag.id,
          target: result.target,
          mergedBookCount: result.mergedBookCount,
        });
        setEditingId(null);
        setPendingMerge(null);
        router.refresh();
        mergedNoticeTimerRef.current = setTimeout(() => setMergedNotice(null), 3000);
        return;
      }

      if (!result.ok && result.kind === "needs_confirm") {
        setPendingMerge({
          target: result.target,
          targetBookCount: result.targetBookCount,
          sourceBookCount: result.sourceBookCount,
        });
        setError(null);
        return;
      }

      if (!result.ok && result.kind === "error") {
        setError(result.message);
        return;
      }
    });
  }

  if (initialTags.length === 0 && !mergedNotice) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        No tags yet. Add tags from a book&apos;s detail page or from the library.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {mergedNotice && (
        <li key={`merged-notice-${mergedNotice.sourceTagId}`} className="flex items-center gap-4 py-3">
          <span className="flex-1 text-sm text-green-700">
            Merged into &ldquo;{mergedNotice.target.name}&rdquo; — {mergedNotice.mergedBookCount}{" "}
            {mergedNotice.mergedBookCount === 1 ? "book" : "books"}
          </span>
        </li>
      )}
      {initialTags.map((tag) => (
        <li key={tag.id} className="flex items-center gap-4 py-3">
          {editingId === tag.id ? (
            <div className="flex flex-1 flex-col gap-1">
              {pendingMerge ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editValue}
                      readOnly
                      className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleRename(tag)}
                      disabled={isPending}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      Merge into &ldquo;{pendingMerge.target.name}&rdquo; ({pendingMerge.targetBookCount}{" "}
                      {pendingMerge.targetBookCount === 1 ? "book" : "books"})
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    This tag ({pendingMerge.sourceBookCount}{" "}
                    {pendingMerge.sourceBookCount === 1 ? "book" : "books"}) will be merged into the
                    existing &ldquo;{pendingMerge.target.name}&rdquo; tag.
                  </p>
                </>
              ) : (
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
              )}
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
