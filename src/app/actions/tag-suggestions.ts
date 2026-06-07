"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { getConfirmedBook } from "@/lib/books";
import { listBookTags, listUserTags } from "@/lib/tags";
import { suggestTags, TagSuggestionFailedError } from "@/lib/tag-suggestions/client";
import type { TagProposal } from "@/lib/tag-suggestions/types";

export type SuggestTagsState = {
  ok: boolean;
  proposals?: TagProposal[];
  message?: string;
};

export async function suggestTagsAction(
  _prev: SuggestTagsState,
  formData: FormData
): Promise<SuggestTagsState> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookId = String(formData.get("bookId") ?? "").trim();
  if (!bookId) return { ok: false, message: "Missing book id" };

  try {
    const userId = await getUserIdByEmail(session.user.email);

    const [book, bookTags, allUserTags] = await Promise.all([
      getConfirmedBook(bookId, userId),
      listBookTags(bookId, userId),
      listUserTags(userId),
    ]);

    if (!book) return { ok: false, message: "Book not found" };

    const bookTagNames = new Set(bookTags.map((t) => t.name.toLowerCase()));
    const existingTagNames = allUserTags
      .map((t) => t.name)
      .filter((name) => !bookTagNames.has(name.toLowerCase()));

    const result = await suggestTags({
      title: book.title,
      author: book.author,
      isbn: book.isbn,
      existingTagNames,
    });

    const existingLower = new Set(allUserTags.map((t) => t.name.toLowerCase()));

    const filtered = result.tags.filter((p) => p.isNew || existingLower.has(p.name.toLowerCase()));

    return { ok: true, proposals: filtered };
  } catch (err) {
    if (err instanceof TagSuggestionFailedError) {
      return { ok: false, message: "Could not get suggestions. Please try again." };
    }
    return { ok: false, message: "Could not get suggestions. Please try again." };
  }
}
