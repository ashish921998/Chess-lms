import { requireTutor } from "@/lib/auth-guards";
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Tutor chrome. requireTutor() redirects unauthenticated/non-TUTOR users;
 * the header nav mirrors the student layout. All routes under (tutor) are
 * guarded + scoped to the acting tutor.
 */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guard: redirect/404 for non-tutors. The returned tutor isn't used here, but
  // the call is what enforces the route group's auth boundary.
  await requireTutor();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line">
        <div className="mx-auto max-w-5xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/roster" className="font-serif text-lg tracking-tight">
              Knight Riders <span className="text-muted text-[11px] uppercase tracking-[0.2em]">Chess Academy</span>
            </Link>
            <nav className="flex gap-6 text-[12px] uppercase tracking-[0.05em] text-muted">
              <Link href="/roster" className="hover:text-rust">Roster</Link>
              <Link href="/tutor/sets" className="hover:text-rust">Sets</Link>
              <Link href="/library" className="hover:text-rust">Library</Link>
              <Link href="/assign" className="hover:text-rust">Assign</Link>
              <Link href="/goals" className="hover:text-rust">Goals</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-[12px] uppercase tracking-[0.05em] text-muted2">
            Tutor
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
