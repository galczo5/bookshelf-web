"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { enrichFieldAction, enrichFieldForDraftAction } from "@/app/actions/enrich-field";
import type { FieldProposal, CoverProposal, EnrichableField } from "@/lib/enrichment/types";

type Turn = { role: "user" | "assistant"; content: string };

function proposalToContent(proposal: FieldProposal<string> | CoverProposal | null): string {
  if (!proposal) return "(no proposal returned)";
  if ("value" in proposal) {
    return proposal.value
      ? `${proposal.value}\n${proposal.provenance}`
      : `(empty)\n${proposal.provenance}`;
  }
  return proposal.primary
    ? `${proposal.primary}\n${proposal.provenance}`
    : `(no cover URL)\n${proposal.provenance}`;
}

export function FieldChatModal({
  field,
  label,
  sourceId,
  isDraft,
  language,
  currentProposal,
  responseId,
  open,
  onClose,
  onApply,
}: {
  field: EnrichableField;
  label: string;
  sourceId: string;
  isDraft: boolean;
  language: string;
  currentProposal: FieldProposal<string> | CoverProposal | null;
  responseId: string | null;
  open: boolean;
  onClose: () => void;
  onApply: (proposal: FieldProposal<string> | CoverProposal | null, responseId: string) => void;
}) {
  // Component remounts for each new retryingField, so prop-based initializers are safe here.
  const [turns, setTurns] = useState<Turn[]>([
    { role: "assistant", content: proposalToContent(currentProposal) },
  ]);
  const [localResponseId, setLocalResponseId] = useState<string | null>(responseId);
  const [latestProposal, setLatestProposal] = useState<
    FieldProposal<string> | CoverProposal | null
  >(currentProposal);
  const [inputValue, setInputValue] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isPending]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const msg = inputValue.trim();
    if (!msg || isPending) return;

    setInputValue("");
    setIsPending(true);
    setError(null);
    setTurns((prev) => [...prev, { role: "user", content: msg }]);

    const action = isDraft ? enrichFieldForDraftAction : enrichFieldAction;
    const result = await action(sourceId, field, language, localResponseId ?? undefined, msg);

    if (result.ok) {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: proposalToContent(result.proposal) },
      ]);
      setLocalResponseId(result.responseId);
      setLatestProposal(result.proposal);
    } else {
      setTurns((prev) => [...prev, { role: "assistant", content: `Error: ${result.message}` }]);
      setError(result.message);
    }

    setIsPending(false);
  }

  function handleApply() {
    if (latestProposal !== null && localResponseId !== null) {
      onApply(latestProposal, localResponseId);
    }
  }

  const canApply = latestProposal !== null && localResponseId !== null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-zinc-200 bg-white shadow-xl focus:outline-none">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-6 py-4">
            <Dialog.Title className="text-base font-semibold text-zinc-900">
              Retry: {label}
            </Dialog.Title>
            <Dialog.Close
              disabled={isPending}
              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40"
              onClick={onClose}
            >
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {turns.map((turn, i) => (
              <div key={i} className={turn.role === "user" ? "flex justify-end" : "flex"}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    turn.role === "user" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-800"
                  }`}
                >
                  {turn.content}
                </div>
              </div>
            ))}
            {isPending && (
              <div className="flex">
                <div className="animate-pulse rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-400">
                  Thinking…
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="shrink-0 space-y-3 border-t border-zinc-100 p-4">
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type guidance and press Send…"
                disabled={isPending}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 focus:ring-offset-0 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isPending || !inputValue.trim()}
                className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
              >
                Send
              </button>
            </div>

            <div className="flex items-center justify-between">
              <Dialog.Close
                disabled={isPending}
                onClick={onClose}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40"
              >
                Close
              </Dialog.Close>
              <button
                type="button"
                disabled={!canApply || isPending}
                onClick={handleApply}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
              >
                Apply this suggestion
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
