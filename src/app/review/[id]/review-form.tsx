"use client";

import { useActionState, useState, useEffect, useRef, startTransition } from "react";
import { Check } from "lucide-react";
import { confirmReviewAction, type ConfirmReviewState } from "@/app/actions/confirm-review";
import { cancelReviewAction } from "@/app/actions/cancel-review";
import {
  detectLanguageForDraftAction,
  enrichFieldForDraftAction,
} from "@/app/actions/enrich-field";
import { FieldChatModal } from "@/app/components/field-chat-modal";
import type {
  FieldProposal,
  CoverProposal,
  ConfidenceLevel,
  EnrichableField,
} from "@/lib/enrichment/types";

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

function TextField({
  name,
  label,
  defaultValue,
  proposal,
  required,
  loading,
}: {
  name: string;
  label: string;
  defaultValue: string;
  proposal: FieldProposal<string> | null | undefined;
  required?: boolean;
  loading?: boolean;
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

      {loading && <div className="mt-1.5 h-10 animate-pulse rounded-lg bg-zinc-100" />}

      {!loading && proposal && (
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

      {!loading && !proposal && null}
    </div>
  );
}

export interface ReviewFormProps {
  bookId: string;
  embedded: {
    title: string;
    author: string | null;
    isbn: string | null;
    coverDataUrl: string | null;
  };
}

export function ReviewForm({ bookId, embedded }: ReviewFormProps) {
  const [confirmState, confirmAction, confirmPending] = useActionState<
    ConfirmReviewState,
    FormData
  >(confirmReviewAction, null);
  const [, cancelAction, cancelPending] = useActionState<null, FormData>(cancelReviewAction, null);

  // Start in loading state — the useEffect fires enrichment immediately on mount.
  // No synchronous setState happens inside the effect body; all updates are after await.
  const [fieldStates, setFieldStates] = useState<Record<EnrichableField, FieldSlotState>>(() =>
    makeStates("loading")
  );
  const [languageStatus, setLanguageStatus] = useState<"idle" | "loading" | "done" | "error">(
    "loading"
  );
  const [detectedLang, setDetectedLang] = useState("English");
  const [retryingField, setRetryingField] = useState<EnrichableField | null>(null);

  const [coverSrc, setCoverSrc] = useState<string | null>(embedded.coverDataUrl ?? null);
  const [coverChoice, setCoverChoice] = useState(embedded.coverDataUrl ? "embedded" : "");
  const [coverOpen, setCoverOpen] = useState(false);

  const enrichedRef = useRef(false);

  useEffect(() => {
    if (enrichedRef.current) return;
    enrichedRef.current = true;

    async function run() {
      const langResult = await detectLanguageForDraftAction(bookId);
      const language = langResult.ok ? langResult.language : "English";
      setDetectedLang(language);
      setLanguageStatus(langResult.ok ? "done" : "error");

      ENRICHABLE_FIELDS.forEach((field) => {
        startTransition(async () => {
          const result = await enrichFieldForDraftAction(bookId, field, language);
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

          // Auto-select AI cover when no embedded cover and user hasn't picked one
          if (field === "cover" && result.ok && result.proposal && !embedded.coverDataUrl) {
            const cp = result.proposal as CoverProposal;
            if (cp.primary) {
              setCoverSrc(cp.primary);
              setCoverChoice(`ai:${cp.primary}`);
            }
          }
        });
      });
    }

    run();
    // bookId and embedded.coverDataUrl are stable for the lifetime of this component
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coverState = fieldStates.cover;
  const coverProposal =
    coverState.status === "done" && coverState.proposal
      ? (coverState.proposal as CoverProposal)
      : null;
  const allCoverUrls = coverProposal?.urls ?? [];

  function selectCover(src: string, choice: string) {
    setCoverSrc(src);
    setCoverChoice(choice);
  }

  return (
    <div className="space-y-6">
      {languageStatus === "loading" && <p className="text-xs text-zinc-400">Detecting language…</p>}
      {languageStatus === "error" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          AI enrichment unavailable — fill in fields manually.
        </p>
      )}

      <form action={confirmAction} className="space-y-5">
        <input type="hidden" name="bookId" value={bookId} />
        <input type="hidden" name="coverChoice" value={coverChoice} />

        {/* Cover */}
        {coverState.status === "loading" && (
          <div className="space-y-2">
            <div className="flex justify-center">
              {coverSrc ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={coverSrc}
                  alt="Cover"
                  className="h-44 rounded-lg border border-zinc-200 object-contain shadow-sm"
                />
              ) : (
                <div className="h-44 w-32 animate-pulse rounded-lg bg-zinc-100" />
              )}
            </div>
          </div>
        )}

        {coverState.status !== "loading" && (
          <>
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

                {coverProposal && (
                  <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-500">
                    <span>{coverProposal.provenance}</span>
                    <ConfidenceChip level={coverProposal.confidence} />
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
                {coverProposal && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{coverProposal.provenance}</span>
                    <ConfidenceChip level={coverProposal.confidence} />
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
          </>
        )}

        {/* Retry button for cover */}
        {coverState.status === "done" && (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={retryingField !== null}
              onClick={() => setRetryingField("cover")}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
            >
              Retry cover
            </button>
          </div>
        )}

        <div>
          <div className="flex justify-end">
            {fieldStates.title.status === "done" && (
              <button
                type="button"
                disabled={retryingField !== null}
                onClick={() => setRetryingField("title")}
                className="mb-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
              >
                Retry
              </button>
            )}
          </div>
          <TextField
            name="title"
            label="Title"
            defaultValue={embedded.title}
            proposal={
              fieldStates.title.status === "done"
                ? (fieldStates.title.proposal as FieldProposal<string> | null)
                : undefined
            }
            loading={fieldStates.title.status === "loading"}
            required
          />
          {fieldStates.title.status === "error" && (
            <p className="mt-1 text-xs text-red-600">{fieldStates.title.error}</p>
          )}
        </div>

        <div>
          <div className="flex justify-end">
            {fieldStates.author.status === "done" && (
              <button
                type="button"
                disabled={retryingField !== null}
                onClick={() => setRetryingField("author")}
                className="mb-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
              >
                Retry
              </button>
            )}
          </div>
          <TextField
            name="author"
            label="Author"
            defaultValue={embedded.author ?? ""}
            proposal={
              fieldStates.author.status === "done"
                ? (fieldStates.author.proposal as FieldProposal<string> | null)
                : undefined
            }
            loading={fieldStates.author.status === "loading"}
          />
          {fieldStates.author.status === "error" && (
            <p className="mt-1 text-xs text-red-600">{fieldStates.author.error}</p>
          )}
        </div>

        <div>
          <div className="flex justify-end">
            {fieldStates.isbn.status === "done" && (
              <button
                type="button"
                disabled={retryingField !== null}
                onClick={() => setRetryingField("isbn")}
                className="mb-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
              >
                Retry
              </button>
            )}
          </div>
          <TextField
            name="isbn"
            label="ISBN"
            defaultValue={embedded.isbn ?? ""}
            proposal={
              fieldStates.isbn.status === "done"
                ? (fieldStates.isbn.proposal as FieldProposal<string> | null)
                : undefined
            }
            loading={fieldStates.isbn.status === "loading"}
          />
          {fieldStates.isbn.status === "error" && (
            <p className="mt-1 text-xs text-red-600">{fieldStates.isbn.error}</p>
          )}
        </div>

        <div className="text-xs text-zinc-400">
          Series, part, publisher, language, and description are available after import via the
          enrich panel.
        </div>

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

      {retryingField && (
        <FieldChatModal
          field={retryingField}
          label={FIELD_LABELS[retryingField]}
          sourceId={bookId}
          isDraft={true}
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
