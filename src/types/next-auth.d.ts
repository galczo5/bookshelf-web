import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    error?: string;
    user: {
      email: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    access_token?: string;
    expires_at?: number;
    error?: string;
  }
}
