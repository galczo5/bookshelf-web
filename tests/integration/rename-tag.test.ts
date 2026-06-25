import { describe, it, beforeEach, expect, vi } from "vitest";
import { renameTagAction } from "@/app/actions/tags";
import { addTagToBook, listBookTags, listUserTagsWithCount } from "@/lib/tags";
import { auth } from "@/auth";
import { resetDb, seedBook, seedSecondUser, TEST_USER } from "../helpers/db";

vi.mock("@/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function renameFd(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function tagsByName(userId: string): Promise<Map<string, { id: string; bookCount: number }>> {
  const tags = await listUserTagsWithCount(userId);
  return new Map(tags.map((t) => [t.name, { id: t.id, bookCount: t.bookCount }]));
}

describe("tag rename / merge atomicity (Risk #4)", () => {
  beforeEach(async () => {
    await resetDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValue({ user: { email: TEST_USER.email } } as any);
  });

  it("merging into a colliding tag re-points every source book onto the survivor (deduped) and removes the old tag", async () => {
    // Source "S" on {A,B}; target "T" on {B,C}. Merging S→T must land T on {A,B,C}.
    const a = await seedBook({ title: "A" });
    const b = await seedBook({ title: "B" });
    const c = await seedBook({ title: "C" });
    const s = await addTagToBook(TEST_USER.id, a, "S");
    await addTagToBook(TEST_USER.id, b, "S");
    const t = await addTagToBook(TEST_USER.id, b, "T");
    await addTagToBook(TEST_USER.id, c, "T");

    const result = await renameTagAction(
      { ok: false, kind: "error", message: "" },
      renameFd({ tagId: s.id, newName: "T", confirmedMerge: "1" })
    );

    expect(result).toMatchObject({ ok: true, kind: "merged", mergedBookCount: 3 });

    const tags = await tagsByName(TEST_USER.id);
    expect(tags.has("S")).toBe(false); // source tag removed
    expect(tags.get("T")).toMatchObject({ id: t.id, bookCount: 3 }); // B deduped, not double-counted

    for (const book of [a, b, c]) {
      const names = (await listBookTags(book, TEST_USER.id)).map((tag) => tag.name);
      expect(names).toContain("T");
    }
  });

  it("a collision without confirmation returns needs_confirm and mutates nothing", async () => {
    const a = await seedBook({ title: "A" });
    const b = await seedBook({ title: "B" });
    const c = await seedBook({ title: "C" });
    const s = await addTagToBook(TEST_USER.id, a, "S");
    await addTagToBook(TEST_USER.id, b, "S");
    const t = await addTagToBook(TEST_USER.id, b, "T");
    await addTagToBook(TEST_USER.id, c, "T");

    const result = await renameTagAction(
      { ok: false, kind: "error", message: "" },
      renameFd({ tagId: s.id, newName: "T" })
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "needs_confirm",
      target: { id: t.id },
      targetBookCount: 2,
      sourceBookCount: 2,
    });

    const tags = await tagsByName(TEST_USER.id);
    expect(tags.get("S")).toMatchObject({ id: s.id, bookCount: 2 });
    expect(tags.get("T")).toMatchObject({ id: t.id, bookCount: 2 });
  });

  it("renaming to a fresh name keeps the same tag id and book count", async () => {
    const a = await seedBook({ title: "A" });
    const b = await seedBook({ title: "B" });
    const s = await addTagToBook(TEST_USER.id, a, "Sci-Fi");
    await addTagToBook(TEST_USER.id, b, "Sci-Fi");

    const result = await renameTagAction(
      { ok: false, kind: "error", message: "" },
      renameFd({ tagId: s.id, newName: "Science Fiction" })
    );

    expect(result).toMatchObject({
      ok: true,
      kind: "renamed",
      tag: { id: s.id, name: "Science Fiction" },
    });

    const tags = await tagsByName(TEST_USER.id);
    expect(tags.has("Sci-Fi")).toBe(false);
    expect(tags.get("Science Fiction")).toMatchObject({ id: s.id, bookCount: 2 });
  });

  it("renaming to the same name modulo case changes nothing", async () => {
    const a = await seedBook({ title: "A" });
    const s = await addTagToBook(TEST_USER.id, a, "Sci-Fi");

    const result = await renameTagAction(
      { ok: false, kind: "error", message: "" },
      renameFd({ tagId: s.id, newName: "sci-fi" })
    );

    expect(result).toMatchObject({ ok: true, kind: "renamed" });

    const tags = await tagsByName(TEST_USER.id);
    expect(tags.has("Sci-Fi")).toBe(true); // stored name untouched
    expect(tags.get("Sci-Fi")).toMatchObject({ id: s.id, bookCount: 1 });
  });

  it("rejects an empty or over-long name without touching the tag", async () => {
    const a = await seedBook({ title: "A" });
    const s = await addTagToBook(TEST_USER.id, a, "Keep");

    const empty = await renameTagAction(
      { ok: false, kind: "error", message: "" },
      renameFd({ tagId: s.id, newName: "   " })
    );
    expect(empty).toMatchObject({ ok: false, kind: "error" });

    const tooLong = await renameTagAction(
      { ok: false, kind: "error", message: "" },
      renameFd({ tagId: s.id, newName: "x".repeat(51) })
    );
    expect(tooLong).toMatchObject({ ok: false, kind: "error" });

    const tags = await tagsByName(TEST_USER.id);
    expect(tags.get("Keep")).toMatchObject({ id: s.id, bookCount: 1 });
  });

  it("cannot rename a tag that belongs to another user", async () => {
    const second = await seedSecondUser();
    const theirBook = await seedBook({ userId: second.id, title: "Their Book" });
    const theirTag = await addTagToBook(second.id, theirBook, "Theirs");

    const result = await renameTagAction(
      { ok: false, kind: "error", message: "" },
      renameFd({ tagId: theirTag.id, newName: "Hijacked" })
    );

    expect(result).toMatchObject({ ok: false, kind: "error" });

    const theirTags = await tagsByName(second.id);
    expect(theirTags.has("Theirs")).toBe(true);
    expect(theirTags.has("Hijacked")).toBe(false);
  });
});
