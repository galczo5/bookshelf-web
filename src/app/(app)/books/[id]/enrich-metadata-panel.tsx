"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { enrichMetadataAction, applyMetadataAction } from "@/app/actions/enrich-metadata";
import type { EnrichmentProposals, FieldProposal, ConfidenceLevel } from "@/lib/enrichment/types";

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

function MetaField({
  label,
  value,
  onChange,
  proposal,
  required,
  multiLine,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  proposal: FieldProposal<string> | null | undefined;
  required?: boolean;
  multiLine?: boolean;
}) {
  const [showAlts, setShowAlts] = useState(false);
  const isAccepted = proposal != null && proposal.value !== "" && value === proposal.value;
  const canApply = proposal != null && proposal.value !== "" && !isAccepted;

  const inputClass = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-offset-0 ${
    proposal
      ? "border-blue-200 bg-white focus:border-blue-400 focus:ring-blue-100"
      : "border-zinc-300 bg-white focus:border-zinc-400 focus:ring-zinc-100"
  }`;

  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-zinc-700">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>

      {multiLine ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={inputClass}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className={inputClass}
        />
      )}

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
                  onClick={() => onChange(proposal.value)}
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
                      onClick={() => onChange(alt)}
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

export function EnrichMetadataPanel({
  bookId,
  current,
}: {
  bookId: string;
  current: {
    title: string;
    author: string | null;
    isbn: string | null;
    hasCover: boolean;
    publisher: string | null;
    language: string | null;
    publishedDate: string | null;
    description: string | null;
    series: string | null;
    part: string | null;
  };
}): React.JSX.Element {
  const router = useRouter();
  const [proposals, setProposals] = useState<EnrichmentProposals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEnriching, startEnriching] = useTransition();
  const [isApplying, startApplying] = useTransition();

  const [title, setTitle] = useState(current.title);
  const [author, setAuthor] = useState(current.author ?? "");
  const [isbn, setIsbn] = useState(current.isbn ?? "");
  const [publisher, setPublisher] = useState(current.publisher ?? "");
  const [language, setLanguage] = useState(current.language ?? "");
  const [publishedDate, setPublishedDate] = useState(current.publishedDate ?? "");
  const [description, setDescription] = useState(current.description ?? "");
  const [series, setSeries] = useState(current.series ?? "");
  const [part, setPart] = useState(current.part ?? "");
  // "keep" leaves the current cover; "ai:<url>" replaces it.
  const [coverChoice, setCoverChoice] = useState("keep");

  const hasAnyProposal =
    !!proposals &&
    (!!proposals.title ||
      !!proposals.author ||
      !!proposals.isbn ||
      !!proposals.cover ||
      !!proposals.publisher ||
      !!proposals.language ||
      !!proposals.publishedDate ||
      !!proposals.description);

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
      setPublisher(current.publisher ?? "");
      setLanguage(current.language ?? "");
      setPublishedDate(current.publishedDate ?? "");
      setDescription(current.description ?? "");
      setSeries(current.series ?? "");
      setPart(current.part ?? "");
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
    fd.set("publisher", publisher);
    fd.set("language", language);
    fd.set("publishedDate", publishedDate);
    fd.set("description", description);
    fd.set("series", series);
    fd.set("part", part);
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

  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-500">
        {hasAnyProposal
          ? "Review the proposals below. Edit any field, then apply — nothing is saved until you do."
          : "AI found no changes to suggest — the current metadata looks complete. You can still edit series and part below."}
      </p>

      {proposals.cover && coverUrls.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-700">Cover</p>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{proposals.cover.provenance}</span>
            <ConfidenceChip level={proposals.cover.confidence} />
          </div>
          <div className="flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            {current.hasCover && (
              <button
                type="button"
                onClick={() => setCoverChoice("keep")}
                className={`overflow-hidden rounded-lg transition-all ${
                  coverChoice === "keep"
                    ? "ring-2 ring-blue-500 ring-offset-1"
                    : "ring-1 ring-zinc-200 hover:ring-2 hover:ring-zinc-300 hover:ring-offset-1"
                }`}
                title="Keep current cover"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/books/${bookId}/cover`}
                  alt="Current cover"
                  className="h-20 w-14 object-contain"
                />
              </button>
            )}
            {coverUrls.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => setCoverChoice(`ai:${url}`)}
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

      <MetaField
        label="Title"
        value={title}
        onChange={setTitle}
        proposal={proposals.title}
        required
      />
      <MetaField label="Author" value={author} onChange={setAuthor} proposal={proposals.author} />
      <MetaField label="ISBN" value={isbn} onChange={setIsbn} proposal={proposals.isbn} />
      <MetaField
        label="Publisher"
        value={publisher}
        onChange={setPublisher}
        proposal={proposals.publisher}
      />
      <MetaField
        label="Language"
        value={language}
        onChange={setLanguage}
        proposal={proposals.language}
      />
      <MetaField
        label="Published date"
        value={publishedDate}
        onChange={setPublishedDate}
        proposal={proposals.publishedDate}
      />
      <MetaField
        label="Description"
        value={description}
        onChange={setDescription}
        proposal={proposals.description}
        multiLine
      />
      <MetaField label="Series" value={series} onChange={setSeries} proposal={undefined} />
      <MetaField label="Part" value={part} onChange={setPart} proposal={undefined} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleApply}
          disabled={isPending || !title.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50"
        >
          {isApplying ? "Saving…" : "Apply changes"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={isPending}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
