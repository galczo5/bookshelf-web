"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { applyMetadataAction } from "@/app/actions/enrich-metadata";

interface Fields {
  title: string;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  language: string | null;
  publishedDate: string | null;
  description: string | null;
  series: string | null;
  part: string | null;
}

function Field({
  label,
  value,
  onChange,
  required,
  multiLine,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  multiLine?: boolean;
}) {
  const cls =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 focus:ring-offset-0";
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
          className={cls}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className={cls}
        />
      )}
    </div>
  );
}

export default function EditMetadataDialog({
  bookId,
  initial,
}: {
  bookId: string;
  initial: Fields;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(initial.title);
  const [author, setAuthor] = useState(initial.author ?? "");
  const [series, setSeries] = useState(initial.series ?? "");
  const [part, setPart] = useState(initial.part ?? "");
  const [isbn, setIsbn] = useState(initial.isbn ?? "");
  const [publisher, setPublisher] = useState(initial.publisher ?? "");
  const [language, setLanguage] = useState(initial.language ?? "");
  const [publishedDate, setPublishedDate] = useState(initial.publishedDate ?? "");
  const [description, setDescription] = useState(initial.description ?? "");

  function handleOpen() {
    setTitle(initial.title);
    setAuthor(initial.author ?? "");
    setSeries(initial.series ?? "");
    setPart(initial.part ?? "");
    setIsbn(initial.isbn ?? "");
    setPublisher(initial.publisher ?? "");
    setLanguage(initial.language ?? "");
    setPublishedDate(initial.publishedDate ?? "");
    setDescription(initial.description ?? "");
    setError(null);
    setOpen(true);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
    setError(null);
  }

  function handleSave() {
    setError(null);
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
    fd.set("coverChoice", "keep");
    startTransition(async () => {
      const result = await applyMetadataAction(null, fd);
      if (!result || result.ok === false) {
        setError(result?.message ?? "Could not save changes.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
      >
        Edit metadata
      </button>

      <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-zinc-200 bg-white shadow-xl focus:outline-none">
            <div className="flex-shrink-0 border-b border-zinc-100 px-6 py-4">
              <Dialog.Title className="text-base font-semibold text-zinc-900">
                Edit metadata
              </Dialog.Title>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-4">
                <Field label="Title" value={title} onChange={setTitle} required />
                <Field label="Author" value={author} onChange={setAuthor} />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Series" value={series} onChange={setSeries} />
                  <Field label="Part" value={part} onChange={setPart} />
                </div>
                <Field label="ISBN" value={isbn} onChange={setIsbn} />
                <Field label="Publisher" value={publisher} onChange={setPublisher} />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Language" value={language} onChange={setLanguage} />
                  <Field label="Published date" value={publishedDate} onChange={setPublishedDate} />
                </div>
                <Field
                  label="Description"
                  value={description}
                  onChange={setDescription}
                  multiLine
                />
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>

            <div className="flex flex-shrink-0 justify-end gap-2 border-t border-zinc-100 px-6 py-4">
              <Dialog.Close
                disabled={isPending}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending || !title.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
