import { requireStudent } from "@/lib/auth-guards";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireStudent();

  return <AppShell
    name={me.displayName}
    role="Student"
    nav={[
      { href: "/dashboard", label: "Home", icon: "home" },
      { href: "/practice", label: "Practice", icon: "practice" },
      { href: "/leaderboard", label: "Leaderboard", icon: "trophy" },
      { href: "/profile", label: "Profile", icon: "profile" },
    ]}
  >{children}</AppShell>;
}
