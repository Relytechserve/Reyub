import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (
          typeof email !== "string" ||
          typeof password !== "string" ||
          !email ||
          !password
        ) {
          return null;
        }

        const { getDb } = await import("@/db");
        const db = getDb();
        const [row] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase().trim()))
          .limit(1);
        if (!row?.passwordHash) {
          return null;
        }

        const ok = await verifyPassword(password, row.passwordHash);
        if (!ok) {
          return null;
        }

        return {
          id: row.id,
          email: row.email,
          name: row.name ?? undefined,
        };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
