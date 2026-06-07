import { test as base, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { ensureE2eUser, E2E_USER } from "./db";

// The session cookie name NextAuth uses over http (dev/test). Over https it
// would be `__Secure-authjs.session-token`; the webServer runs http, so no
// prefix. NextAuth derives the JWE encryption key from `salt` (the cookie name)
// + AUTH_SECRET, so the salt MUST equal the cookie name.
const SESSION_COOKIE = "authjs.session-token";

/**
 * Mint a NextAuth JWT session cookie for `email`, encrypted with the same
 * AUTH_SECRET the server runs with (synced via playwright.config.ts). This
 * replaces the live Google OAuth round-trip, which test-plan.md §7 explicitly
 * excludes from CI as flaky and low-signal.
 */
async function mintSessionToken(email: string): Promise<string> {
  return encode({
    salt: SESSION_COOKIE,
    secret: process.env.AUTH_SECRET!,
    token: { email, name: "E2E Reader", sub: email },
  });
}

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ context, page }, use) => {
    // Ensure the operator row exists so server actions can resolve user_id from
    // the session email.
    await ensureE2eUser();

    const value = await mintSessionToken(E2E_USER.email);
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await use(page);
  },
});

export { expect } from "@playwright/test";
