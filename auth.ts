import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// The two household Google accounts permitted to sign in.
const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [Google],
  pages: { signIn: "/signin" },
  callbacks: {
    // Restrict sign-in to the household allowlist; anyone else is denied.
    signIn({ user }) {
      const email = user.email?.toLowerCase();
      return Boolean(email && allowedEmails.includes(email));
    },
    // Used by proxy.ts (Next 16 middleware) to gate routes: only a session passes.
    authorized({ auth }) {
      return Boolean(auth);
    },
  },
});
