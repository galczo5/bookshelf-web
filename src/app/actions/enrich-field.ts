"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { getConfirmedBook } from "@/lib/books";
import { getDraftWithBook } from "@/lib/book-drafts";
import { detectLanguage } from "@/lib/enrichment/language-classifier";
import { enrichField } from "@/lib/enrichment/field-agent";
import { EnrichmentFailedError } from "@/lib/enrichment/client";
import type {
  EnrichableField,
  LanguageDetectionResult,
  FieldAgentResult,
} from "@/lib/enrichment/types";
import type { EnrichmentInput } from "@/lib/enrichment/types";

type LanguageActionResult =
  | ({ ok: true } & LanguageDetectionResult)
  | { ok: false; message: string };
type FieldActionResult = ({ ok: true } & FieldAgentResult) | { ok: false; message: string };

async function getSession() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  return session.user.email;
}

export async function detectLanguageAction(bookId: string): Promise<LanguageActionResult> {
  const email = await getSession();
  try {
    const userId = await getUserIdByEmail(email);
    const book = await getConfirmedBook(bookId, userId);
    if (!book) return { ok: false, message: "Book not found" };

    const filename = [book.author, book.title].filter(Boolean).join(" - ") + ".epub";
    const input: EnrichmentInput = {
      filename,
      embeddedTitle: book.title || null,
      embeddedAuthor: book.author,
      embeddedIsbn: book.isbn,
      frontMatterStrings: [],
    };

    const result = await detectLanguage(input);
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof EnrichmentFailedError) {
      return { ok: false, message: `Language detection failed: ${err.reason}` };
    }
    return { ok: false, message: "Language detection failed. Please try again." };
  }
}

export async function enrichFieldAction(
  bookId: string,
  field: EnrichableField,
  language: string,
  prevResponseId?: string,
  userMessage?: string
): Promise<FieldActionResult> {
  const email = await getSession();
  try {
    const userId = await getUserIdByEmail(email);
    const book = await getConfirmedBook(bookId, userId);
    if (!book) return { ok: false, message: "Book not found" };

    const filename = [book.author, book.title].filter(Boolean).join(" - ") + ".epub";
    const input: EnrichmentInput = {
      filename,
      embeddedTitle: book.title || null,
      embeddedAuthor: book.author,
      embeddedIsbn: book.isbn,
      frontMatterStrings: [],
    };

    const result = await enrichField(input, field, language, prevResponseId, userMessage);
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof EnrichmentFailedError) {
      return { ok: false, message: `Enrichment failed: ${err.reason}` };
    }
    return { ok: false, message: "Enrichment failed. Please try again." };
  }
}

export async function detectLanguageForDraftAction(draftId: string): Promise<LanguageActionResult> {
  const email = await getSession();
  try {
    const userId = await getUserIdByEmail(email);
    const draft = await getDraftWithBook(draftId, userId);
    if (!draft) return { ok: false, message: "Draft not found" };

    const input: EnrichmentInput = {
      filename: draft.filename,
      embeddedTitle: draft.embedded.title || null,
      embeddedAuthor: draft.embedded.author,
      embeddedIsbn: draft.embedded.isbn,
      frontMatterStrings: [],
    };

    const result = await detectLanguage(input);
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof EnrichmentFailedError) {
      return { ok: false, message: `Language detection failed: ${err.reason}` };
    }
    return { ok: false, message: "Language detection failed. Please try again." };
  }
}

export async function enrichFieldForDraftAction(
  draftId: string,
  field: EnrichableField,
  language: string,
  prevResponseId?: string,
  userMessage?: string
): Promise<FieldActionResult> {
  const email = await getSession();
  try {
    const userId = await getUserIdByEmail(email);
    const draft = await getDraftWithBook(draftId, userId);
    if (!draft) return { ok: false, message: "Draft not found" };

    const input: EnrichmentInput = {
      filename: draft.filename,
      embeddedTitle: draft.embedded.title || null,
      embeddedAuthor: draft.embedded.author,
      embeddedIsbn: draft.embedded.isbn,
      frontMatterStrings: [],
    };

    const result = await enrichField(input, field, language, prevResponseId, userMessage);
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof EnrichmentFailedError) {
      return { ok: false, message: `Enrichment failed: ${err.reason}` };
    }
    return { ok: false, message: "Enrichment failed. Please try again." };
  }
}
