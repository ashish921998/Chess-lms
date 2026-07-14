"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";

const field =
  "w-full border border-line bg-panel px-3.5 py-3 text-[13px] text-ink placeholder:text-muted2 focus:outline-none focus:border-ink transition-colors";
const label =
  "mb-1.5 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted2";

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
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className={label}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
            className={field}
          />
        </div>
        <div>
          <label htmlFor="password" className={label}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
            className={field}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="mt-2 w-full bg-rust px-3 py-3 text-[12px] font-medium uppercase tracking-[0.1em] text-paper transition-colors hover:bg-[#8f4a28] disabled:opacity-50"
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
      <p className="mt-6 border border-line bg-panel px-3.5 py-2.5 text-[13px] text-success">
        ✓ Account created. Sign in below.
      </p>
    );
  }
  const error = searchParams.get("error");
  if (error) {
    return (
      <p className="mt-6 border border-line bg-panel px-3.5 py-2.5 text-[13px] text-error">
        ✕ {decodeURIComponent(error)}
      </p>
    );
  }
  return null;
}
