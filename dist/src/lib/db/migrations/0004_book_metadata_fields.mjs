export async function up(db) {
  await db.schema.alterTable("books").addColumn("publisher", "text").execute();
  await db.schema.alterTable("books").addColumn("language", "text").execute();
  await db.schema.alterTable("books").addColumn("published_date", "text").execute();
  await db.schema.alterTable("books").addColumn("description", "text").execute();
}
export async function down(db) {
  await db.schema.alterTable("books").dropColumn("description").execute();
  await db.schema.alterTable("books").dropColumn("published_date").execute();
  await db.schema.alterTable("books").dropColumn("language").execute();
  await db.schema.alterTable("books").dropColumn("publisher").execute();
}
