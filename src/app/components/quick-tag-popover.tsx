"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { addTagAction } from "@/app/actions/tags";
import type { Tag } from "@/lib/tags";

export function QuickTagPopover({
  bookId,
  allUserTags,
  trigger,
}: {
  bookId: string;
  allUserTags: Tag[];
  trigger: React.ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const suggestions = input
    ? allUserTags.filter((t) => t.name.toLowerCase().includes(input.toLowerCase()))
    : allUserTags.slice(0, 8);

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
      if (!result.ok) {
        setError(result.message ?? "Failed to add tag.");
        return;
      }
      router.refresh();
      setOpen(false);
    });
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-56 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg"
          sideOffset={6}
          align="start"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-2 text-xs font-semibold text-zinc-500">Add tag</p>
          <div className="relative">
            <input
              autoFocus
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd(input);
                }
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Tag name…"
              className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-36 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-md">
                {suggestions.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => handleAdd(t.name)}
                      className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50"
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
            onClick={() => handleAdd(input)}
            disabled={isPending || !input.trim()}
            className="mt-2 w-full rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {isPending ? "Adding…" : "Add"}
          </button>
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
