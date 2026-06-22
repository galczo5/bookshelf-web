import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("backups")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("drive_file_id", "text")
    .addColumn("drive_file_name", "text")
    .addColumn("backed_up_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn("error", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute();

  await db.schema
    .createIndex("backups_user_id_backed_up_at_idx")
    .on("backups")
    .columns(["user_id", "backed_up_at"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("backups").execute();
}
