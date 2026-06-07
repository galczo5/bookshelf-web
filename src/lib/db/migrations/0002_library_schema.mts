import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("email", "text", (col) => col.notNull().unique())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();

  await db.schema
    .createTable("books")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("drive_file_id", "text", (col) => col.notNull())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("author", "text")
    .addColumn("isbn", "text")
    .addColumn("cover_bytes", "bytea")
    .addColumn("cover_mime", "text")
    .addColumn("trashed_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();

  await db.schema
    .createTable("tags")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .addUniqueConstraint("tags_user_id_name_unique", ["user_id", "name"])
    .execute();

  await db.schema
    .createTable("book_tags")
    .addColumn("book_id", "uuid", (col) => col.notNull().references("books.id").onDelete("cascade"))
    .addColumn("tag_id", "uuid", (col) => col.notNull().references("tags.id").onDelete("cascade"))
    .addColumn("added_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .addPrimaryKeyConstraint("book_tags_pkey", ["book_id", "tag_id"])
    .execute();

  await db.schema
    .createTable("notes")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("book_id", "uuid", (col) => col.notNull().references("books.id").onDelete("cascade"))
    .addColumn("body", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("notes").execute();
  await db.schema.dropTable("book_tags").execute();
  await db.schema.dropTable("tags").execute();
  await db.schema.dropTable("books").execute();
  await db.schema.dropTable("users").execute();
}
