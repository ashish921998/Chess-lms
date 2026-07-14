"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCode } from "@/lib/tutor/invites";

export type InviteView = {
  id: string;
  code: string;
  uses: number;
  maxUses: number;
  expiresAt: string | null;
  createdAt: string;
};

/**
 * Tutor invite-code panel. Lists the tutor's codes (passed from the server
 * component) with a copy-to-clipboard, and lets the tutor generate a fresh
 * single-use code or revoke an existing one. Mutations POST/DELETE to
 * /api/tutor/invites, then router.refresh() re-reads from the DB server-side.
 */
export function InviteCodes({ invites }: { invites: InviteView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function generate() {
    setError(null);
    const res = await fetch("/api/tutor/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxUses: 1 }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || `Failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function revoke(id: string) {
    setError(null);
    const res = await fetch(`/api/tutor/invites/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || `Failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
    } catch {
      setError("Couldn't access clipboard. Copy it manually.");
    }
  }

  return (
    <section className="border border-line bg-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted2">Invite codes</h2>
          <p className="mt-1 text-[12px] text-muted">
            Share a code so a student can sign up and join your roster.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={pending}
          className="bg-ink text-paper px-4 py-2 text-[11px] font-medium uppercase tracking-[0.07em] hover:bg-[#3a3630] disabled:opacity-50"
        >
          {pending ? "…" : "New code"}
        </button>
      </div>

      {error && (
        <p className="text-[12px] text-error border border-line bg-paper px-3 py-2">{error}</p>
      )}

      {invites.length === 0 ? (
        <p className="text-[13px] text-muted">
          No active codes. Generate one to add a student.
        </p>
      ) : (
        <ul className="divide-y divide-line border border-line">
          {invites.map((inv) => {
            const usedUp = inv.uses >= inv.maxUses;
            const expired = inv.expiresAt && new Date(inv.expiresAt) < new Date();
            const dead = usedUp || expired;
            return (
              <li key={inv.id} className="flex items-center gap-3 p-3">
                <code className="font-mono text-[13px] tracking-wider text-ink">{formatCode(inv.code)}</code>
                <span className="text-[11px] uppercase tracking-[0.05em] text-muted">
                  {inv.uses}/{inv.maxUses} used
                  {inv.expiresAt && ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                </span>
                {dead && (
                  <span className="text-[11px] uppercase tracking-[0.05em] text-muted2">
                    {usedUp ? "(used up)" : "(expired)"}
                  </span>
                )}
                <div className="ml-auto flex gap-3">
                  <button
                    onClick={() => copy(inv.code)}
                    className="text-[11px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2"
                  >
                    {copied === inv.code ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => revoke(inv.id)}
                    disabled={pending}
                    className="text-[11px] uppercase tracking-[0.06em] text-rust hover:underline underline-offset-2 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
