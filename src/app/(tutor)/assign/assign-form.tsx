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
}: {
  versionOptions: VersionOption[];
  students: Student[];
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
      setError("Pick a version.");
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
        <p className="text-red-700 text-sm bg-red-50 rounded px-3 py-2">{error}</p>
      )}
      {result && (
        <p className="text-green-700 text-sm bg-green-50 rounded px-3 py-2">{result}</p>
      )}

      <section className="rounded-lg border bg-white p-6 space-y-3">
        <label className="block text-sm font-medium text-slate-700">Version</label>
        <select
          name="versionId"
          required
          defaultValue=""
          className="w-full border rounded px-3 py-2"
        >
          <option value="" disabled>
            Select a published version…
          </option>
          {versionOptions.map((o) => (
            <option key={o.versionId ?? o.label} value={o.versionId ?? ""} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-lg border bg-white p-6 space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-slate-700">
            Students ({selected.size} selected)
          </label>
          <div className="flex gap-3 text-sm">
            <button type="button" onClick={selectAll} className="text-blue-600 hover:underline">
              All
            </button>
            <button type="button" onClick={clearAll} className="text-slate-500 hover:underline">
              None
            </button>
          </div>
        </div>
        <ul className="divide-y rounded border max-h-72 overflow-auto">
          {students.map((s) => (
            <li key={s.id} className="flex items-center gap-3 p-3">
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
                className="h-4 w-4"
              />
              <span className="flex-1">{s.displayName}</span>
              <span className="text-sm text-slate-500">Rating {s.inAppRating}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border bg-white p-6 space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          Due date <span className="text-slate-400">(optional)</span>
        </label>
        <input
          name="dueDate"
          type="date"
          className="w-full border rounded px-3 py-2 sm:w-60"
        />
      </section>

      <button
        type="submit"
        disabled={pending || submitting}
        className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
      >
        {pending || submitting ? "Assigning…" : "Assign"}
      </button>
    </form>
  );
}
