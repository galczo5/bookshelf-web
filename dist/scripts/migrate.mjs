import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { Pool } from "pg";
if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new Kysely({
    dialect: new PostgresDialect({ pool }),
});
const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: path.join(import.meta.dirname, "../src/lib/db/migrations"),
    }),
});
const direction = process.argv[2] === "down" ? "down" : "up";
const { error, results } = direction === "down"
    ? await migrator.migrateDown()
    : await migrator.migrateToLatest();
for (const result of results !== null && results !== void 0 ? results : []) {
    if (result.status === "Success") {
        console.log(`Migration "${result.migrationName}" was executed successfully`);
    }
    else if (result.status === "Error") {
        console.error(`Migration "${result.migrationName}" failed`);
    }
}
await db.destroy();
if (error) {
    console.error("Migration failed:", error);
    process.exit(1);
}
