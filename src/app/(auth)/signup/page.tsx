import Link from "next/link";
import { redirect } from "next/navigation";
import { APIError } from "better-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

async function signup(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("displayName") || "");
  const code = String(formData.get("inviteCode") || "");

  if (!email || !password || !displayName || !code) {
    redirect("/signup?error=missing_fields");
  }

  // 1. Atomic invite redemption: only succeeds if code is valid, not expired,
  //    and under maxUses. Zero rows = code is invalid/used-up/expired.
  const redeemed = await db.$executeRaw`
    UPDATE "InviteCode" SET uses = uses + 1
    WHERE code = ${code}
      AND uses < "maxUses"
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
  `;
  if (redeemed === 0) {
    redirect("/signup?error=invalid_code");
  }

  // 2. Look up which tutor owns this code (before creating the user, so a failed
  //    signup doesn't leave a dangling invite increment — the redemption is the
  //    commitment; if signup fails the student just retries with the same code
  //    only if maxUses hasn't been reached).
  const invite = await db.inviteCode.findUnique({ where: { code } });
  if (!invite) redirect("/signup?error=invalid_code");

  // 3. Create the auth user via Better Auth's server API. We call the endpoint
  //    directly (auth.api.signUpEmail) rather than fetching /api/auth/sign-up/
  //    email over HTTP: a server-side fetch carries no Origin header, which
  //    trips Better Auth's CSRF origin check ("Missing or null Origin"). The
  //    direct call bypasses the HTTP layer entirely. `role` defaults to STUDENT
  //    and is input:false, so it can't be set here.
  try {
    const { user } = await auth.api.signUpEmail({
      body: { email, password, name: displayName },
    });

    // 4. Create the Student profile, bound to the tutor.
    await db.student.create({
      data: { userId: user.id, tutorId: invite.tutorId, displayName },
    });
  } catch (e) {
    const errCode = errorToCode(e);
    redirect(`/signup?error=${encodeURIComponent(errCode)}`);
  }

  redirect("/login?signedup=1");
}

/** Map a Better Auth APIError to the signup error-query param. */
function errorToCode(e: unknown): string {
  if (e instanceof APIError) {
    const code = (e.body as { code?: string } | undefined)?.code;
    switch (code) {
      case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
        return "user_already_exists";
      case "PASSWORD_TOO_SHORT":
        return "password_too_short";
      default:
        return e.body?.message ? String(e.body.message) : "signup_failed";
    }
  }
  return "signup_failed";
}

export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedup?: string }>;
}) {
  return <SignupForm searchParams={searchParams} signup={signup} />;
}

import { Suspense } from "react";

function SignupForm({
  searchParams,
  signup,
}: {
  searchParams: Promise<{ error?: string; signedup?: string }>;
  signup: (fd: FormData) => Promise<void>;
}) {
  const field =
    "w-full border border-line bg-panel px-3 py-2.5 text-[13px] placeholder:text-muted2 focus:outline-none focus:border-ink";
  return (
    <main className="mx-auto max-w-sm px-6 py-16 text-ink">
      <h1 className="font-serif text-2xl tracking-tight mb-1">Create your account</h1>
      <p className="text-[13px] text-muted mb-6">
        You need an invite code from your tutor.
      </p>
      <Suspense fallback={null}>
        <SignupError searchParams={searchParams} />
      </Suspense>
      <form action={signup} className="space-y-3">
        <input
          name="displayName"
          placeholder="Display name (shown on leaderboard)"
          required
          className={field}
        />
        <input name="email" type="email" placeholder="Email" required className={field} />
        <input
          name="password"
          type="password"
          placeholder="Password (min 8 characters)"
          required
          minLength={8}
          className={field}
        />
        <input
          name="inviteCode"
          placeholder="Invite code"
          required
          className={`${field} uppercase`}
        />
        <button
          type="submit"
          className="w-full bg-rust text-paper px-3 py-2.5 text-[12px] font-medium uppercase tracking-[0.07em] hover:bg-[#8f4a28]"
        >
          Sign up
        </button>
      </form>
      <p className="text-[13px] text-muted mt-6">
        Already have an account?{" "}
        <Link href="/login" className="text-rust hover:underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </main>
  );
}

async function SignupError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedup?: string }>;
}) {
  const params = await searchParams;
  if (params.signedup) {
    return (
      <p className="mb-4 border border-line bg-panel px-3 py-2 text-[13px] text-success">
        ✓ Account created. Sign in below.
      </p>
    );
  }
  if (!params.error) return null;
  const messages: Record<string, string> = {
    invalid_code: "Invite code is invalid, used up, or expired.",
    missing_fields: "All fields are required.",
    user_already_exists: "An account with that email already exists.",
    password_too_short: "Password must be at least 8 characters.",
  };
  const msg = messages[params.error] ?? decodeURIComponent(params.error);
  return (
    <p className="mb-4 border border-line bg-panel px-3 py-2 text-[13px] text-error">✕ {msg}</p>
  );
}
