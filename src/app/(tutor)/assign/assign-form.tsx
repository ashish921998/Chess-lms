"use client";

import { useState, useTransition } from "react";

type VersionOption = {
  versionId: string | undefined;
  label: string;
  disabled: boolean;
};

type Student = { id: string; displayName: string; inAppRating: number };

/**
 * Client assignment form. Selects a version, one/many/all students, and an
 * optional due date, then POSTs to /api/tutor/assignments. Reports the
 * created/skip counts from the idempotent backend.
 */
export function AssignForm({
  versionOptions,
  students,
  preselectVersionId,
}: {
  versionOptions: VersionOption[];
  students: Student[];
  preselectVersionId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  function toggle(id: string) {
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    setResult(null);
    setSelected(new Set(students.map((s) => s.id)));
  }
  function clearAll() {
    setResult(null);
    setSelected(new Set());
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const versionId = String(fd.get("versionId") || "");
    if (!versionId) {
      setError("Pick a set.");
      return;
    }
    if (selected.size === 0) {
      setError("Pick at least one student.");
      return;
    }
    const dueDate = String(fd.get("dueDate") || "");

    setSubmitting(true);
    try {
      const res = await fetch("/api/tutor/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId,
          studentIds: [...selected],
          dueDate: dueDate || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Failed (${res.status})`);
        return;
      }
      const { created, skipped } = await res.json();
      setResult(
        `Assigned — ${created} new, ${skipped} already had this version (skipped).`
      );
      setSelected(new Set());
      // Clear the version <select> + due-date inputs on success.
      startTransition(() => {});
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && (
        <p className="border border-error/40 text-error px-3 py-2 text-[13px]">{error}</p>
      )}
      {result && (
        <p className="border border-success/40 text-success px-3 py-2 text-[13px]">{result}</p>
      )}

      <section className="border border-line bg-panel p-6 space-y-3">
        <label className="block text-[11px] uppercase tracking-[0.07em] text-muted2">Puzzle set</label>
        <select
          name="versionId"
          required
          defaultValue={preselectVersionId ?? ""}
          className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
        >
          <option value="" disabled>
            Select a set…
          </option>
          {versionOptions.map((o) => (
            <option key={o.versionId ?? o.label} value={o.versionId ?? ""} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </section>

      <section className="border border-line bg-panel p-6 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] uppercase tracking-[0.07em] text-muted2">
            Students ({selected.size} selected)
          </label>
          <div className="flex gap-3 text-[12px] uppercase tracking-[0.06em]">
            <button type="button" onClick={selectAll} className="text-rust hover:underline">
              All
            </button>
            <button type="button" onClick={clearAll} className="text-muted hover:underline">
              None
            </button>
          </div>
        </div>
        <ul className="divide-y divide-line border border-line max-h-72 overflow-auto">
          {students.map((s) => (
            <li key={s.id} className="flex items-center gap-3 p-3">
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
                className="h-4 w-4 accent-[var(--rust)]"
              />
              <span className="flex-1 text-[13px] text-ink">{s.displayName}</span>
              <span className="text-[12px] uppercase tracking-[0.05em] text-muted">
                Rating <span className="text-rust">{s.inAppRating}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="border border-line bg-panel p-6 space-y-3">
        <label className="text-[11px] uppercase tracking-[0.07em] text-muted2">
          Due date <span className="text-muted">(optional)</span>
        </label>
        <input
          name="dueDate"
          type="date"
          className="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none focus:border-ink sm:w-60"
        />
      </section>

      <button
        type="submit"
        disabled={pending || submitting}
        className="bg-rust text-paper px-4 py-2 text-[11px] uppercase tracking-[0.07em] hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
      >
        {pending || submitting ? "Assigning…" : "Assign"}
      </button>
    </form>
  );
}
