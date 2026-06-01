import "server-only";
import { db } from "@/lib/db";

export interface Tag {
  id: string;
  name: string;
}

export async function listUserTags(userId: string): Promise<Tag[]> {
  return db
    .selectFrom("tags")
    .select(["id", "name"])
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
      (eb) => eb.fn.count<string>("book_tags.book_id").as("book_count"),
    ])
    .where("tags.user_id", "=", userId)
    .groupBy(["tags.id", "tags.name"])
    .orderBy("tags.name", "asc")
    .execute();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    bookCount: Number(r.book_count),
  }));
}

export async function listBookTags(bookId: string, userId: string): Promise<Tag[]> {
  return db
    .selectFrom("book_tags")
    .innerJoin("tags", "tags.id", "book_tags.tag_id")
    .select(["tags.id", "tags.name"])
    .where("book_tags.book_id", "=", bookId)
    .where("tags.user_id", "=", userId)
    .orderBy("tags.name", "asc")
    .execute();
}

export async function addTagToBook(
  userId: string,
  bookId: string,
  tagName: string
): Promise<Tag> {
  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto("tags")
      .values({ user_id: userId, name: tagName })
      .onConflict((oc) => oc.columns(["user_id", "name"]).doNothing())
      .execute();

    const tag = await trx
      .selectFrom("tags")
      .select(["id", "name"])
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
        eb
          .selectFrom("tags")
          .select("id")
          .where("id", "=", tagId)
          .where("user_id", "=", userId)
      )
    )
    .execute();
}

export async function renameTag(
  userId: string,
  tagId: string,
  newName: string
): Promise<void> {
  await db
    .updateTable("tags")
    .set({ name: newName })
    .where("id", "=", tagId)
    .where("user_id", "=", userId)
    .execute();
}
