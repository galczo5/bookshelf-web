"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { deleteDraftAndBook } from "@/lib/book-drafts";

export async function cancelReviewAction(_prev: null, formData: FormData): Promise<null> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const bookId = String(formData.get("bookId") ?? "").trim();
  if (!bookId) redirect("/");

  const userId = await getUserIdByEmail(session.user.email);
  await deleteDraftAndBook(bookId, userId);

  redirect("/");
}
