import { sql } from "kysely";
export async function up(db) {
  await db.schema
    .alterTable("books")
    .addColumn("epub_metadata_snapshot", sql`jsonb`)
    .execute();
}
export async function down(db) {
  await db.schema.alterTable("books").dropColumn("epub_metadata_snapshot").execute();
}
