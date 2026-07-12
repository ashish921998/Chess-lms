import Link from "next/link";
import { LoginForm } from "./login-form";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedup?: string }>;
}) {
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-xl font-semibold mb-4">Log in</h1>
      <LoginForm searchParams={searchParams} />
      <p className="text-sm text-slate-500 mt-4">
        New student?{" "}
        <Link href="/signup" className="text-blue-600">
          Sign up with an invite code
        </Link>
      </p>
    </main>
  );
}
