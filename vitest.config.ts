import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    pool: "forks",
    // Serialize test files so all integration tests share one Postgres DB without racing.
    fileParallelism: false,
    environment: "node",
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
      // server-only's default export throws in non-React-Server contexts.
      // Map to the package's own empty.js so Vitest (plain Node) can import it.
      "server-only": path.resolve(
        process.cwd(),
        "node_modules/server-only/empty.js"
      ),
    },
  },
});
