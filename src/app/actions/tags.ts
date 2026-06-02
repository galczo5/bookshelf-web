"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import {
  addTagToBook,
  removeTagFromBook,
  renameOrMergeTag,
  applyTagsToBooks,
  findCollidingTag,
  countBookTags,
} from "@/lib/tags";
import { db } from "@/lib/db";

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

export type BulkTagActionState = {
  ok: boolean;
  message?: string;
};

export async function applyTagsToBooksAction(
  _prev: BulkTagActionState,
  formData: FormData
): Promise<BulkTagActionState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookIdsRaw = String(formData.get("bookIds") ?? "").trim();
  const tagNamesRaw = String(formData.get("tagNames") ?? "").trim();

  const bookIds = bookIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tagNames = tagNamesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const deduped = [...new Set(bookIds)];
  const dedupedTags = [...new Set(tagNames)];

  if (deduped.length === 0) return { ok: false, message: "No books selected." };
  if (dedupedTags.length === 0) return { ok: false, message: "Tag name cannot be empty." };

  try {
    const userId = await getUserIdByEmail(session.user.email);
    await applyTagsToBooks(userId, deduped, dedupedTags);
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not apply tags. Please try again." };
  }
}

export type RenameTagActionState =
  | { ok: true; kind: "renamed"; tag: { id: string; name: string } }
  | { ok: true; kind: "merged"; target: { id: string; name: string }; mergedBookCount: number }
  | { ok: false; kind: "needs_confirm"; target: { id: string; name: string }; targetBookCount: number; sourceBookCount: number }
  | { ok: false; kind: "error"; message: string };

export async function renameTagAction(
  _prev: RenameTagActionState,
  formData: FormData
): Promise<RenameTagActionState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const tagId = String(formData.get("tagId") ?? "").trim();
  const newName = String(formData.get("newName") ?? "");
  const confirmedMerge = String(formData.get("confirmedMerge") ?? "0");

  if (!tagId) return { ok: false, kind: "error", message: "Missing tag id" };
  if (!newName.trim()) return { ok: false, kind: "error", message: "Tag name cannot be empty." };
  if (newName.trim().length > 50) return { ok: false, kind: "error", message: "Tag name is too long (50 characters max)." };

  try {
    const userId = await getUserIdByEmail(session.user.email);

    // No-op: same name modulo case/whitespace
    const sourceTag = await db
      .selectFrom("tags")
      .select(["id", "name"])
      .where("id", "=", tagId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (
      sourceTag &&
      sourceTag.name.trim().toLowerCase() === newName.trim().toLowerCase()
    ) {
      return { ok: true, kind: "renamed", tag: sourceTag };
    }

    if (confirmedMerge !== "1") {
      const collision = await findCollidingTag(userId, tagId, newName);
      if (collision) {
        const [targetBookCount, sourceBookCount] = await Promise.all([
          countBookTags(collision.id),
          countBookTags(tagId),
        ]);
        return {
          ok: false,
          kind: "needs_confirm",
          target: collision,
          targetBookCount,
          sourceBookCount,
        };
      }
    }

    const outcome = await renameOrMergeTag(userId, tagId, newName);
    if (outcome.kind === "merged") {
      return { ok: true, kind: "merged", target: outcome.target, mergedBookCount: outcome.mergedBookCount };
    }
    return { ok: true, kind: "renamed", tag: outcome.tag };
  } catch {
    return { ok: false, kind: "error", message: "Could not rename tag. Please try again." };
  }
}
