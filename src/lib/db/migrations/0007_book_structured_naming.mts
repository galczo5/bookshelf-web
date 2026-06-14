import { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("books").addColumn("series", "text").execute();
  await db.schema.alterTable("books").addColumn("part", "text").execute();
  await db.schema.alterTable("books").addColumn("drive_file_name", "text").execute();
  await db.schema.alterTable("books").addColumn("original_drive_file_id", "text").execute();
  await db.schema
    .alterTable("books")
    .addColumn("rename_pending", "boolean", (col) => col.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("books").dropColumn("rename_pending").execute();
  await db.schema.alterTable("books").dropColumn("original_drive_file_id").execute();
  await db.schema.alterTable("books").dropColumn("drive_file_name").execute();
  await db.schema.alterTable("books").dropColumn("part").execute();
  await db.schema.alterTable("books").dropColumn("series").execute();
}
