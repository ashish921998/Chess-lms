import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";

/**
 * Better Auth server instance. Uses the Prisma adapter against our schema.
 * The `role` field on User is server-only (input: false) — clients cannot
 * self-elevate to TUTOR via the sign-up endpoint. Tutors are seeded or created
 * by an existing tutor through an admin path.
 */
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once per day
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "STUDENT",
        input: false, // server-only; clients cannot set this
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
