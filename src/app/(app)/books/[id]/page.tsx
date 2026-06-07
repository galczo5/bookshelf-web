import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { getOwnedBook } from "@/lib/books";
import { listUserTags } from "@/lib/tags";
import { listBookNotes } from "@/lib/notes";
import { CoverPlaceholder } from "@/app/components/cover-placeholder";
import { TagPicker } from "./tag-picker";
import { SuggestionsPanel } from "./suggestions-panel";
import { NotesSection, NoteReader } from "./notes-section";
import TrashBookControl from "./trash-book-control";
import RestoreBookControl from "@/app/(app)/trash/restore-book-control";

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const { id } = await params;
  const userId = await getUserIdByEmail(session.user.email);

  const [book, allUserTags, notes] = await Promise.all([
    getOwnedBook(id, userId),
    listUserTags(userId),
    listBookNotes(id, userId),
  ]);

  if (!book) notFound();

  const isTrashed = book.trashedAt != null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 bg-white">
      <Link href="/" className="mb-6 inline-block text-sm text-zinc-500 hover:text-zinc-800">
        ← Library
      </Link>

      {isTrashed && (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          This book is in trash.{" "}
          <Link href="/trash" className="underline hover:text-yellow-900">
            Back to trash
          </Link>
        </div>
      )}

      <div className="mb-8 flex gap-6">
        <div className="h-48 w-32 flex-shrink-0 overflow-hidden rounded-lg shadow-sm">
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
          <h2 className="text-2xl font-bold text-zinc-900">{book.title}</h2>
          {book.author && <p className="mt-1 text-zinc-600">{book.author}</p>}
          {book.isbn && <p className="mt-1 text-sm text-zinc-400">ISBN: {book.isbn}</p>}
        </div>
      </div>

      {isTrashed ? (
        <>
          {book.tags.length > 0 && (
            <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-6">
              <div className="flex flex-wrap gap-2">
                {book.tags.map((t) => (
                  <span
                    key={t.id}
                    className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {notes.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-6">
              <h2 className="mb-4 text-lg font-semibold text-zinc-900">Notes</h2>
              <div className="space-y-4">
                {notes.map((note) => (
                  <div key={note.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                    <NoteReader body={note.body} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-6">
            <TagPicker bookId={book.id} initialBookTags={book.tags} allUserTags={allUserTags} />
            <SuggestionsPanel bookId={book.id} />
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-6">
            <NotesSection bookId={book.id} initialNotes={notes} />
          </div>
        </>
      )}

      <section className="mt-8 flex justify-end">
        {isTrashed ? (
          <RestoreBookControl bookId={book.id} title={book.title} />
        ) : (
          <TrashBookControl bookId={book.id} title={book.title} />
        )}
      </section>
    </main>
  );
}
