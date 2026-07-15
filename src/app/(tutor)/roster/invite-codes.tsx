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
    <section className="surface-card p-5 sm:p-6 space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif text-xl tracking-tight">Invite a student</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted">
            Share a code so a student can sign up and join your roster.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={pending}
          className="secondary-action shrink-0 disabled:opacity-50"
        >
          {pending ? "…" : "New code"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[12px] text-error">{error}</p>
      )}

      {invites.length === 0 ? (
        <p className="text-[13px] text-muted">
          No active codes. Generate one to add a student.
        </p>
      ) : (
        <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line bg-paper/40">
          {invites.map((inv) => {
            const usedUp = inv.uses >= inv.maxUses;
            const expired = inv.expiresAt && new Date(inv.expiresAt) < new Date();
            const dead = usedUp || expired;
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 p-3.5">
                <code className="rounded-md bg-ink px-2.5 py-1.5 font-mono text-[12px] font-semibold tracking-wider text-paper">{formatCode(inv.code)}</code>
                <span className="text-[11px] text-muted">
                  {inv.uses}/{inv.maxUses} used
                  {inv.expiresAt && ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                </span>
                {dead && (
                  <span className="rounded-full bg-shade px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted2">
                    {usedUp ? "Used" : "Expired"}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => copy(inv.code)}
                    className="secondary-action min-h-8 px-2.5"
                  >
                    {copied === inv.code ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => revoke(inv.id)}
                    disabled={pending}
                    className="min-h-8 rounded-lg px-2.5 text-[10px] font-semibold text-muted hover:text-error disabled:opacity-50"
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
