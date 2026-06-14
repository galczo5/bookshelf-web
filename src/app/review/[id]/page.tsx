import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { getDraftWithBook } from "@/lib/book-drafts";
import { ReviewForm } from "./review-form";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <div className="flex min-h-screen items-start justify-center bg-zinc-50 pt-20">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900">Review import</h1>
        <p className="mb-6 truncate text-sm text-zinc-500" title={draft.filename}>
          {draft.filename}
        </p>

        <ReviewForm bookId={id} embedded={embedded} />
      </div>
    </div>
  );
}
