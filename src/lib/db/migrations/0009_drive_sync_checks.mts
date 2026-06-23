import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("drive_sync_checks")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("checked_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn("untracked_files", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'`))
    .addColumn("missing_book_ids", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'`))
    .execute();

  await db.schema
    .createIndex("drive_sync_checks_user_checked")
    .on("drive_sync_checks")
    .columns(["user_id", "checked_at"])
    .execute();

  await sql`ALTER TABLE book_drafts ADD COLUMN source_drive_file_id text`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("drive_sync_checks").execute();
  await sql`ALTER TABLE book_drafts DROP COLUMN source_drive_file_id`.execute(db);
}
