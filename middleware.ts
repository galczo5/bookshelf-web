import authConfig from "@/auth.config";
import NextAuth from "next-auth";

export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: ["/((?!api/auth|api/health|setup|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
