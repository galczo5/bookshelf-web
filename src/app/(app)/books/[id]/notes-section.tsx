"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { NoteEditor, type NoteEditorHandle } from "./note-editor";
import { createNoteAction, updateNoteAction, deleteNoteAction } from "@/app/actions/notes";
import type { Note } from "@/lib/notes";

export function NoteReader({ body }: { body: string }) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: body,
    editable: false,
    immediatelyRender: false,
  });
  return (
    <div className="text-sm text-zinc-700 [&_.ProseMirror]:outline-none [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_strong]:font-semibold [&_.ProseMirror_em]:italic">
      <EditorContent editor={editor} />
    </div>
  );
}

export function NotesSection({
  bookId,
  initialNotes,
}: {
  bookId: string;
  initialNotes: Note[];
}): React.JSX.Element {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const editorRef = useRef<NoteEditorHandle>(null);

  const isOpen = editingNote !== null || isCreating;

  function handleClose() {
    setEditingNote(null);
    setIsCreating(false);
    setError(null);
  }

  function handleSave() {
    const body = editorRef.current?.getMarkdown() ?? "";
    if (!body.trim()) {
      setError("Note cannot be empty.");
      return;
    }

    const formData = new FormData();
    formData.set("body", body);

    startTransition(async () => {
      setError(null);
      let result;
      if (editingNote) {
        formData.set("noteId", editingNote.id);
        result = await updateNoteAction({ ok: true }, formData);
      } else {
        formData.set("bookId", bookId);
        result = await createNoteAction({ ok: true }, formData);
      }

      if (!result.ok) {
        setError(result.message ?? "Something went wrong.");
        return;
      }

      handleClose();
      router.refresh();
    });
  }

  function handleDelete(noteId: string) {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    const formData = new FormData();
    formData.set("noteId", noteId);
    startTransition(async () => {
      await deleteNoteAction({ ok: true }, formData);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">Notes</h2>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          + New note
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="py-4 text-sm text-zinc-400">No notes yet.</p>
      ) : (
        <div className="space-y-4">
          {notes.map((note) => (
            <div key={note.id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <NoteReader body={note.body} />
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingNote(note)}
                  className="text-xs text-zinc-500 hover:text-zinc-800"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(note.id)}
                  disabled={isPending}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl focus:outline-none">
            <Dialog.Title className="mb-4 text-base font-semibold text-zinc-900">
              {editingNote ? "Edit note" : "New note"}
            </Dialog.Title>

            {isOpen && <NoteEditor ref={editorRef} initialContent={editingNote?.body ?? ""} />}

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
