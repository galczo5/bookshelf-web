import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { Pool } from "pg";
const migrationFolder = path.join(import.meta.dirname, "../src/lib/db/migrations");
export async function runMigrator(db, direction) {
    const migrator = new Migrator({
        db,
        provider: new FileMigrationProvider({ fs, path, migrationFolder }),
    });
    if (direction === "latest")
        return migrator.migrateToLatest();
    if (direction === "down")
        return migrator.migrateDown();
    // "reset": roll back all migrations one by one
    while (true) {
        const { error, results } = await migrator.migrateDown();
        if (error)
            return { error, results };
        if (!results || results.length === 0)
            return { error: undefined, results: [] };
    }
}
// CLI entry point — only executes when this script is the process entry point.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    if (!process.env.DATABASE_URL) {
        console.error("DATABASE_URL is not set");
        process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = new Kysely({
        dialect: new PostgresDialect({ pool }),
    });
    const direction = process.argv[2] === "down" ? "down" : "latest";
    const { error, results } = await runMigrator(db, direction);
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
}
