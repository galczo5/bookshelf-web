import "server-only";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { randomTagColor, TAG_COLORS } from "@/lib/tag-colors";

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export async function listUserTags(userId: string): Promise<Tag[]> {
  return db
    .selectFrom("tags")
    .select(["id", "name", "color"])
    .where("user_id", "=", userId)
    .orderBy("name", "asc")
    .execute();
}

export async function listUserTagsWithCount(
  userId: string
): Promise<Array<Tag & { bookCount: number }>> {
  const rows = await db
    .selectFrom("tags")
    .leftJoin("book_tags", "book_tags.tag_id", "tags.id")
    .select([
      "tags.id",
      "tags.name",
      "tags.color",
      (eb) => eb.fn.count<string>("book_tags.book_id").as("book_count"),
    ])
    .where("tags.user_id", "=", userId)
    .groupBy(["tags.id", "tags.name", "tags.color"])
    .orderBy("tags.name", "asc")
    .execute();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    bookCount: Number(r.book_count),
  }));
}

export async function listBookTags(bookId: string, userId: string): Promise<Tag[]> {
  return db
    .selectFrom("book_tags")
    .innerJoin("tags", "tags.id", "book_tags.tag_id")
    .select(["tags.id", "tags.name", "tags.color"])
    .where("book_tags.book_id", "=", bookId)
    .where("tags.user_id", "=", userId)
    .orderBy("tags.name", "asc")
    .execute();
}

export async function addTagToBook(userId: string, bookId: string, tagName: string): Promise<Tag> {
  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto("tags")
      .values({ user_id: userId, name: tagName, color: randomTagColor() })
      .onConflict((oc) => oc.columns(["user_id", "name"]).doNothing())
      .execute();

    const tag = await trx
      .selectFrom("tags")
      .select(["id", "name", "color"])
      .where("user_id", "=", userId)
      .where("name", "=", tagName)
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("book_tags")
      .values({ book_id: bookId, tag_id: tag.id })
      .onConflict((oc) => oc.columns(["book_id", "tag_id"]).doNothing())
      .execute();

    return tag;
  });
}

export async function removeTagFromBook(
  userId: string,
  bookId: string,
  tagId: string
): Promise<void> {
  await db
    .deleteFrom("book_tags")
    .where("book_id", "=", bookId)
    .where("tag_id", "=", tagId)
    .where((eb) =>
      eb.exists(
        eb.selectFrom("tags").select("id").where("id", "=", tagId).where("user_id", "=", userId)
      )
    )
    .execute();
}

export async function getTagById(userId: string, tagId: string): Promise<Tag | null> {
  return (
    (await db
      .selectFrom("tags")
      .select(["id", "name", "color"])
      .where("id", "=", tagId)
      .where("user_id", "=", userId)
      .executeTakeFirst()) ?? null
  );
}

export type RenameOutcome =
  | { kind: "renamed"; tag: Tag }
  | { kind: "merged"; target: Tag; mergedBookCount: number };

export async function findCollidingTag(
  userId: string,
  tagId: string,
  newName: string
): Promise<Tag | null> {
  const trimmed = newName.trim().toLowerCase();
  return (
    (await db
      .selectFrom("tags")
      .select(["id", "name", "color"])
      .where("user_id", "=", userId)
      .where("id", "!=", tagId)
      .where(sql`lower(trim(name))`, "=", trimmed)
      .executeTakeFirst()) ?? null
  );
}

export async function countBookTags(userId: string, tagId: string): Promise<number> {
  const row = await db
    .selectFrom("book_tags as bt")
    .innerJoin("tags as t", "t.id", "bt.tag_id")
    .select((eb) => eb.fn.count<string>("bt.book_id").as("count"))
    .where("bt.tag_id", "=", tagId)
    .where("t.user_id", "=", userId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export async function renameOrMergeTag(
  userId: string,
  tagId: string,
  newName: string
): Promise<RenameOutcome> {
  const collision = await findCollidingTag(userId, tagId, newName);

  if (!collision) {
    const row = await db
      .updateTable("tags")
      .set({ name: newName.trim() })
      .where("id", "=", tagId)
      .where("user_id", "=", userId)
      .returning("color")
      .executeTakeFirstOrThrow();
    return { kind: "renamed", tag: { id: tagId, name: newName.trim(), color: row.color } };
  }

  return db.transaction().execute(async (trx) => {
    const source = await trx
      .selectFrom("tags")
      .select(["id", "name", "color"])
      .where("id", "=", tagId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!source) throw new Error("Source tag not found");

    const trimmedLower = newName.trim().toLowerCase();
    const target = await trx
      .selectFrom("tags")
      .select(["id", "name", "color"])
      .where("user_id", "=", userId)
      .where("id", "!=", tagId)
      .where(sql`lower(trim(name))`, "=", trimmedLower)
      .executeTakeFirst();

    if (!target) {
      // race: colliding tag was deleted — fall through to plain rename
      await trx
        .updateTable("tags")
        .set({ name: newName.trim() })
        .where("id", "=", tagId)
        .where("user_id", "=", userId)
        .execute();
      return { kind: "renamed", tag: { id: tagId, name: newName.trim(), color: source.color } };
    }

    await trx
      .insertInto("book_tags")
      .columns(["book_id", "tag_id"])
      .expression((eb) =>
        eb
          .selectFrom("book_tags as bt")
          .select(["bt.book_id", eb.val(target.id).as("tag_id")])
          .where("bt.tag_id", "=", source.id)
      )
      .onConflict((oc) => oc.columns(["book_id", "tag_id"]).doNothing())
      .execute();

    // INSERT must precede DELETE — CASCADE on tags.id drops unmigrated book_tags rows if reversed.
    await trx
      .deleteFrom("tags")
      .where("id", "=", source.id)
      .where("user_id", "=", userId)
      .execute();

    const countRow = await trx
      .selectFrom("book_tags")
      .select((eb) => eb.fn.count<string>("book_id").as("count"))
      .where("tag_id", "=", target.id)
      .executeTakeFirstOrThrow();

    return {
      kind: "merged",
      target,
      mergedBookCount: Number(countRow.count),
    };
  });
}

export async function updateTagColor(userId: string, tagId: string, color: string): Promise<void> {
  if (!(TAG_COLORS as readonly string[]).includes(color)) {
    throw new Error(`Invalid tag color: ${color}`);
  }
  await db
    .updateTable("tags")
    .set({ color })
    .where("id", "=", tagId)
    .where("user_id", "=", userId)
    .execute();
}

export async function applyTagsToBooks(
  userId: string,
  bookIds: string[],
  tagNames: string[]
): Promise<void> {
  if (bookIds.length === 0 || tagNames.length === 0) return;

  await db.transaction().execute(async (trx) => {
    for (const name of tagNames) {
      await trx
        .insertInto("tags")
        .values({ user_id: userId, name, color: randomTagColor() })
        .onConflict((oc) => oc.columns(["user_id", "name"]).doNothing())
        .execute();
    }

    const tags = await trx
      .selectFrom("tags")
      .select(["id"])
      .where("user_id", "=", userId)
      .where("name", "in", tagNames)
      .execute();

    const rows = bookIds.flatMap((bookId) =>
      tags.map((tag) => ({ book_id: bookId, tag_id: tag.id }))
    );

    await trx
      .insertInto("book_tags")
      .values(rows)
      .onConflict((oc) => oc.columns(["book_id", "tag_id"]).doNothing())
      .execute();
  });
}
