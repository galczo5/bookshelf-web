"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { suggestTagsAction } from "@/app/actions/tag-suggestions";
import { addTagAction } from "@/app/actions/tags";
import type { TagProposal } from "@/lib/tag-suggestions/types";

export function SuggestionsPanel({ bookId }: { bookId: string }): React.JSX.Element {
  const router = useRouter();
  const [proposals, setProposals] = useState<TagProposal[] | null>(null);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isSuggesting, startSuggesting] = useTransition();
  const [isApplying, startApplying] = useTransition();

  function handleSuggest() {
    setError(null);
    const formData = new FormData();
    formData.set("bookId", bookId);

    startSuggesting(async () => {
      const result = await suggestTagsAction({ ok: false }, formData);
      if (!result.ok || !result.proposals) {
        setError(result.message ?? "Could not get suggestions.");
        return;
      }
      setProposals(result.proposals);
      setSelectedNames(new Set(result.proposals.map((p) => p.name)));
    });
  }

  function toggleName(name: string) {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function handleApply() {
    if (!proposals) return;
    const toApply = proposals.filter((p) => selectedNames.has(p.name));
    if (toApply.length === 0) return;

    setError(null);

    startApplying(async () => {
      const results = await Promise.all(
        toApply.map((p) => {
          const fd = new FormData();
          fd.set("bookId", bookId);
          fd.set("tagName", p.name);
          return addTagAction({ ok: true }, fd);
        })
      );

      const failed = results.find((r) => !r.ok);
      if (failed) {
        setError(failed.message ?? "Failed to apply some tags.");
        return;
      }

      setProposals(null);
      setSelectedNames(new Set());
      router.refresh();
    });
  }

  const isPending = isSuggesting || isApplying;

  return (
    <div className="mt-4">
      {!proposals && (
        <button
          type="button"
          onClick={handleSuggest}
          disabled={isPending}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {isSuggesting ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-700" />
              Suggesting…
            </>
          ) : (
            "Suggest tags"
          )}
        </button>
      )}

      {proposals && (
        <div>
          <p className="mb-2 text-sm font-medium text-zinc-700">
            Suggested tags — toggle to select, then apply:
          </p>

          <div className="flex flex-wrap gap-2">
            {proposals.map((p) => {
              const selected = selectedNames.has(p.name);
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => toggleName(p.name)}
                  title={p.provenance}
                  className={[
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                    selected
                      ? "border-blue-400 bg-blue-50 text-blue-800"
                      : "border-zinc-200 bg-white text-zinc-400",
                  ].join(" ")}
                >
                  {p.name}
                  {p.isNew && (
                    <span className="rounded bg-zinc-200 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      new
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={isPending || selectedNames.size === 0}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isApplying ? "Applying…" : `Apply selected (${selectedNames.size})`}
            </button>
            <button
              type="button"
              onClick={() => {
                setProposals(null);
                setSelectedNames(new Set());
                setError(null);
              }}
              disabled={isPending}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
