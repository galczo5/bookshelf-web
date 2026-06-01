"use client";

import { useActionState, useState } from "react";
import {
  confirmReviewAction,
  type ConfirmReviewState,
} from "@/app/actions/confirm-review";
import { cancelReviewAction } from "@/app/actions/cancel-review";
import type { EnrichmentProposals, FieldProposal } from "@/lib/enrichment/types";

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

function ConfidenceChip({ level }: { level: "high" | "low" }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
        level === "high"
          ? "bg-green-100 text-green-700"
          : "bg-amber-100 text-amber-700"
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
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-1">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{label}</span>
        <input
          type="text"
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required={required}
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
        />
      </label>

      {proposal && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span>{proposal.provenance}</span>
          <ConfidenceChip level={proposal.confidence} />
        </div>
      )}

      {proposal && proposal.alternatives.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs text-blue-600 hover:underline"
          >
            {open ? "Hide alternatives" : "Show other options"}
          </button>
          {open && (
            <ul className="mt-1 space-y-1 rounded border border-zinc-200 bg-zinc-50 p-2">
              {proposal.alternatives.map((alt) => (
                <li key={alt}>
                  <button
                    type="button"
                    onClick={() => setValue(alt)}
                    className="w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-200"
                  >
                    {alt}
                  </button>
                </li>
              ))}
            </ul>
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
  const [, cancelAction, cancelPending] = useActionState<null, FormData>(
    cancelReviewAction,
    null
  );

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
      <form action={confirmAction} className="space-y-4">
        <input type="hidden" name="bookId" value={bookId} />
        <input type="hidden" name="coverChoice" value={coverChoice} />

        {coverSrc && (
          <div className="space-y-2">
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverSrc}
                alt="Cover"
                className="h-40 rounded border border-zinc-200 object-contain"
              />
            </div>

            {proposals?.cover && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>{proposals.cover.provenance}</span>
                <ConfidenceChip level={proposals.cover.confidence} />
              </div>
            )}

            {(embedded.coverDataUrl || allCoverUrls.length > 0) && (
              <div>
                <button
                  type="button"
                  onClick={() => setCoverOpen((o) => !o)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {coverOpen ? "Hide cover options" : "Show cover options"}
                </button>
                {coverOpen && (
                  <div className="mt-2 flex flex-wrap gap-2 rounded border border-zinc-200 bg-zinc-50 p-2">
                    {embedded.coverDataUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          selectCover(embedded.coverDataUrl!, "embedded")
                        }
                        className={`rounded border p-0.5 ${
                          coverChoice === "embedded"
                            ? "border-blue-500"
                            : "border-zinc-200"
                        }`}
                        title="Embedded cover"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={embedded.coverDataUrl}
                          alt="Embedded cover"
                          className="h-16 w-12 object-contain"
                        />
                      </button>
                    )}
                    {allCoverUrls.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => selectCover(url, `ai:${url}`)}
                        className={`rounded border p-0.5 ${
                          coverChoice === `ai:${url}`
                            ? "border-blue-500"
                            : "border-zinc-200"
                        }`}
                        title={url}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt="AI proposed cover"
                          className="h-16 w-12 object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
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
            <p className="text-xs text-zinc-500">
              {proposals?.cover?.provenance}{" "}
              {proposals?.cover && (
                <ConfidenceChip level={proposals.cover.confidence} />
              )}
            </p>
            <div className="flex flex-wrap gap-2 rounded border border-zinc-200 bg-zinc-50 p-2">
              {allCoverUrls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => selectCover(url, `ai:${url}`)}
                  className={`rounded border p-0.5 ${
                    coverChoice === `ai:${url}`
                      ? "border-blue-500"
                      : "border-zinc-200"
                  }`}
                  title={url}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="AI proposed cover"
                    className="h-16 w-12 object-contain"
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

        <TextField
          name="isbn"
          label="ISBN"
          defaultValue={isbnDefault}
          proposal={proposals?.isbn}
        />

        {confirmState?.ok === false && (
          <p className="text-sm text-red-600">{confirmState.message}</p>
        )}

        <button
          type="submit"
          disabled={confirmPending || cancelPending}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {confirmPending ? "Saving…" : "Save & import"}
        </button>
      </form>

      <form action={cancelAction}>
        <input type="hidden" name="bookId" value={bookId} />
        <button
          type="submit"
          disabled={confirmPending || cancelPending}
          className="w-full rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </form>
    </div>
  );
}
