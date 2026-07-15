"use client";

import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await signOut();
        router.push("/login");
      }}
      className={compact ? "app-signout" : "text-[12px] uppercase tracking-[0.06em] text-muted hover:text-rust"}
      aria-label="Sign out"
    >
      {compact ? "↗" : "Sign out"}
    </button>
  );
}
