import { runSeed } from "../../../scripts/seed-core.mts";

/**
 * App-side entry for loading demo data from a server action.
 * Never call from client components — only invoke from Node-runtime server actions.
 */
export async function loadDemoData(email: string): Promise<{ seeded: number }> {
  return runSeed({ databaseUrl: process.env.DATABASE_URL!, email, force: true });
}
