import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("books")
    .addColumn("review_state", "text", (col) =>
      col.notNull().defaultTo("confirmed")
    )
    .execute();

  await db.schema
    .alterTable("books")
    .alterColumn("drive_file_id", (col) => col.dropNotNull())
    .execute();

  await db.schema
    .createTable("book_drafts")
    .addColumn("book_id", "uuid", (col) =>
      col.primaryKey().references("books.id").onDelete("cascade")
    )
    .addColumn("filename", "text", (col) => col.notNull())
    .addColumn("staged_bytes", "bytea", (col) => col.notNull())
    .addColumn("proposals", "jsonb")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`NOW()`)
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("book_drafts").execute();
  await db.schema
    .alterTable("books")
    .alterColumn("drive_file_id", (col) => col.setNotNull())
    .execute();
  await db.schema.alterTable("books").dropColumn("review_state").execute();
}
