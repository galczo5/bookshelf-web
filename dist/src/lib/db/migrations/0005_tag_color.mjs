export async function up(db) {
  await db.schema
    .alterTable("tags")
    .addColumn("color", "text", (col) => col.notNull().defaultTo("#94a3b8"))
    .execute();
}
export async function down(db) {
  await db.schema.alterTable("tags").dropColumn("color").execute();
}
