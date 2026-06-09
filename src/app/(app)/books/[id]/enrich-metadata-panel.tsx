"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enrichMetadataAction, applyMetadataAction } from "@/app/actions/enrich-metadata";
import type { EnrichmentProposals, FieldProposal, ConfidenceLevel } from "@/lib/enrichment/types";

function ConfidenceChip({ level }: { level: ConfidenceLevel }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
        level === "high" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {level === "high" ? "High confidence" : "Low confidence"}
    </span>
  );
}

function MetaField({
  label,
  value,
  onChange,
  proposal,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  proposal: FieldProposal<string> | null | undefined;
  required?: boolean;
}) {
  const [showAlts, setShowAlts] = useState(false);
  const suggestion = proposal?.value;
  const canApply = suggestion != null && suggestion !== value;

  return (
    <div className="space-y-1">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{label}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
        />
      </label>

      {proposal && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span>{proposal.provenance}</span>
          <ConfidenceChip level={proposal.confidence} />
          {canApply && (
            <button
              type="button"
              onClick={() => onChange(suggestion!)}
              className="text-blue-600 hover:underline"
            >
              Use “{suggestion}”
            </button>
          )}
        </div>
      )}

      {proposal && proposal.alternatives.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAlts((o) => !o)}
            className="text-xs text-blue-600 hover:underline"
          >
            {showAlts ? "Hide alternatives" : "Show other options"}
          </button>
          {showAlts && (
            <ul className="mt-1 space-y-1 rounded border border-zinc-200 bg-zinc-50 p-2">
              {proposal.alternatives.map((alt) => (
                <li key={alt}>
                  <button
                    type="button"
                    onClick={() => onChange(alt)}
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

export function EnrichMetadataPanel({
  bookId,
  current,
}: {
  bookId: string;
  current: { title: string; author: string | null; isbn: string | null; hasCover: boolean };
}): React.JSX.Element {
  const router = useRouter();
  const [proposals, setProposals] = useState<EnrichmentProposals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEnriching, startEnriching] = useTransition();
  const [isApplying, startApplying] = useTransition();

  const [title, setTitle] = useState(current.title);
  const [author, setAuthor] = useState(current.author ?? "");
  const [isbn, setIsbn] = useState(current.isbn ?? "");
  // "keep" leaves the current cover; "ai:<url>" replaces it.
  const [coverChoice, setCoverChoice] = useState("keep");

  const hasAnyProposal =
    !!proposals &&
    (!!proposals.title || !!proposals.author || !!proposals.isbn || !!proposals.cover);

  function handleEnrich() {
    setError(null);
    const fd = new FormData();
    fd.set("bookId", bookId);
    startEnriching(async () => {
      const result = await enrichMetadataAction({ ok: false }, fd);
      if (!result.ok || !result.proposals) {
        setError(result.message ?? "Enrichment failed.");
        return;
      }
      setProposals(result.proposals);
      setTitle(current.title);
      setAuthor(current.author ?? "");
      setIsbn(current.isbn ?? "");
      setCoverChoice("keep");
    });
  }

  function reset() {
    setProposals(null);
    setError(null);
  }

  function handleApply() {
    setError(null);
    const fd = new FormData();
    fd.set("bookId", bookId);
    fd.set("title", title);
    fd.set("author", author);
    fd.set("isbn", isbn);
    fd.set("coverChoice", coverChoice);
    startApplying(async () => {
      const result = await applyMetadataAction(null, fd);
      if (!result || result.ok === false) {
        setError(result?.message ?? "Could not save changes.");
        return;
      }
      reset();
      router.refresh();
    });
  }

  const coverUrls = proposals?.cover?.urls ?? [];
  const isPending = isEnriching || isApplying;

  if (!proposals) {
    return (
      <div>
        <button
          type="button"
          onClick={handleEnrich}
          disabled={isPending}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {isEnriching ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-700" />
              Looking up metadata…
            </>
          ) : (
            "Re-enrich metadata"
          )}
        </button>
        {error && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!hasAnyProposal) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-600">
          AI found no changes to suggest — the current metadata looks complete.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Review the proposals below. Edit any field, then apply — nothing is saved until you do.
      </p>

      {proposals.cover && coverUrls.length > 0 && (
        <div className="space-y-2">
          <span className="block text-sm font-medium text-zinc-700">Cover</span>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{proposals.cover.provenance}</span>
            <ConfidenceChip level={proposals.cover.confidence} />
          </div>
          <div className="flex flex-wrap gap-2 rounded border border-zinc-200 bg-zinc-50 p-2">
            {current.hasCover && (
              <button
                type="button"
                onClick={() => setCoverChoice("keep")}
                className={`rounded border p-0.5 ${
                  coverChoice === "keep" ? "border-blue-500" : "border-zinc-200"
                }`}
                title="Keep current cover"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/books/${bookId}/cover`}
                  alt="Current cover"
                  className="h-16 w-12 object-contain"
                />
              </button>
            )}
            {coverUrls.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => setCoverChoice(`ai:${url}`)}
                className={`rounded border p-0.5 ${
                  coverChoice === `ai:${url}` ? "border-blue-500" : "border-zinc-200"
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

      <MetaField
        label="Title"
        value={title}
        onChange={setTitle}
        proposal={proposals.title}
        required
      />
      <MetaField label="Author" value={author} onChange={setAuthor} proposal={proposals.author} />
      <MetaField label="ISBN" value={isbn} onChange={setIsbn} proposal={proposals.isbn} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={isPending || !title.trim()}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isApplying ? "Saving…" : "Apply changes"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={isPending}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
