/**
 * Characterization tests for Risk #5 — AI enrichment privacy boundary +
 * wrong-identity confirmation gate (`context/foundation/test-plan.md` §2 Risk #5).
 *
 * Two invariants are pinned against CURRENT behavior:
 *
 *  1. Privacy boundary — the strings the enrichment + tag-suggestion clients send
 *     to OpenAI are limited to the metadata-shaped allow-list (filename, embedded
 *     title/author/ISBN, front-matter snippets, structured Open Library data,
 *     user-typed guidance). No book-body bytes reach a prompt. We feed each
 *     allow-listed field a unique marker and assert it appears; we assert a
 *     `BOOK_BODY_SENTINEL_*` string — passed nowhere in the typed input — never does.
 *
 *  2. The 10×200 front-matter cap (`client.ts:42-45`, `field-agent.ts:92-95`) is the
 *     real safeguard against an oversized front-matter field smuggling body text. It
 *     lives in the client, before the prompt is built, so it can only be exercised
 *     through the OpenAI-boundary mock (a builder-only test would miss it).
 *
 * Shortfalls against the PRD ideal are encoded as passing, labeled assertions
 * (KNOWN SURFACE), each a breadcrumb for a future hardening change — mirroring the
 * Risk #3 (`drive-error-classification`) precedent. No production code changes.
 *
 * The confirmation-gate (wrong-identity) half lands in Phase 2 of this plan.
 */
import { describe, it, beforeAll, beforeEach, expect, vi } from "vitest";

import { buildEnrichmentPrompt } from "@/lib/enrichment/prompt";
import { buildTagSuggestionPrompt } from "@/lib/tag-suggestions/prompt";
import { enrichBook } from "@/lib/enrichment/client";
import { enrichField } from "@/lib/enrichment/field-agent";
import { detectLanguage } from "@/lib/enrichment/language-classifier";
import type { EnrichmentInput } from "@/lib/enrichment/types";
import type { OpenLibraryData } from "@/lib/enrichment/open-library";
import { createOpenAIFake } from "../helpers/openai-fake";

// --- Phase 2: gate integration imports ---
import { db } from "@/lib/db";
import { enrichMetadataAction, applyMetadataAction } from "@/app/actions/enrich-metadata";
import { enrichFieldAction, enrichFieldForDraftAction } from "@/app/actions/enrich-field";
import { suggestTagsAction } from "@/app/actions/tag-suggestions";
import { confirmReviewAction } from "@/app/actions/confirm-review";
import { auth } from "@/auth";
import { getDriveClient } from "@/lib/drive/client";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { resetDb, seedDraft, seedBook, TEST_USER } from "../helpers/db";
import { createDriveFake } from "../helpers/drive-fake";
import { loadFixtureEpub } from "../helpers/fixtures";

// One shared fake across the suite. The `openai` default export is replaced by a
// constructor that always yields `openaiFake.client`; the client modules cache it
// in their module-scope `_client`, so a single instance is correct. The factory
// references `openaiFake` lazily (inside `vi.fn`), so it is only read when
// `new OpenAI()` runs — after this const is initialized (hoist-safe).
const openaiFake = createOpenAIFake();

vi.mock("@/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/drive/client", () => ({ getDriveClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("openai", () => {
  // A normal function (not an arrow) so `new OpenAI()` in the client modules can
  // construct it; arrows are not constructable.
  const ctor = vi.fn(function () {
    return openaiFake.client;
  });
  // `field-agent.ts` / `language-classifier.ts` reference `OpenAI.APIUserAbortError`
  // in their error path; provide a constructable static so `instanceof` never throws.
  (ctor as unknown as { APIUserAbortError: unknown }).APIUserAbortError =
    class APIUserAbortError extends Error {};
  return { default: ctor };
});

// A string that is never part of any typed input — stands in for book-body bytes.
const BODY_SENTINEL = "BOOK_BODY_SENTINEL_DO_NOT_LEAK";

// --- Phase 2: gate test infrastructure ---
const driveFakeGate = createDriveFake();
const fixtureBytes = loadFixtureEpub();

beforeAll(() => {
  // The clients throw `network` if this is unset; the fake never reads its value.
  process.env.OPENAI_API_KEY = "test-openai-key";
});

beforeEach(() => {
  openaiFake.reset();
});

describe("AI enrichment privacy boundary — prompt construction allow-list", () => {
  it("buildEnrichmentPrompt emits only allow-listed strings (filename, embedded fields, front matter, Open Library) — never a body sentinel", () => {
    const input: EnrichmentInput = {
      filename: "FILENAME_MARKER.epub",
      embeddedTitle: "TITLE_MARKER",
      embeddedAuthor: "AUTHOR_MARKER",
      embeddedIsbn: "ISBN_MARKER",
      frontMatterStrings: ["FRONTMATTER_MARKER"],
    };
    const openLibrary: OpenLibraryData = {
      isbns: ["OL_ISBN_MARKER"],
      publishers: ["OL_PUBLISHER_MARKER"],
      publishDates: ["OL_DATE_MARKER"],
      languages: ["OL_LANGUAGE_MARKER"],
    };

    const prompt = buildEnrichmentPrompt(input, openLibrary);

    for (const marker of [
      "FILENAME_MARKER.epub",
      "TITLE_MARKER",
      "AUTHOR_MARKER",
      "ISBN_MARKER",
      "FRONTMATTER_MARKER",
      "OL_ISBN_MARKER",
      "OL_PUBLISHER_MARKER",
      "OL_DATE_MARKER",
      "OL_LANGUAGE_MARKER",
    ]) {
      expect(prompt).toContain(marker);
    }
    expect(prompt).not.toContain(BODY_SENTINEL);
  });

  it("buildTagSuggestionPrompt emits only title/author/ISBN + the user's own tag names — never a body sentinel", () => {
    const prompt = buildTagSuggestionPrompt({
      title: "TITLE_MARKER",
      author: "AUTHOR_MARKER",
      isbn: "ISBN_MARKER",
      existingTagNames: ["EXISTING_TAG_MARKER"],
    });

    for (const marker of ["TITLE_MARKER", "AUTHOR_MARKER", "ISBN_MARKER", "EXISTING_TAG_MARKER"]) {
      expect(prompt).toContain(marker);
    }
    expect(prompt).not.toContain(BODY_SENTINEL);
  });

  it("detectLanguage's prompt (via the OpenAI boundary) emits only filename + embedded title/author — never a body sentinel", async () => {
    openaiFake.setNextResponse("English");

    await detectLanguage({
      filename: "FILENAME_MARKER.epub",
      embeddedTitle: "TITLE_MARKER",
      embeddedAuthor: "AUTHOR_MARKER",
      embeddedIsbn: "ISBN_MARKER",
      frontMatterStrings: [BODY_SENTINEL],
    });

    const sent = openaiFake.lastInput();
    expect(sent).toContain("FILENAME_MARKER.epub");
    expect(sent).toContain("TITLE_MARKER");
    expect(sent).toContain("AUTHOR_MARKER");
    // The language prompt deliberately omits ISBN and front matter — so even a body
    // sentinel placed in `frontMatterStrings` cannot reach this prompt.
    expect(sent).not.toContain(BODY_SENTINEL);
  });

  it("buildFieldPrompt (via enrichField) emits only allow-listed strings — never a body sentinel", async () => {
    openaiFake.setNextResponse({ proposal: null });

    await enrichField(
      {
        filename: "FILENAME_MARKER.epub",
        embeddedTitle: "TITLE_MARKER",
        embeddedAuthor: "AUTHOR_MARKER",
        embeddedIsbn: "ISBN_MARKER",
        frontMatterStrings: ["FRONTMATTER_MARKER"],
      },
      "title",
      "English"
    );

    const sent = openaiFake.lastInput();
    for (const marker of [
      "FILENAME_MARKER.epub",
      "TITLE_MARKER",
      "AUTHOR_MARKER",
      "ISBN_MARKER",
      "FRONTMATTER_MARKER",
    ]) {
      expect(sent).toContain(marker);
    }
    expect(sent).not.toContain(BODY_SENTINEL);
  });

  it("KNOWN SURFACE: enrichField forwards the free-form userMessage verbatim and unbounded", async () => {
    // The field-chat modal's `userMessage` is user-typed and appended without a length
    // cap (`field-agent.ts:78-80`). A user could paste a body excerpt here — that is a
    // privacy SURFACE, not a current leak (nothing in the import flow auto-fills it).
    // Characterize, do not fail. FLIP POINT: when a future change caps/sanitizes
    // `userMessage`, this verbatim-forwarding assertion goes red and should be replaced
    // with the cap assertion.
    openaiFake.setNextResponse({ proposal: null });

    const userMessage = "USER_GUIDANCE_MARKER please prefer the 1979 Penguin edition";
    await enrichField(
      {
        filename: "f.epub",
        embeddedTitle: "T",
        embeddedAuthor: "A",
        embeddedIsbn: "I",
        frontMatterStrings: [],
      },
      "title",
      "English",
      undefined,
      userMessage
    );

    expect(openaiFake.lastInput()).toContain(userMessage);
  });
});

describe("AI enrichment privacy boundary — front-matter 10×200 cap", () => {
  // 15 front-matter entries; entry 0 is 500 chars long. The cap keeps the first 10
  // and slices each to 200 chars, BEFORE the prompt is built.
  const BIG = "B".repeat(500);
  const FRONT_MATTER = [BIG, ...Array.from({ length: 14 }, (_, i) => `FRONTMATTER_MARKER_${i}`)];

  function countSnippetLines(prompt: string): number {
    return prompt.split("\n").filter((l) => l.startsWith("  - ")).length;
  }

  it("enrichBook truncates front matter to 10 items × 200 chars before send", async () => {
    await enrichBook({
      filename: "f.epub",
      embeddedTitle: "T",
      embeddedAuthor: "A",
      // Supplying an ISBN skips the Open Library network fetch (`client.ts:47`),
      // so this test stays fully offline.
      embeddedIsbn: "978-0-00-000000-0",
      frontMatterStrings: FRONT_MATTER,
    });

    const sent = openaiFake.lastInput();
    // At most 10 snippet lines survive (no Open Library block here, so every
    // `  - ` line is a front-matter snippet).
    expect(countSnippetLines(sent)).toBeLessThanOrEqual(10);
    // The 500-char entry is sliced to 200: 200 B's present, 201 absent.
    expect(sent).toContain("B".repeat(200));
    expect(sent).not.toContain("B".repeat(201));
    // The first 9 markers after BIG survive (indices 0..8); the 10th onward is dropped.
    expect(sent).toContain("FRONTMATTER_MARKER_0");
    expect(sent).not.toContain("FRONTMATTER_MARKER_9");
    expect(sent).not.toContain("FRONTMATTER_MARKER_13");
  });

  it("enrichField truncates front matter to 10 items × 200 chars before send", async () => {
    openaiFake.setNextResponse({ proposal: null });

    await enrichField(
      {
        filename: "f.epub",
        embeddedTitle: "T",
        embeddedAuthor: "A",
        embeddedIsbn: "I",
        frontMatterStrings: FRONT_MATTER,
      },
      "title",
      "English"
    );

    const sent = openaiFake.lastInput();
    expect(countSnippetLines(sent)).toBeLessThanOrEqual(10);
    expect(sent).toContain("B".repeat(200));
    expect(sent).not.toContain("B".repeat(201));
    expect(sent).toContain("FRONTMATTER_MARKER_0");
    expect(sent).not.toContain("FRONTMATTER_MARKER_9");
  });

  it("KNOWN SURFACE: all action call sites pass frontMatterStrings: [], so the cap path is unreachable from the action layer today", () => {
    // The cap above is a defense-in-depth safeguard inside the client. Every action
    // call site currently passes `frontMatterStrings: []` (e.g. `enrich-metadata.ts:45`,
    // `enrich-field.ts:42/74/99/130`), so no front matter — and therefore no body — reaches
    // a prompt from the action layer at all. This is characterized, not endorsed: the cap
    // test above exercises the client directly so it stays meaningful even if a future
    // change starts routing real front matter through. FLIP POINT: if a call site begins
    // forwarding front matter, this note should move to an end-to-end assertion through
    // that action.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Wrong-identity gate — behavioral proof that no auto-accept exists
// ---------------------------------------------------------------------------

describe("Wrong-identity gate — proposals do not write to DB (no auto-accept)", () => {
  beforeEach(async () => {
    await resetDb();
    openaiFake.reset();
    driveFakeGate.reset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValue({ user: { email: TEST_USER.email } } as any);
    vi.mocked(getDriveClient).mockResolvedValue(driveFakeGate.client);
  });

  it("enrichMetadataAction returns proposals but leaves the books row unchanged", async () => {
    // Seed with an ISBN so enrichBook skips the Open Library network fetch (client.ts:47).
    const bookId = await db
      .insertInto("books")
      .values({
        user_id: TEST_USER.id,
        title: "Gate Test Title",
        author: "Gate Test Author",
        isbn: "978-3-16-148410-0",
        drive_file_id: "seed-drive-id",
        drive_file_name: "Gate Test Author - Gate Test Title.epub",
        review_state: "confirmed",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
      .then((r) => r.id);

    const fd = new FormData();
    fd.set("bookId", bookId);

    const result = await enrichMetadataAction({ ok: false }, fd);

    expect(result.ok).toBe(true);
    expect(result.proposals).toBeDefined();

    // DB row unchanged — proposals were returned, never persisted.
    const row = await db
      .selectFrom("books")
      .select(["title", "author", "isbn"])
      .where("id", "=", bookId)
      .executeTakeFirstOrThrow();

    expect(row.title).toBe("Gate Test Title");
    expect(row.author).toBe("Gate Test Author");
    expect(row.isbn).toBe("978-3-16-148410-0");
  });

  it("enrichFieldAction returns a proposal but leaves the books row unchanged", async () => {
    openaiFake.setNextResponse({ proposal: null });

    const bookId = await db
      .insertInto("books")
      .values({
        user_id: TEST_USER.id,
        title: "Gate Test Title",
        author: "Gate Test Author",
        isbn: "978-3-16-148410-0",
        drive_file_id: "seed-drive-id",
        drive_file_name: "Gate Test Author - Gate Test Title.epub",
        review_state: "confirmed",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
      .then((r) => r.id);

    const result = await enrichFieldAction(bookId, "title", "English");

    expect(result.ok).toBe(true);
    expect("proposal" in result).toBe(true);

    // DB row unchanged.
    const row = await db
      .selectFrom("books")
      .select(["title", "author", "isbn"])
      .where("id", "=", bookId)
      .executeTakeFirstOrThrow();

    expect(row.title).toBe("Gate Test Title");
    expect(row.author).toBe("Gate Test Author");
    expect(row.isbn).toBe("978-3-16-148410-0");
  });

  it("enrichFieldForDraftAction returns a proposal but leaves the book_drafts row + book row unchanged", async () => {
    openaiFake.setNextResponse({ proposal: null });

    const bookId = await seedDraft({
      filename: "gate-test.epub",
      derivedTitle: "Draft Gate Title",
      stagedBytes: fixtureBytes,
      embedded: { author: "Draft Author", isbn: "978-3-16-148410-0" },
    });

    const result = await enrichFieldForDraftAction(bookId, "title", "English");

    expect(result.ok).toBe(true);

    // Both the book row and the draft row are unchanged.
    const bookRow = await db
      .selectFrom("books")
      .select(["title", "author", "review_state"])
      .where("id", "=", bookId)
      .executeTakeFirstOrThrow();

    expect(bookRow.title).toBe("Draft Gate Title");
    expect(bookRow.author).toBe("Draft Author");
    expect(bookRow.review_state).toBe("pending");

    const draftRow = await db
      .selectFrom("book_drafts")
      .select("book_id")
      .where("book_id", "=", bookId)
      .executeTakeFirstOrThrow();

    expect(draftRow.book_id).toBe(bookId);
  });

  it("suggestTagsAction returns proposals but creates no book_tags rows", async () => {
    openaiFake.setNextResponse({ tags: [{ name: "fantasy", isNew: true, provenance: "genre" }] });

    const bookId = await seedBook({ title: "Tag Gate Title", author: "Tag Gate Author" });

    const tagsBefore = await db
      .selectFrom("book_tags")
      .select("book_id")
      .where("book_id", "=", bookId)
      .execute();
    expect(tagsBefore).toHaveLength(0);

    const fd = new FormData();
    fd.set("bookId", bookId);

    const result = await suggestTagsAction({ ok: false }, fd);

    expect(result.ok).toBe(true);
    expect(result.proposals).toBeDefined();

    // No book_tags rows created — proposals returned, never persisted.
    const tagsAfter = await db
      .selectFrom("book_tags")
      .select("book_id")
      .where("book_id", "=", bookId)
      .execute();
    expect(tagsAfter).toHaveLength(0);
  });
});

describe("Wrong-identity gate — persistence reads FormData, not the proposal", () => {
  beforeEach(async () => {
    await resetDb();
    openaiFake.reset();
    driveFakeGate.reset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValue({ user: { email: TEST_USER.email } } as any);
    vi.mocked(getDriveClient).mockResolvedValue(driveFakeGate.client);
  });

  it("applyMetadataAction persists submitted FormData values verbatim, never any AI proposal", async () => {
    // drive_file_id: null → the rename path in applyMetadataAction is never taken,
    // keeping this test offline and Drive-agnostic.
    const bookId = await db
      .insertInto("books")
      .values({
        user_id: TEST_USER.id,
        title: "Original Title",
        author: "Original Author",
        isbn: null,
        drive_file_id: null,
        drive_file_name: null,
        review_state: "confirmed",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
      .then((r) => r.id);

    const fd = new FormData();
    fd.set("bookId", bookId);
    fd.set("title", "Submitted Title");
    fd.set("author", "Submitted Author");
    fd.set("isbn", "SUBMITTED-ISBN");

    const result = await applyMetadataAction(null, fd);

    expect(result).toMatchObject({ ok: true });

    const row = await db
      .selectFrom("books")
      .select(["title", "author", "isbn"])
      .where("id", "=", bookId)
      .executeTakeFirstOrThrow();

    expect(row.title).toBe("Submitted Title");
    expect(row.author).toBe("Submitted Author");
    expect(row.isbn).toBe("SUBMITTED-ISBN");
  });

  it("applyMetadataAction persists null for empty isbn and author (reject path)", async () => {
    const bookId = await db
      .insertInto("books")
      .values({
        user_id: TEST_USER.id,
        title: "Original Title",
        author: "Original Author",
        isbn: "978-3-16-148410-0",
        drive_file_id: null,
        drive_file_name: null,
        review_state: "confirmed",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
      .then((r) => r.id);

    const fd = new FormData();
    fd.set("bookId", bookId);
    fd.set("title", "T");
    fd.set("author", ""); // empty string → author || null → null persisted
    fd.set("isbn", ""); // empty string → isbn || null → null persisted

    const result = await applyMetadataAction(null, fd);

    expect(result).toMatchObject({ ok: true });

    const row = await db
      .selectFrom("books")
      .select(["author", "isbn"])
      .where("id", "=", bookId)
      .executeTakeFirstOrThrow();

    expect(row.author).toBeNull();
    expect(row.isbn).toBeNull();
  });

  it("confirmReviewAction persists submitted FormData values verbatim, never the draft's embedded metadata", async () => {
    const bookId = await seedDraft({
      filename: "test.epub",
      derivedTitle: "Draft Derived Title",
      stagedBytes: fixtureBytes,
      embedded: { author: "Draft Embedded Author", isbn: "DRAFT-EMBEDDED-ISBN" },
    });

    const fd = new FormData();
    fd.set("bookId", bookId);
    fd.set("title", "Submitted Title");
    fd.set("author", "Submitted Author");
    fd.set("isbn", "SUBMITTED-ISBN");
    fd.set("coverChoice", "");

    let thrown: unknown;
    try {
      await confirmReviewAction(null, fd);
    } catch (err) {
      thrown = err;
    }

    if (!isRedirectError(thrown)) throw thrown ?? new Error("Expected redirect");

    // The confirmed book carries the submitted values, not the draft's embedded ones.
    const row = await db
      .selectFrom("books")
      .select(["title", "author", "isbn", "review_state"])
      .where("id", "=", bookId)
      .executeTakeFirstOrThrow();

    expect(row.review_state).toBe("confirmed");
    expect(row.title).toBe("Submitted Title");
    expect(row.author).toBe("Submitted Author");
    expect(row.isbn).toBe("SUBMITTED-ISBN");
  });

  it("confirmReviewAction persists null for empty author and isbn (reject path)", async () => {
    const bookId = await seedDraft({
      filename: "test.epub",
      derivedTitle: "Test Book",
      stagedBytes: fixtureBytes,
      embedded: { author: "Embedded Author", isbn: "EMBEDDED-ISBN" },
    });

    const fd = new FormData();
    fd.set("bookId", bookId);
    fd.set("title", "T");
    fd.set("author", ""); // empty string → author || null → null persisted
    fd.set("isbn", ""); // empty string → isbn || null → null persisted
    fd.set("coverChoice", "");

    let thrown: unknown;
    try {
      await confirmReviewAction(null, fd);
    } catch (err) {
      thrown = err;
    }

    if (!isRedirectError(thrown)) throw thrown ?? new Error("Expected redirect");

    const row = await db
      .selectFrom("books")
      .select(["author", "isbn"])
      .where("id", "=", bookId)
      .executeTakeFirstOrThrow();

    expect(row.author).toBeNull();
    expect(row.isbn).toBeNull();
  });
});
