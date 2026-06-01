"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { createNote, updateNote, deleteNote } from "@/lib/notes";

export type NoteActionState = { ok: boolean; message?: string };

export async function createNoteAction(
  _prev: NoteActionState,
  formData: FormData
): Promise<NoteActionState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookId = String(formData.get("bookId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!bookId) return { ok: false, message: "Missing book id" };
  if (!body) return { ok: false, message: "Note body cannot be empty" };

  try {
    const userId = await getUserIdByEmail(session.user.email);
    await createNote(bookId, userId, body);
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not create note. Please try again." };
  }
}

export async function updateNoteAction(
  _prev: NoteActionState,
  formData: FormData
): Promise<NoteActionState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const noteId = String(formData.get("noteId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!noteId) return { ok: false, message: "Missing note id" };
  if (!body) return { ok: false, message: "Note body cannot be empty" };

  try {
    const userId = await getUserIdByEmail(session.user.email);
    await updateNote(noteId, userId, body);
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not update note. Please try again." };
  }
}

export async function deleteNoteAction(
  _prev: NoteActionState,
  formData: FormData
): Promise<NoteActionState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const noteId = String(formData.get("noteId") ?? "").trim();

  if (!noteId) return { ok: false, message: "Missing note id" };

  try {
    const userId = await getUserIdByEmail(session.user.email);
    await deleteNote(noteId, userId);
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not delete note. Please try again." };
  }
}
