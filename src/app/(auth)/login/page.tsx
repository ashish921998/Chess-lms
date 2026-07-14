import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16 text-ink">
      <h1 className="font-serif text-2xl tracking-tight mb-1">Sign in</h1>
      <p className="text-[13px] text-muted mb-6">Welcome back to Knight Riders Chess Academy.</p>
      {/* LoginForm uses useSearchParams(), which must be wrapped in Suspense. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <p className="text-[13px] text-muted mt-6">
        New student?{" "}
        <Link href="/signup" className="text-rust hover:underline underline-offset-2">
          Sign up with an invite code
        </Link>
      </p>
    </main>
  );
}
