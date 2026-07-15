"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";

type NavItem = {
  href: string;
  label: string;
  icon: "home" | "practice" | "trophy" | "profile" | "students" | "sets" | "library" | "assign" | "goals";
};

type AppShellProps = {
  children: React.ReactNode;
  name: string;
  role: "Student" | "Tutor";
  nav: NavItem[];
};

export function AppShell({ children, name, role, nav }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link href={role === "Student" ? "/dashboard" : "/roster"} className="app-brand">
          <span className="app-brand-mark" aria-hidden="true">♞</span>
          <span>
            <strong>Knight Riders</strong>
            <small>Chess Academy</small>
          </span>
        </Link>

        <div className="app-role-pill">{role} workspace</div>

        <nav className="app-nav" aria-label={`${role} navigation`}>
          {nav.map((item) => {
            const active = item.href === "/dashboard" || item.href === "/roster"
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <Link key={item.href} href={item.href} className={active ? "is-active" : undefined}>
                <ShellIcon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</div>
          <div className="min-w-0">
            <strong>{name}</strong>
            <span>{role}</span>
          </div>
          <SignOutButton compact />
        </div>
      </aside>

      <header className="app-mobile-header">
        <Link href={role === "Student" ? "/dashboard" : "/roster"} className="app-mobile-brand">
          <span aria-hidden="true">♞</span>
          Knight Riders
        </Link>
        <div className="app-avatar" aria-label={`${name}, ${role}`}>{name.charAt(0).toUpperCase()}</div>
      </header>

      <main className="app-main">{children}</main>

      <nav className="app-bottom-nav" aria-label={`${role} mobile navigation`}>
        {nav.map((item) => {
          const active = item.href === "/dashboard" || item.href === "/roster"
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "is-active" : undefined}>
              <ShellIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function ShellIcon({ name }: { name: NavItem["icon"] }) {
  const paths: Record<NavItem["icon"], React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></>,
    practice: <><circle cx="12" cy="12" r="8"/><path d="m12 8 1.2 2.5L16 12l-2.8 1.5L12 16l-1.2-2.5L8 12l2.8-1.5Z"/></>,
    trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5v1a4 4 0 0 0 4 4M16 6h3v1a4 4 0 0 1-4 4M12 13v4M8 20h8M10 17h4"/></>,
    profile: <><circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/></>,
    students: <><circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5"/></>,
    sets: <><rect x="4" y="4" width="13" height="13" rx="1"/><path d="M8 8h5M8 12h5M8 17v3h12V7h-3"/></>,
    library: <><path d="M4 5h6v14H4zM14 5h6v14h-6z"/><path d="M7 8v8M17 8v8"/></>,
    assign: <><path d="M5 4h14v16H5z"/><path d="M9 8h6M9 12h6M9 16h3"/><path d="m16 15 1.5 1.5L21 13"/></>,
    goals: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="m15 9 5-5M16 4h4v4"/></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
