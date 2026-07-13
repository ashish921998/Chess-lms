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
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <p className="text-red-700 text-sm bg-red-50 rounded px-3 py-2">{error}</p>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Mode</label>
        <div className="flex gap-2">
          {(["MANUAL", "FILTER"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded text-sm border ${
                mode === m
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {mode === "MANUAL"
            ? "Hand-pick puzzles; each student solves the same set."
            : "Criteria-based; each student gets level-appropriate puzzles from the range."}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
        <input
          name="title"
          required
          placeholder="e.g. Week 3 — Back-rank mates"
          className="w-full border rounded px-3 py-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Description <span className="text-slate-400">(optional)</span>
        </label>
        <input
          name="description"
          placeholder="Shown to students"
          className="w-full border rounded px-3 py-2"
        />
      </div>

      {mode === "FILTER" && (
        <div className="space-y-4 rounded-lg border border-slate-200 p-4 bg-slate-50">
          <p className="text-sm font-medium text-slate-700">Filter criteria</p>
          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Themes <span className="text-slate-400">(comma-separated, optional)</span>
            </label>
            <input
              name="themes"
              placeholder="backRank, mate, fork"
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Rating min</label>
              <input
                name="filterRatingMin"
                type="number"
                placeholder="800"
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Rating max</label>
              <input
                name="filterRatingMax"
                type="number"
                placeholder="1600"
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Target solves to complete <span className="text-red-500">*</span>
            </label>
            <input
              name="targetCount"
              type="number"
              min={1}
              required
              placeholder="20"
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create set"}
      </button>
    </form>
  );
}
