import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { getDraftWithBook, deleteDraftAndBook, updateProposals } from "@/lib/book-drafts";
import { enrichBook, EnrichmentFailedError } from "@/lib/enrichment/client";
import type { EnrichmentInput } from "@/lib/enrichment/types";
import type { EnrichmentProposals } from "@/lib/enrichment/types";
import { ReviewForm } from "./review-form";

function ReviewFormSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 w-3/4 rounded bg-zinc-200" />
      <div className="h-10 rounded bg-zinc-100" />
      <div className="h-6 w-1/2 rounded bg-zinc-200" />
      <div className="h-10 rounded bg-zinc-100" />
      <div className="h-6 w-1/3 rounded bg-zinc-200" />
      <div className="h-10 rounded bg-zinc-100" />
      <div className="h-10 rounded bg-zinc-200" />
    </div>
  );
}

async function EnrichedReviewForm({
  bookId,
  userId,
  embedded,
  filename,
}: {
  bookId: string;
  userId: string;
  embedded: {
    title: string;
    author: string | null;
    isbn: string | null;
    coverDataUrl: string | null;
  };
  filename: string;
}) {
  const input: EnrichmentInput = {
    filename,
    embeddedTitle: embedded.title || null,
    embeddedAuthor: embedded.author,
    embeddedIsbn: embedded.isbn,
    frontMatterStrings: [],
  };

  let proposals: EnrichmentProposals | null = null;
  try {
    proposals = await enrichBook(input);
    await updateProposals(bookId, proposals);
  } catch (err) {
    if (err instanceof EnrichmentFailedError) {
      await deleteDraftAndBook(bookId, userId);
      redirect("/?error=enrichment_failed");
    }
    await deleteDraftAndBook(bookId, userId);
    redirect("/?error=enrichment_failed");
  }

  return (
    <ReviewForm bookId={bookId} embedded={embedded} proposals={proposals} />
  );
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const userId = await getUserIdByEmail(session.user.email);
  const draft = await getDraftWithBook(id, userId);
  if (!draft) redirect("/");

  const coverDataUrl =
    draft.embedded.coverBytes && draft.embedded.coverMime
      ? `data:${draft.embedded.coverMime};base64,${draft.embedded.coverBytes.toString("base64")}`
      : null;

  const embedded = {
    title: draft.embedded.title,
    author: draft.embedded.author,
    isbn: draft.embedded.isbn,
    coverDataUrl,
  };

  const isMissing =
    !draft.embedded.title ||
    !draft.embedded.author ||
    !draft.embedded.isbn ||
    !draft.embedded.coverBytes;

  let formContent: React.ReactNode;

  if (draft.proposals !== null) {
    formContent = (
      <ReviewForm bookId={id} embedded={embedded} proposals={draft.proposals} />
    );
  } else if (!isMissing) {
    formContent = (
      <ReviewForm bookId={id} embedded={embedded} proposals={null} />
    );
  } else {
    formContent = (
      <Suspense fallback={<ReviewFormSkeleton />}>
        <EnrichedReviewForm
          bookId={id}
          userId={userId}
          embedded={embedded}
          filename={draft.filename}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-zinc-50 pt-20">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900">Review import</h1>
        <p className="mb-6 truncate text-sm text-zinc-500" title={draft.filename}>
          {draft.filename}
        </p>

        {formContent}
      </div>
    </div>
  );
}
