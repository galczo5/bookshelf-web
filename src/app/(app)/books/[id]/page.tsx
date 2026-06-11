import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { getOwnedBook } from "@/lib/books";
import { listUserTags } from "@/lib/tags";
import { listBookNotes } from "@/lib/notes";
import { CoverPlaceholder } from "@/app/components/cover-placeholder";
import { TagPicker } from "./tag-picker";
import { SuggestionsPanel } from "./suggestions-panel";
import { EnrichMetadataPanel } from "./enrich-metadata-panel";
import { NotesSection, NoteReader } from "./notes-section";
import TrashBookControl from "./trash-book-control";
import RestoreBookControl from "@/app/(app)/trash/restore-book-control";
import { EpubMetadataComparison } from "./epub-metadata-comparison";

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
    <main className="w-full bg-white px-6 py-6">
      {isTrashed && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          This book is in trash.{" "}
          <Link href="/trash" className="underline hover:text-yellow-900">
            Back to trash
          </Link>
        </div>
      )}

      {/* Cover with title/author beside it, trash action */}
      <div className="flex w-full gap-5">
        <div className="aspect-[2/3] w-44 shrink-0 overflow-hidden rounded-xl shadow-md sm:w-56">
          {book.hasCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/books/${book.id}/cover?v=${book.updatedAt.getTime()}`}
              alt={book.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <CoverPlaceholder title={book.title} className="h-full w-full" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div>
            <h2 className="text-2xl font-bold text-zinc-900">{book.title}</h2>
            {book.author && <p className="mt-1 text-zinc-600">{book.author}</p>}
          </div>

          <EpubMetadataComparison
            bookId={book.id}
            db={{
              title: book.title,
              author: book.author,
              isbn: book.isbn,
              publisher: book.publisher,
              language: book.language,
              publishedDate: book.publishedDate,
              description: book.description,
            }}
          />

          <div className="flex items-center gap-2">
            <a
              href={`/api/books/${book.id}/download`}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Download
            </a>
            {isTrashed ? (
              <RestoreBookControl bookId={book.id} title={book.title} />
            ) : (
              <TrashBookControl bookId={book.id} title={book.title} />
            )}
          </div>
        </div>
      </div>

      {/* Tags below cover and title */}
      {isTrashed ? (
        book.tags.length > 0 && (
          <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900">Tags</h2>
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
        )
      ) : (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
          <TagPicker bookId={book.id} initialBookTags={book.tags} allUserTags={allUserTags} />
        </div>
      )}

      {/* AI assistant */}
      {!isTrashed && (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="size-4 text-blue-500" />
            <h2 className="text-lg font-semibold text-zinc-900">AI assistant</h2>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-zinc-800">Suggest tags</h3>
              <p className="mb-3 text-sm text-zinc-500">
                Propose tags for this book based on its title and author.
              </p>
              <SuggestionsPanel bookId={book.id} />
            </div>

            <div className="border-t border-zinc-100 pt-6">
              <h3 className="mb-1 text-sm font-semibold text-zinc-800">Enrich metadata</h3>
              <p className="mb-3 text-sm text-zinc-500">
                Look up the title, author, ISBN, and cover from the web and review proposed updates
                before saving.
              </p>
              <EnrichMetadataPanel
                bookId={book.id}
                current={{
                  title: book.title,
                  author: book.author,
                  isbn: book.isbn,
                  hasCover: book.hasCover,
                  publisher: book.publisher,
                  language: book.language,
                  publishedDate: book.publishedDate,
                  description: book.description,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Notes below */}
      {isTrashed ? (
        notes.length > 0 && (
          <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900">Notes</h2>
            <div className="space-y-4">
              {notes.map((note) => (
                <div key={note.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                  <NoteReader body={note.body} />
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
          <NotesSection bookId={book.id} initialNotes={notes} />
        </div>
      )}
    </main>
  );
}
