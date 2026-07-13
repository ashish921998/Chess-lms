import { requireTutor } from "@/lib/auth-guards";
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
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/roster" className="font-bold text-lg">
              ♞ Chess Class
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/roster" className="text-slate-600 hover:text-slate-900">
                Roster
              </Link>
              <Link href="/tutor/sets" className="text-slate-600 hover:text-slate-900">
                Sets
              </Link>
              <Link href="/assign" className="text-slate-600 hover:text-slate-900">
                Assign
              </Link>
            </nav>
          </div>
          <div className="text-sm text-slate-500">Tutor</div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
