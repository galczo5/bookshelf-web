import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ImportDropzone } from "@/app/components/import-dropzone";
import { LibraryView } from "@/app/components/library-view";
import { getUserIdByEmail, upsertUserByEmail } from "@/lib/users";
import { listConfirmedBooks } from "@/lib/books";
import { listUserTags } from "@/lib/tags";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    tags?: string | string[];
    q?: string;
    view?: string;
    untagged?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const { error } = await searchParams;
  await upsertUserByEmail(session.user.email);
  const userId = await getUserIdByEmail(session.user.email);

  const [books, tags] = await Promise.all([listConfirmedBooks(userId), listUserTags(userId)]);

  const hasBooks = books.length > 0;

  return (
    <main className="w-full px-6 py-6">
      {error === "enrichment_failed" && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          AI enrichment failed. Please try again.
        </div>
      )}

      {hasBooks ? (
        <LibraryView books={books} tags={tags} />
      ) : (
        <div className="mx-auto max-w-md pt-8">
          <ImportDropzone />
        </div>
      )}
    </main>
  );
}
