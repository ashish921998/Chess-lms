import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/auth-shell";

export default function LoginPage() {
  return (
    <AuthShell
      image="/chess-login.jpg"
      imageAlt="Chess pieces in dramatic light"
      caption="Think deeper. Play braver. Welcome back to the board."
    >
      <h1 className="font-serif text-3xl tracking-tight text-ink">Sign in</h1>
      <p className="mt-2 text-[13px] text-muted">
        Welcome back to Knight Riders Chess Academy.
      </p>

      {/* LoginForm uses useSearchParams(), which must be wrapped in Suspense. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>

      <p className="mt-8 text-[13px] text-muted">
        New student?{" "}
        <Link href="/signup" className="text-rust underline underline-offset-2 hover:text-[#8f4a28]">
          Sign up with an invite code
        </Link>
      </p>
    </AuthShell>
  );
}
