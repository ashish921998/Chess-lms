import Link from "next/link";
import { redirect } from "next/navigation";
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

  // 3. Create the auth user via Better Auth's internal API. `role` defaults to
  //    STUDENT and is input:false, so it can't be set here.
  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: displayName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = encodeURIComponent(body?.message || "signup_failed");
    redirect(`/signup?error=${msg}`);
  }
  const created = await res.json();
  const userId: string = created.user.id;

  // 4. Create the Student profile, bound to the tutor.
  await db.student.create({
    data: { userId, tutorId: invite.tutorId, displayName },
  });

  redirect("/login?signedup=1");
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
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-xl font-semibold mb-1">Create student account</h1>
      <p className="text-sm text-slate-500 mb-4">
        You need an invite code from your tutor.
      </p>
      <Suspense fallback={null}>
        <SignupError searchParams={searchParams} />
      </Suspense>
      <form action={signup} className="space-y-3 mt-2">
        <input
          name="displayName"
          placeholder="Display name (shown on leaderboard)"
          required
          className="w-full border rounded px-3 py-2"
        />
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="w-full border rounded px-3 py-2"
        />
        <input
          name="password"
          type="password"
          placeholder="Password (min 8 characters)"
          required
          minLength={8}
          className="w-full border rounded px-3 py-2"
        />
        <input
          name="inviteCode"
          placeholder="Invite code"
          required
          className="w-full border rounded px-3 py-2 uppercase"
        />
        <button
          type="submit"
          className="w-full bg-slate-900 text-white rounded px-3 py-2 hover:bg-slate-800"
        >
          Sign up
        </button>
      </form>
      <p className="text-sm text-slate-500 mt-4">
        Already have an account?{" "}
        <Link href="/login" className="text-blue-600">
          Log in
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
      <p className="text-green-700 text-sm bg-green-50 rounded px-3 py-2">
        Account created. Log in below.
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
    <p className="text-red-700 text-sm bg-red-50 rounded px-3 py-2">{msg}</p>
  );
}
