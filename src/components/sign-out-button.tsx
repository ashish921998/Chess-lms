"use client";

import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await signOut();
        router.push("/login");
      }}
      className="text-[12px] uppercase tracking-[0.06em] text-muted hover:text-rust"
    >
      Sign out
    </button>
  );
}
