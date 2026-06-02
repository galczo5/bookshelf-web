import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ImportDropzone } from "@/app/components/import-dropzone";
import { ImportButton } from "@/app/components/import-button";
import { LibraryView } from "@/app/components/library-view";
import { getUserIdByEmail } from "@/lib/users";
import { listConfirmedBooks } from "@/lib/books";
import { listUserTags } from "@/lib/tags";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tags?: string | string[]; q?: string; view?: string; untagged?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const { error } = await searchParams;
  const userId = await getUserIdByEmail(session.user.email);

  const [books, tags] = await Promise.all([
    listConfirmedBooks(userId),
    listUserTags(userId),
  ]);

  const hasBooks = books.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      {error === "enrichment_failed" && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          AI enrichment failed. Please try again.
        </div>
      )}

      {hasBooks ? (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900">Library</h2>
            <ImportButton />
          </div>
          <LibraryView books={books} tags={tags} />
        </div>
      ) : (
        <div className="mx-auto max-w-md pt-8">
          <ImportDropzone />
        </div>
      )}
    </main>
  );
}
