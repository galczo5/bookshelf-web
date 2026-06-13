"use client";

import { useState, startTransition, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { applyMetadataAction } from "@/app/actions/enrich-metadata";
import { detectLanguageAction, enrichFieldAction } from "@/app/actions/enrich-field";
import { FieldChatModal } from "@/app/components/field-chat-modal";
import type {
  FieldProposal,
  CoverProposal,
  ConfidenceLevel,
  EnrichableField,
} from "@/lib/enrichment/types";

const FIELD_LABELS: Record<EnrichableField, string> = {
  title: "Title",
  author: "Author",
  isbn: "ISBN",
  cover: "Cover",
  publisher: "Publisher",
  language: "Language",
  publishedDate: "Published date",
  description: "Description",
  series: "Series",
  part: "Part",
};

type FieldSlotState = {
  status: "idle" | "loading" | "done" | "error";
  proposal: FieldProposal<string> | CoverProposal | null;
  responseId: string | null;
  error: string | null;
};

const ENRICHABLE_FIELDS: EnrichableField[] = [
  "title",
  "author",
  "isbn",
  "cover",
  "publisher",
  "language",
  "publishedDate",
  "description",
  "series",
  "part",
];

function makeStates(status: FieldSlotState["status"]): Record<EnrichableField, FieldSlotState> {
  return Object.fromEntries(
    ENRICHABLE_FIELDS.map((f) => [f, { status, proposal: null, responseId: null, error: null }])
  ) as Record<EnrichableField, FieldSlotState>;
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

function MetaField({
  label,
  value,
  onChange,
  proposal,
  required,
  multiLine,
  loading,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  proposal: FieldProposal<string> | null | undefined;
  required?: boolean;
  multiLine?: boolean;
  loading?: boolean;
}) {
  const [showAlts, setShowAlts] = useState(false);

  if (loading) {
    return (
      <div>
        <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-zinc-700">
          {label}
          {required && <span className="text-red-400">*</span>}
        </label>
        <div className="h-9 animate-pulse rounded-lg bg-zinc-100" />
      </div>
    );
  }

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
  const [fieldStates, setFieldStates] = useState<Record<EnrichableField, FieldSlotState>>(() =>
    makeStates("idle")
  );
  const [languageStatus, setLanguageStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [isApplying, startApplying] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [detectedLang, setDetectedLang] = useState("English");
  const [retryingField, setRetryingField] = useState<EnrichableField | null>(null);

  const [title, setTitle] = useState(current.title);
  const [author, setAuthor] = useState(current.author ?? "");
  const [isbn, setIsbn] = useState(current.isbn ?? "");
  const [publisher, setPublisher] = useState(current.publisher ?? "");
  const [language, setLanguage] = useState(current.language ?? "");
  const [publishedDate, setPublishedDate] = useState(current.publishedDate ?? "");
  const [description, setDescription] = useState(current.description ?? "");
  const [series, setSeries] = useState(current.series ?? "");
  const [part, setPart] = useState(current.part ?? "");
  const [coverChoice, setCoverChoice] = useState("keep");

  const isActive = languageStatus !== "idle";
  const allDone = ENRICHABLE_FIELDS.every((f) => fieldStates[f].status !== "loading");
  const coverState = fieldStates.cover;
  const coverProposal =
    coverState.status === "done" && coverState.proposal
      ? (coverState.proposal as CoverProposal)
      : null;
  const coverUrls = coverProposal?.urls ?? [];
  const hasAnyProposal = ENRICHABLE_FIELDS.some(
    (f) => f !== "cover" && fieldStates[f].status === "done" && fieldStates[f].proposal !== null
  );

  async function handleEnrich() {
    setLanguageStatus("loading");
    setLanguageError(null);
    setFieldStates(makeStates("loading"));
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

    const langResult = await detectLanguageAction(bookId);
    if (!langResult.ok) {
      setLanguageStatus("error");
      setLanguageError(langResult.message);
      setFieldStates(
        Object.fromEntries(
          ENRICHABLE_FIELDS.map((f) => [
            f,
            { status: "error", proposal: null, responseId: null, error: langResult.message },
          ])
        ) as Record<EnrichableField, FieldSlotState>
      );
      return;
    }

    setLanguageStatus("done");
    const { language: detectedLanguage } = langResult;
    setDetectedLang(detectedLanguage);

    ENRICHABLE_FIELDS.forEach((field) => {
      startTransition(async () => {
        const result = await enrichFieldAction(bookId, field, detectedLanguage);
        setFieldStates((prev) => ({
          ...prev,
          [field]: result.ok
            ? {
                status: "done",
                proposal: result.proposal,
                responseId: result.responseId,
                error: null,
              }
            : { status: "error", proposal: null, responseId: null, error: result.message },
        }));
      });
    });
  }

  function reset() {
    setFieldStates(makeStates("idle"));
    setLanguageStatus("idle");
    setLanguageError(null);
    setApplyError(null);
    setRetryingField(null);
  }

  function handleApply() {
    setApplyError(null);
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
        setApplyError(result?.message ?? "Could not save changes.");
        return;
      }
      reset();
      router.refresh();
    });
  }

  if (!isActive) {
    return (
      <div>
        <button
          type="button"
          onClick={handleEnrich}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          Re-enrich metadata
        </button>
        {languageError && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {languageError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {languageStatus === "loading" && <p className="text-sm text-zinc-500">Detecting language…</p>}
      {languageStatus === "done" && (
        <p className="text-sm text-zinc-500">
          {!allDone
            ? "Enriching fields — proposals will appear as they load."
            : hasAnyProposal
              ? "Review the proposals below. Edit any field, then apply — nothing is saved until you do."
              : "AI found no changes to suggest — the current metadata looks complete. You can still edit series and part below."}
        </p>
      )}

      {/* Cover */}
      {coverState.status === "loading" && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-700">Cover</p>
          <div className="h-20 animate-pulse rounded-xl bg-zinc-100" />
        </div>
      )}
      {coverState.status === "done" && (coverUrls.length > 0 || coverState.proposal === null) && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-700">Cover</p>
            <button
              type="button"
              disabled={retryingField !== null}
              onClick={() => setRetryingField("cover")}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
            >
              Retry
            </button>
          </div>
          {coverProposal ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>{coverProposal.provenance}</span>
                <ConfidenceChip level={coverProposal.confidence} />
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
            </>
          ) : (
            <p className="text-xs text-zinc-500">No cover found.</p>
          )}
        </div>
      )}
      {coverState.status === "error" && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-700">Cover</p>
          <p className="text-xs text-red-600">{coverState.error}</p>
        </div>
      )}

      {(["title", "author", "isbn", "publisher", "language", "publishedDate"] as const).map(
        (field) => {
          const state = fieldStates[field];
          const labelMap: Record<string, string> = {
            title: "Title",
            author: "Author",
            isbn: "ISBN",
            publisher: "Publisher",
            language: "Language",
            publishedDate: "Published date",
          };
          const valueMap: Record<string, string> = {
            title,
            author,
            isbn,
            publisher,
            language,
            publishedDate,
          };
          const setterMap: Record<string, (v: string) => void> = {
            title: setTitle,
            author: setAuthor,
            isbn: setIsbn,
            publisher: setPublisher,
            language: setLanguage,
            publishedDate: setPublishedDate,
          };
          return (
            <div key={field}>
              <div className="mb-1 flex items-center justify-between">
                {state.status === "done" && (
                  <button
                    type="button"
                    disabled={retryingField !== null}
                    onClick={() => setRetryingField(field)}
                    className="ml-auto text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
                  >
                    Retry
                  </button>
                )}
              </div>
              <MetaField
                label={labelMap[field]}
                value={valueMap[field]}
                onChange={setterMap[field]}
                proposal={
                  state.status === "done"
                    ? (state.proposal as FieldProposal<string> | null)
                    : undefined
                }
                loading={state.status === "loading"}
                required={field === "title"}
              />
              {state.status === "error" && (
                <p className="mt-1 text-xs text-red-600">{state.error}</p>
              )}
            </div>
          );
        }
      )}

      <div>
        {fieldStates.description.status === "done" && (
          <div className="mb-1 flex justify-end">
            <button
              type="button"
              disabled={retryingField !== null}
              onClick={() => setRetryingField("description")}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
            >
              Retry
            </button>
          </div>
        )}
        <MetaField
          label="Description"
          value={description}
          onChange={setDescription}
          proposal={
            fieldStates.description.status === "done"
              ? (fieldStates.description.proposal as FieldProposal<string> | null)
              : undefined
          }
          loading={fieldStates.description.status === "loading"}
          multiLine
        />
        {fieldStates.description.status === "error" && (
          <p className="mt-1 text-xs text-red-600">{fieldStates.description.error}</p>
        )}
      </div>

      <div>
        {fieldStates.series.status === "done" && (
          <div className="mb-1 flex justify-end">
            <button
              type="button"
              disabled={retryingField !== null}
              onClick={() => setRetryingField("series")}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
            >
              Retry
            </button>
          </div>
        )}
        <MetaField
          label="Series"
          value={series}
          onChange={setSeries}
          proposal={
            fieldStates.series.status === "done"
              ? (fieldStates.series.proposal as FieldProposal<string> | null)
              : undefined
          }
          loading={fieldStates.series.status === "loading"}
        />
        {fieldStates.series.status === "error" && (
          <p className="mt-1 text-xs text-red-600">{fieldStates.series.error}</p>
        )}
      </div>

      <div>
        {fieldStates.part.status === "done" && (
          <div className="mb-1 flex justify-end">
            <button
              type="button"
              disabled={retryingField !== null}
              onClick={() => setRetryingField("part")}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
            >
              Retry
            </button>
          </div>
        )}
        <MetaField
          label="Part"
          value={part}
          onChange={setPart}
          proposal={
            fieldStates.part.status === "done"
              ? (fieldStates.part.proposal as FieldProposal<string> | null)
              : undefined
          }
          loading={fieldStates.part.status === "loading"}
        />
        {fieldStates.part.status === "error" && (
          <p className="mt-1 text-xs text-red-600">{fieldStates.part.error}</p>
        )}
      </div>

      {applyError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {applyError}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleApply}
          disabled={isApplying || !title.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50"
        >
          {isApplying ? "Saving…" : "Apply changes"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={isApplying}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>

      {retryingField && (
        <FieldChatModal
          field={retryingField}
          label={FIELD_LABELS[retryingField]}
          sourceId={bookId}
          isDraft={false}
          language={detectedLang}
          currentProposal={fieldStates[retryingField].proposal}
          responseId={fieldStates[retryingField].responseId}
          open={true}
          onClose={() => setRetryingField(null)}
          onApply={(proposal, responseId) => {
            setFieldStates((prev) => ({
              ...prev,
              [retryingField]: { status: "done", proposal, responseId, error: null },
            }));
            setRetryingField(null);
          }}
        />
      )}
    </div>
  );
}
