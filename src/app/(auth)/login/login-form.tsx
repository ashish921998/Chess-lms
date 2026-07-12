"use client";

import { useTransition, Suspense } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";

export function LoginForm({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedup?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "");
    const password = String(fd.get("password") || "");

    const { error } = await signIn.email({ email, password });
    if (error) {
      router.push(`/login?error=${encodeURIComponent(error.message || "login_failed")}`);
      return;
    }
    // On success, go to the landing page which redirects by role.
    startTransition(() => router.push("/"));
  }

  return (
    <>
      <Suspense fallback={null}>
        <LoginNotice searchParams={searchParams} />
      </Suspense>
      <form onSubmit={handleSubmit} className="space-y-3 mt-2">
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
          placeholder="Password"
          required
          className="w-full border rounded px-3 py-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-slate-900 text-white rounded px-3 py-2 hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
    </>
  );
}

async function LoginNotice({
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
  if (params.error) {
    return (
      <p className="text-red-700 text-sm bg-red-50 rounded px-3 py-2">
        {decodeURIComponent(params.error)}
      </p>
    );
  }
  return null;
}
