import { sql } from "kysely";
export async function up(db) {
    await db.schema
        .createTable("auth_tokens")
        .addColumn("email", "text", (col) => col.primaryKey())
        .addColumn("refresh_token_ciphertext", "bytea", (col) => col.notNull())
        .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql `NOW()`))
        .execute();
}
export async function down(db) {
    await db.schema.dropTable("auth_tokens").execute();
}
