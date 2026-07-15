import { requireTutor } from "@/lib/auth-guards";
import { AppShell } from "@/components/app-shell";

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

  return <AppShell
    name="Tutor"
    role="Tutor"
    nav={[
      { href: "/roster", label: "Students", icon: "students" },
      { href: "/tutor/sets", label: "Sets", icon: "sets" },
      { href: "/library", label: "Library", icon: "library" },
      { href: "/assign", label: "Assign", icon: "assign" },
      { href: "/goals", label: "Goals", icon: "goals" },
    ]}
  >{children}</AppShell>;
}
