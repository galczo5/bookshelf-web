"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { confirmReviewAction, type ConfirmReviewState } from "@/app/actions/confirm-review";
import { cancelReviewAction } from "@/app/actions/cancel-review";
import type { EnrichmentProposals, FieldProposal, ConfidenceLevel } from "@/lib/enrichment/types";

export interface ReviewFormProps {
  bookId: string;
  embedded: {
    title: string;
    author: string | null;
    isbn: string | null;
    coverDataUrl: string | null;
  };
  proposals: EnrichmentProposals | null;
}

function ConfidenceChip({ level }: { level: ConfidenceLevel }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        level === "high"
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-amber-50 text-amber-700 ring-amber-200"
      }`}
    >
      {level === "high" ? "High confidence" : "Low confidence"}
    </span>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  proposal,
  required,
}: {
  name: string;
  label: string;
  defaultValue: string;
  proposal: FieldProposal<string> | null | undefined;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [showAlts, setShowAlts] = useState(false);

  const isAccepted = proposal != null && proposal.value !== "" && value === proposal.value;
  const canApply = proposal != null && proposal.value !== "" && !isAccepted;

  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-zinc-700">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>

      <input
        type="text"
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-offset-0 ${
          proposal
            ? "border-blue-200 bg-white focus:border-blue-400 focus:ring-blue-100"
            : "border-zinc-300 bg-white focus:border-zinc-400 focus:ring-zinc-100"
        }`}
      />

      {proposal && (
        <div className="mt-1.5 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {isAccepted ? (
                <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
                  <Check className="size-3.5 shrink-0" />
                  AI suggestion applied
                </div>
              ) : (
                <p className="line-clamp-2 text-xs font-medium leading-snug text-zinc-800">
                  {proposal.value}
                </p>
              )}
              <p className="mt-0.5 text-xs leading-snug text-zinc-500">{proposal.provenance}</p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ConfidenceChip level={proposal.confidence} />
              {canApply && (
                <button
                  type="button"
                  onClick={() => setValue(proposal.value)}
                  className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800"
                >
                  Accept
                </button>
              )}
            </div>
          </div>

          {proposal.alternatives.length > 0 && (
            <div className="mt-2 border-t border-blue-100 pt-2">
              <button
                type="button"
                onClick={() => setShowAlts((o) => !o)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                {showAlts
                  ? "Hide alternatives"
                  : `${proposal.alternatives.length} other option${proposal.alternatives.length > 1 ? "s" : ""}`}
              </button>
              {showAlts && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {proposal.alternatives.map((alt) => (
                    <button
                      key={alt}
                      type="button"
                      onClick={() => setValue(alt)}
                      className="rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-xs text-blue-700 transition-colors hover:bg-blue-50 active:bg-blue-100"
                    >
                      {alt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewForm({ bookId, embedded, proposals }: ReviewFormProps) {
  const [confirmState, confirmAction, confirmPending] = useActionState<
    ConfirmReviewState,
    FormData
  >(confirmReviewAction, null);
  const [, cancelAction, cancelPending] = useActionState<null, FormData>(cancelReviewAction, null);

  const titleDefault = embedded.title || proposals?.title?.value || "";
  const authorDefault = embedded.author ?? proposals?.author?.value ?? "";
  const isbnDefault = embedded.isbn ?? proposals?.isbn?.value ?? "";

  const aiPrimaryUrl = proposals?.cover?.primary ?? null;
  const initialCoverSrc = embedded.coverDataUrl ?? aiPrimaryUrl;
  const initialCoverChoice = embedded.coverDataUrl
    ? "embedded"
    : aiPrimaryUrl
      ? `ai:${aiPrimaryUrl}`
      : "";

  const [coverSrc, setCoverSrc] = useState<string | null>(initialCoverSrc);
  const [coverChoice, setCoverChoice] = useState(initialCoverChoice);
  const [coverOpen, setCoverOpen] = useState(false);

  const allCoverUrls: string[] = proposals?.cover?.urls ?? [];

  function selectCover(src: string, choice: string) {
    setCoverSrc(src);
    setCoverChoice(choice);
  }

  return (
    <div className="space-y-6">
      <form action={confirmAction} className="space-y-5">
        <input type="hidden" name="bookId" value={bookId} />
        <input type="hidden" name="coverChoice" value={coverChoice} />

        {coverSrc && (
          <div className="space-y-2">
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverSrc}
                alt="Cover"
                className="h-44 rounded-lg border border-zinc-200 object-contain shadow-sm"
              />
            </div>

            {proposals?.cover && (
              <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-500">
                <span>{proposals.cover.provenance}</span>
                <ConfidenceChip level={proposals.cover.confidence} />
              </div>
            )}

            {(embedded.coverDataUrl || allCoverUrls.length > 0) && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setCoverOpen((o) => !o)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {coverOpen ? "Hide cover options" : "Show cover options"}
                </button>
                {coverOpen && (
                  <div className="mt-2 flex flex-wrap justify-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                    {embedded.coverDataUrl && (
                      <button
                        type="button"
                        onClick={() => selectCover(embedded.coverDataUrl!, "embedded")}
                        className={`overflow-hidden rounded-lg transition-all ${
                          coverChoice === "embedded"
                            ? "ring-2 ring-blue-500 ring-offset-1"
                            : "ring-1 ring-zinc-200 hover:ring-2 hover:ring-zinc-300 hover:ring-offset-1"
                        }`}
                        title="Embedded cover"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={embedded.coverDataUrl}
                          alt="Embedded cover"
                          className="h-20 w-14 object-contain"
                        />
                      </button>
                    )}
                    {allCoverUrls.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => selectCover(url, `ai:${url}`)}
                        className={`overflow-hidden rounded-lg transition-all ${
                          coverChoice === `ai:${url}`
                            ? "ring-2 ring-blue-500 ring-offset-1"
                            : "ring-1 ring-zinc-200 hover:ring-2 hover:ring-zinc-300 hover:ring-offset-1"
                        }`}
                        title={url}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt="AI proposed cover"
                          className="h-20 w-14 object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!coverSrc && allCoverUrls.length > 0 && (
          <div className="space-y-2">
            {proposals?.cover && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>{proposals.cover.provenance}</span>
                <ConfidenceChip level={proposals.cover.confidence} />
              </div>
            )}
            <div className="flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              {allCoverUrls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => selectCover(url, `ai:${url}`)}
                  className={`overflow-hidden rounded-lg transition-all ${
                    coverChoice === `ai:${url}`
                      ? "ring-2 ring-blue-500 ring-offset-1"
                      : "ring-1 ring-zinc-200 hover:ring-2 hover:ring-zinc-300 hover:ring-offset-1"
                  }`}
                  title={url}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="AI proposed cover"
                    className="h-20 w-14 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        <TextField
          name="title"
          label="Title"
          defaultValue={titleDefault}
          proposal={proposals?.title}
          required
        />

        <TextField
          name="author"
          label="Author"
          defaultValue={authorDefault}
          proposal={proposals?.author}
        />

        <TextField name="isbn" label="ISBN" defaultValue={isbnDefault} proposal={proposals?.isbn} />

        {confirmState?.ok === false && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {confirmState.message}
          </div>
        )}

        <button
          type="submit"
          disabled={confirmPending || cancelPending}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50"
        >
          {confirmPending ? "Saving…" : "Save & import"}
        </button>
      </form>

      <form action={cancelAction}>
        <input type="hidden" name="bookId" value={bookId} />
        <button
          type="submit"
          disabled={confirmPending || cancelPending}
          className="w-full rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </form>
    </div>
  );
}
