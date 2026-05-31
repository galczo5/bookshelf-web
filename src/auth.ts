import "server-only";
import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import authConfig from "@/auth.config";
import { getRefreshToken, saveRefreshToken } from "@/lib/auth-tokens";
import { upsertUserByEmail } from "@/lib/users";

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const refreshToken = await getRefreshToken(token.email as string);
    if (!refreshToken) throw new Error("no refresh token in DB");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const refreshed = await res.json();
    if (!res.ok) throw refreshed;
    if (refreshed.refresh_token) {
      await saveRefreshToken(token.email as string, refreshed.refresh_token);
    }
    return {
      ...token,
      access_token: refreshed.access_token,
      expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      const allowed = process.env.BOOKSHELF_ALLOWED_EMAIL;
      if (!allowed || !user.email) return false;
      if (user.email !== allowed) return false;
      await upsertUserByEmail(user.email);
      return true;
    },
    async jwt({ token, account }) {
      if (account) {
        token.access_token = account.access_token;
        token.expires_at = account.expires_at;
        if (account.refresh_token) {
          await saveRefreshToken(token.email as string, account.refresh_token);
        }
        return token;
      }
      if (
        typeof token.expires_at === "number" &&
        Date.now() < token.expires_at * 1000
      ) {
        return token;
      }
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.error = token.error as string | undefined;
      session.access_token = token.access_token;
      return session;
    },
  },
});
