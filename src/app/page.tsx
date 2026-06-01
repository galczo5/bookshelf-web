import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ImportDropzone } from "@/app/components/import-dropzone";
import { ImportButton } from "@/app/components/import-button";
import { LibraryView } from "@/app/components/library-view";
import { getUserIdByEmail } from "@/lib/users";
import { listConfirmedBooks } from "@/lib/books";
import { listUserTags } from "@/lib/tags";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
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
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <h1 className="text-lg font-semibold text-zinc-900">Bookshelf</h1>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-zinc-500 sm:inline">
              {session.user.email}
            </span>
            <Link
              href="/tags"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Tags
            </Link>
            {hasBooks && <ImportButton />}
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {error === "enrichment_failed" && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            AI enrichment failed. Please try again.
          </div>
        )}

        {hasBooks ? (
          <LibraryView books={books} tags={tags} />
        ) : (
          <div className="mx-auto max-w-md">
            <ImportDropzone />
          </div>
        )}
      </main>
    </div>
  );
}
