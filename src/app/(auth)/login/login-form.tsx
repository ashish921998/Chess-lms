"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "");
    const password = String(fd.get("password") || "");

    const { data, error } = await signIn.email({ email, password });
    if (error) {
      router.push(`/login?error=${encodeURIComponent(error.message || "login_failed")}`);
      return;
    }
    // Redirect based on the role returned in the sign-in response.
    const role = (data as { user?: { role?: string } } | null)?.user?.role ?? "STUDENT";
    startTransition(() => router.push(role === "TUTOR" ? "/roster" : "/dashboard"));
  }

  return (
    <>
      <LoginNotice searchParams={searchParams} />
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="w-full border border-line bg-panel px-3 py-2.5 text-[13px] placeholder:text-muted2 focus:outline-none focus:border-ink"
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          className="w-full border border-line bg-panel px-3 py-2.5 text-[13px] placeholder:text-muted2 focus:outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-rust text-paper px-3 py-2.5 text-[12px] font-medium uppercase tracking-[0.07em] hover:bg-[#8f4a28] disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </>
  );
}

function LoginNotice({ searchParams }: { searchParams: URLSearchParams }) {
  if (searchParams.get("signedup")) {
    return (
      <p className="mb-4 border border-line bg-panel px-3 py-2 text-[13px] text-success">
        ✓ Account created. Sign in below.
      </p>
    );
  }
  const error = searchParams.get("error");
  if (error) {
    return (
      <p className="mb-4 border border-line bg-panel px-3 py-2 text-[13px] text-error">
        ✕ {decodeURIComponent(error)}
      </p>
    );
  }
  return null;
}
