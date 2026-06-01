"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { addTagToBook, removeTagFromBook, renameTag } from "@/lib/tags";

export type TagActionState = {
  ok: boolean;
  tag?: { id: string; name: string };
  message?: string;
};

export async function addTagAction(
  _prev: TagActionState,
  formData: FormData
): Promise<TagActionState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookId = String(formData.get("bookId") ?? "").trim();
  const tagName = String(formData.get("tagName") ?? "").trim();

  if (!bookId) return { ok: false, message: "Missing book id" };
  if (!tagName) return { ok: false, message: "Tag name cannot be empty" };

  try {
    const userId = await getUserIdByEmail(session.user.email);
    const tag = await addTagToBook(userId, bookId, tagName);
    return { ok: true, tag };
  } catch {
    return { ok: false, message: "Could not add tag. Please try again." };
  }
}

export async function removeTagAction(
  _prev: TagActionState,
  formData: FormData
): Promise<TagActionState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookId = String(formData.get("bookId") ?? "").trim();
  const tagId = String(formData.get("tagId") ?? "").trim();

  if (!bookId) return { ok: false, message: "Missing book id" };
  if (!tagId) return { ok: false, message: "Missing tag id" };

  try {
    const userId = await getUserIdByEmail(session.user.email);
    await removeTagFromBook(userId, bookId, tagId);
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not remove tag. Please try again." };
  }
}

export async function renameTagAction(
  _prev: TagActionState,
  formData: FormData
): Promise<TagActionState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const tagId = String(formData.get("tagId") ?? "").trim();
  const newName = String(formData.get("newName") ?? "").trim();

  if (!tagId) return { ok: false, message: "Missing tag id" };
  if (!newName) return { ok: false, message: "New name cannot be empty" };

  try {
    const userId = await getUserIdByEmail(session.user.email);
    await renameTag(userId, tagId, newName);
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not rename tag. Please try again." };
  }
}
