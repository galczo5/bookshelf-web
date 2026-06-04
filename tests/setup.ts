// Sets env vars before any module import runs — Vitest setupFiles hook.
// vi.mock('@/auth') replaces the module wholesale so auth secrets are not
// actually consumed in tests, but they must be present to avoid import-side crashes.

process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgres://bookshelf:bookshelf@localhost:5432/bookshelf_test";

process.env.AUTH_SECRET = "test-secret-at-least-32-chars-long-placeholder";
process.env.AUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.BOOKSHELF_ALLOWED_EMAIL = "test@example.com";
// 32-byte base64 value required by auth-tokens encryption
process.env.AUTH_TOKENS_ENCRYPTION_KEY =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
