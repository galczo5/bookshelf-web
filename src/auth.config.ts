import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export default {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/drive.file",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (
        auth?.user ||
        pathname.startsWith("/signin") ||
        pathname.startsWith("/setup") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/_next") ||
        /\.\w+$/.test(pathname)
      ) {
        return true;
      }
      return Response.redirect(new URL("/signin", request.nextUrl));
    },
  },
} satisfies NextAuthConfig;
