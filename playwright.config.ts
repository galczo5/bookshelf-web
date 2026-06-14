import { defineConfig, devices } from "@playwright/test";

// E2E runs against a real Next.js server + the local Docker Postgres. The
// browser, the cookie, the middleware, and the server actions are all exercised
// for real — that round-trip is the only reason an e2e layer exists here (see
// context/foundation/test-plan.md §4: add Playwright only when integration
// cannot catch the failure).
//
// We never perform the live Google OAuth round-trip (test-plan.md §7 forbids
// it). Instead each test mints a NextAuth session cookie with the SAME
// AUTH_SECRET the server runs with — so these defaults are assigned into
// process.env here (loaded in the runner process) AND handed to the webServer
// child process below, keeping the two halves in lockstep.
const E2E_ENV = {
  DATABASE_URL:
    process.env.DATABASE_URL_E2E ??
    process.env.DATABASE_URL ??
    "postgres://bookshelf:bookshelf@localhost:5432/bookshelf",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-at-least-32-chars-long-placeholder",
  AUTH_URL: "http://localhost:3000",
  // Provider/secret values the NextAuth + auth-tokens modules read at import
  // time. The OAuth flow is bypassed, so dummy values are sufficient.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "e2e-google-client-id",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "e2e-google-client-secret",
  BOOKSHELF_ALLOWED_EMAIL: process.env.BOOKSHELF_ALLOWED_EMAIL ?? "e2e@example.com",
  AUTH_TOKENS_ENCRYPTION_KEY:
    process.env.AUTH_TOKENS_ENCRYPTION_KEY ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
} as const;

for (const [key, value] of Object.entries(E2E_ENV)) {
  process.env[key] = value;
}

export default defineConfig({
  testDir: "./e2e",
  // CI gets one retry to absorb cold-start flake; locally a failure is a failure.
  retries: process.env.CI ? 1 : 0,
  // No arbitrary timeouts inside tests — we wait on state. This is only the
  // outer ceiling that fails a genuinely hung test.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: E2E_ENV,
  },
});
