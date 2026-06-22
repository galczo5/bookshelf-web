import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUserIdByEmail } from "@/lib/users";
import { listTrashedBooks } from "@/lib/books";
import { CoverPlaceholder } from "@/app/components/cover-placeholder";
import RestoreBookControl from "./restore-book-control";

export default async function TrashPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const userId = await getUserIdByEmail(session.user.email);
  const books = await listTrashedBooks(userId);

  return (
    <main className="w-full px-6 py-6">
      <h2 className="mb-6 text-lg font-semibold text-zinc-900">Trash</h2>

      {books.length === 0 ? (
        <p className="text-sm text-zinc-400">No books in trash.</p>
      ) : (
        <div className="space-y-3">
          {books.map((book) => (
            <div
              key={book.id}
              className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4"
            >
              <div className="h-14 w-10 flex-shrink-0 overflow-hidden rounded shadow-sm">
                {book.hasCover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/books/${book.id}/cover`}
                    alt={book.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <CoverPlaceholder title={book.title} className="h-full w-full" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/books/${book.id}`}
                  className="font-medium text-zinc-900 hover:text-zinc-600"
                >
                  {book.title}
                </Link>
                {book.author && <p className="text-sm text-zinc-500">{book.author}</p>}
                <p className="text-xs text-zinc-400">
                  Trashed {book.trashedAt.toLocaleDateString()}
                </p>
              </div>

              <RestoreBookControl bookId={book.id} title={book.title} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
