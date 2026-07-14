"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Mode = "MANUAL" | "FILTER";

/**
 * Client form for creating a puzzle set. Mode-aware: MANUAL shows only a
 * title/description; FILTER shows criteria (themes, rating range, targetCount).
 * Mode invariants are enforced server-side; the form just sends the fields.
 */
export function NewSetForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("MANUAL");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      title: String(fd.get("title") || ""),
      description: String(fd.get("description") || "") || undefined,
      mode,
    };
    if (mode === "FILTER") {
      const themes = String(fd.get("themes") || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const targetCount = Number(fd.get("targetCount"));
      body.filterThemes = themes;
      body.filterRatingMin = Number(fd.get("filterRatingMin")) || null;
      body.filterRatingMax = Number(fd.get("filterRatingMax")) || null;
      body.targetCount = Number.isFinite(targetCount) ? targetCount : null;
    }

    const res = await fetch("/api/tutor/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || `Failed (${res.status})`);
      return;
    }
    const { id } = await res.json();
    startTransition(() => router.push(`/tutor/sets/${id}`));
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && (
        <p className="border border-error/40 text-error px-3 py-2 text-[13px]">{error}</p>
      )}

      <div>
        <label className="block mb-1 text-[11px] uppercase tracking-[0.07em] text-muted2">Mode</label>
        <div className="flex gap-2">
          {(["MANUAL", "FILTER"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-[12px] uppercase tracking-[0.06em] border transition-colors ${
                mode === m
                  ? "bg-ink text-paper border-ink"
                  : "bg-paper text-muted border-line hover:border-ink"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-muted">
          {mode === "MANUAL"
            ? "Hand-pick puzzles; each student solves the same set."
            : "Criteria-based; each student gets level-appropriate puzzles from the range."}
        </p>
      </div>

      <div>
        <label className="block mb-1 text-[11px] uppercase tracking-[0.07em] text-muted2">Title</label>
        <input
          name="title"
          required
          placeholder="e.g. Week 3 — Back-rank mates"
          className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
        />
      </div>

      <div>
        <label className="block mb-1 text-[11px] uppercase tracking-[0.07em] text-muted2">
          Description <span className="text-muted">(optional)</span>
        </label>
        <input
          name="description"
          placeholder="Shown to students"
          className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
        />
      </div>

      {mode === "FILTER" && (
        <div className="space-y-4 border border-line bg-shade p-4">
          <p className="text-[11px] uppercase tracking-[0.07em] text-muted2">Filter criteria</p>
          <div>
            <label className="block mb-1 text-[12px] text-muted">
              Themes <span className="text-muted2">(comma-separated, optional)</span>
            </label>
            <input
              name="themes"
              placeholder="backRank, mate, fork"
              className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-[12px] text-muted">Rating min</label>
              <input
                name="filterRatingMin"
                type="number"
                placeholder="800"
                className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
              />
            </div>
            <div>
              <label className="block mb-1 text-[12px] text-muted">Rating max</label>
              <input
                name="filterRatingMax"
                type="number"
                placeholder="1600"
                className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
              />
            </div>
          </div>
          <div>
            <label className="block mb-1 text-[12px] text-muted">
              Target solves to complete <span className="text-error">*</span>
            </label>
            <input
              name="targetCount"
              type="number"
              min={1}
              required
              placeholder="20"
              className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
            />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-rust text-paper px-4 py-2 text-[11px] uppercase tracking-[0.07em] hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create set"}
      </button>
    </form>
  );
}
