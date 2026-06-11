import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("books")
    .addColumn("epub_metadata_snapshot", sql`jsonb`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("books").dropColumn("epub_metadata_snapshot").execute();
}
