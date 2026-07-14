import { requireStudent } from "@/lib/auth-guards";
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireStudent();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line">
        <div className="mx-auto max-w-5xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="font-serif text-lg tracking-tight">
              Knight Riders <span className="text-muted text-[11px] uppercase tracking-[0.2em]">Chess Academy</span>
            </Link>
            <nav className="flex gap-6 text-[12px] uppercase tracking-[0.05em] text-muted">
              <Link href="/dashboard" className="hover:text-rust">Dashboard</Link>
              <Link href="/practice" className="hover:text-rust">Practice</Link>
              <Link href="/leaderboard" className="hover:text-rust">Leaderboard</Link>
              <Link href="/profile" className="hover:text-rust">Profile</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-[12px] uppercase tracking-[0.05em] text-muted2">
            {me.displayName}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
